// Auto-curate combos: combos named `role-*` / `auto-*` are re-derived each health
// poll from proven-healthy + provider-discovered models, ranked strongest→weakest.
//
// Env:
//   COMBO_AUTOCURATE=0              disable (default: enabled, prefix-gated)
//   COMBO_AUTOCURATE_PREFIXES       comma list, default "role-,auto-"
//   COMBO_AUTOCURATE_FREE_ONLY=1    only free models (price 0 or ":free" suffix)
//   COMBO_AUTOCURATE_MAX            cap per combo (default 20)

import { AI_MODELS } from "@/shared/constants/config";
import { getProviderAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getPricingForModel } from "open-sse/providers/pricing.js";
import { getCustomModels, updateCombo } from "@/lib/localDb";
import { resetComboRotation } from "open-sse/services/combo.js";

const MAX_PER_COMBO = Number(process.env.COMBO_AUTOCURATE_MAX) || 20;

// name-based strength heuristic (opus > pro > ultra > max > params; light/free penalized)
function strengthScore(s) {
  const t = String(s).toLowerCase();
  let score = 0;
  if (/opus/.test(t)) score += 6;
  if (/pro/.test(t)) score += 5;
  if (/ultra/.test(t)) score += 5;
  if (/max/.test(t)) score += 4;
  if (/large/.test(t)) score += 3;
  if (/thinking|reason|deepseek-r|o[0-9]/.test(t)) score += 2;
  const m = t.match(/(\d+)\s*[bm]?b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 100) score += 3;
    else if (n >= 30) score += 2;
    else if (n >= 8) score += 1;
  }
  if (/mini|nano/.test(t)) score -= 4;
  if (/flash|lite/.test(t)) score -= 3;
  if (/small/.test(t)) score -= 4;
  if (/free/.test(t)) score -= 2;
  return score;
}

const NONCHAT_PROVIDER = /tts|deepgram|voyage|runway|elevenlabs|assemblyai|embedding|edge-tts|google-tts|stability/i;
const NONCHAT_MODEL = /embed|whisper|tts|speech-|voxtral|seedream|nanobanana|dall-e|imagen|flux|sora|veo-|gen[34]_|voyage|rerank|moderation|guard|transcrib|-image\b|image-\d|sd\d|diffusion|-audio\b|audio-/i;
const isChat = (provider, model) => !NONCHAT_PROVIDER.test(provider) && !NONCHAT_MODEL.test(model);

const isCoder = (m) => /coder|codex|code|deepseek|devstral|qwen3-coder|starcoder|codestral/i.test(m.model) || /coder|code/i.test(m.name || "");
const isFast = (m) => /flash|mini|nano|lite|small|haiku|instant|turbo|-fast\b|fast-/i.test(m.model) || (m.caps?.contextWindow || 0) <= 64000;

const byStrengthThenCtx = (m) => strengthScore(m.model) * 1e9 + (m.caps?.contextWindow || 0);

const AUTO_ROLES = {
  thinking: { match: (m) => m.caps?.reasoning === true, rank: byStrengthThenCtx },
  coding:   { match: (m) => isCoder(m) && (m.caps?.contextWindow || 0) >= 64000, rank: byStrengthThenCtx },
  vision:   { match: (m) => m.caps?.vision === true, rank: byStrengthThenCtx },
  longctx:  { match: (m) => (m.caps?.contextWindow || 0) >= 500000, rank: (m) => (m.caps?.contextWindow || 0) * 1e6 + strengthScore(m.model) },
  fast:     { match: isFast, rank: byStrengthThenCtx },
};

export function autoCurateEnabled() {
  const v = String(process.env.COMBO_AUTOCURATE ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
}

function autoPrefixes() {
  return String(process.env.COMBO_AUTOCURATE_PREFIXES || "role-,auto-")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export function autoComboRole(name) {
  for (const prefix of autoPrefixes()) {
    if (name?.startsWith(prefix)) {
      const role = name.slice(prefix.length);
      if (AUTO_ROLES[role]) return role;
    }
  }
  return null;
}

function isFree(entry) {
  if (/:free$/i.test(entry.routedModel)) return true;
  const p = entry.pricing;
  return p != null && (p.input || 0) === 0 && (p.output || 0) === 0;
}

const DISCOVERY_TIMEOUT_MS = 8000;

// Fetch a custom gateway's model list (OpenAI-style GET {baseUrl}/models).
async function fetchNodeModels(connection) {
  const baseUrl = connection?.providerSpecificData?.baseUrl;
  const apiKey = connection?.apiKey;
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${String(baseUrl).replace(/\/$/, "")}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = await res.json().catch(() => null);
    const data = body?.data || body?.models || [];
    return (Array.isArray(data) ? data : []).map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
  } catch {
    return [];
  }
}

// Build candidate pool: models proven healthy this tick + inventory models on
// prefixes that have at least one healthy model (discovered, validated by the
// next poll — dead picks get flagged unavailable and dropped next tick).
async function buildCandidates(healthySet, freeOnly, connections) {
  const healthyPrefixes = new Set([...healthySet].map((r) => r.split("/")[0]));
  const byRouted = new Map();

  const add = (provider, model, caps, pricing, routed) => {
    if (byRouted.has(routed) || !isChat(provider, model)) return;
    const entry = { provider, model, routedModel: routed, caps: caps || {}, pricing: pricing || null };
    if (freeOnly && !isFree(entry)) return;
    byRouted.set(routed, entry);
  };

  for (const m of AI_MODELS) {
    const alias = getProviderAlias(m.provider) || m.provider;
    add(alias, m.model, getCapabilitiesForModel(m.provider, m.model), getPricingForModel(m.provider, m.model), `${alias}/${m.model}`);
  }
  for (const cm of (await getCustomModels()) || []) {
    if (cm.type && cm.type !== "llm") continue;
    if (!cm.providerAlias || !cm.id) continue;
    const caps = getCapabilitiesForModel(cm.providerAlias, cm.id);
    add(cm.providerAlias, cm.id, caps, getPricingForModel(cm.providerAlias, cm.id), `${cm.providerAlias}/${cm.id}`);
  }

  const out = [];
  const invByRouted = byRouted;
  for (const routed of healthySet) {
    const inv = invByRouted.get(routed);
    if (inv) { out.push(inv); continue; }
    // healthy but not in inventory (custom-connection models etc.)
    const provider = routed.split("/")[0];
    const model = routed.slice(provider.length + 1);
    if (!isChat(provider, model)) continue;
    const entry = { provider, model, routedModel: routed, caps: getCapabilitiesForModel(provider, model), pricing: null };
    if (freeOnly && !isFree(entry)) continue;
    out.push(entry);
    invByRouted.set(routed, entry);
  }
  // discovery: inventory models on prefixes proven alive this tick
  for (const entry of byRouted.values()) {
    if (healthyPrefixes.has(entry.provider) && !out.includes(entry)) out.push(entry);
  }

  // upstream discovery: ask healthy custom gateways (providerSpecificData.baseUrl)
  // for their /models list — catches new models not yet in any combo/inventory
  if (!["0", "false"].includes(String(process.env.COMBO_AUTOCURATE_DISCOVERY ?? "1").toLowerCase())) {
    const conns = (connections || []).filter(
      (c) => c?.providerSpecificData?.baseUrl && healthyPrefixes.has(c.providerSpecificData?.prefix)
    );
    for (const conn of conns) {
      const prefix = conn.providerSpecificData.prefix;
      for (const id of await fetchNodeModels(conn)) {
        const routed = `${prefix}/${id}`;
        if (byRouted.has(routed)) continue;
        const caps = getCapabilitiesForModel(prefix, id);
        const entry = { provider: prefix, model: id, routedModel: routed, caps, pricing: null };
        if (!isChat(prefix, id) || (freeOnly && !isFree(entry))) continue;
        byRouted.set(routed, entry);
        out.push(entry);
      }
    }
  }
  return out;
}

export async function curateAutoCombos({ combos, staticHealth, probes, connections }) {
  if (!autoCurateEnabled()) return null;

  const autoCombos = (combos || []).filter((c) => autoComboRole(c.name));
  if (autoCombos.length === 0) return null;

  // healthy set: combo models minus unavailableModels; probe modelProbes override
  const unavById = {};
  for (const h of staticHealth || []) unavById[h.id] = new Set(h.unavailableModels || []);
  const probeById = {};
  for (const p of probes || []) if (p?.modelProbes) probeById[p.id] = new Map(p.modelProbes.map((mp) => [mp.model, mp.ok]));

  const healthySet = new Set();
  for (const c of combos || []) {
    const unav = unavById[c.id] || new Set();
    const probe = probeById[c.id];
    for (const m of c.models || []) {
      const ok = probe ? probe.get(m) === true : !unav.has(m);
      if (ok) healthySet.add(m);
    }
  }

  const freeOnly = ["1", "true"].includes(String(process.env.COMBO_AUTOCURATE_FREE_ONLY).toLowerCase());
  const candidates = await buildCandidates(healthySet, freeOnly, connections);

  const changes = [];
  for (const combo of autoCombos) {
    const role = autoComboRole(combo.name);
    const cfg = AUTO_ROLES[role];
    const picked = candidates
      .filter(cfg.match)
      .sort((a, b) => cfg.rank(b) - cfg.rank(a))
      .slice(0, MAX_PER_COMBO)
      .map((m) => m.routedModel);
    const before = combo.models || [];
    if (picked.length === 0 || (picked.length === before.length && picked.every((m, i) => m === before[i]))) continue;
    await updateCombo(combo.id, { models: picked });
    resetComboRotation(combo.name);
    changes.push({ name: combo.name, role, before: before.length, after: picked.length });
  }
  if (changes.length) {
    console.log(`[ComboAutoCurate] updated: ${changes.map((c) => `${c.name} ${c.before}→${c.after}`).join(", ")}`);
  }
  return changes;
}
