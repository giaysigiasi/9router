#!/usr/bin/env node
/**
 * build-role-combos.mjs — build capability-role combos (thinking/coding/vision/fast/longctx)
 * from the live /api/models inventory, ranked strongest→weakest.
 *
 *   node scripts/build-role-combos.mjs            # dry-run: print proposed combos
 *   node scripts/build-role-combos.mjs --apply    # create via POST /api/combos
 *
 * Env: BASE_URL (default http://192.168.1.33:20130), PASSWORD (default 1234aaZZ), PREFIX (default "role-")
 */
import { getCapabilitiesForModel } from "../open-sse/providers/capabilities.js";

const BASE = process.env.BASE_URL || "http://192.168.1.33:20130";
const PASSWORD = process.env.PASSWORD || "1234aaZZ";
const PREFIX = process.env.PREFIX || "role-";
const APPLY = process.argv.includes("--apply");
const MAX_PER_COMBO = 20;

// name-based strength heuristic (same as build-cli-combos.mjs)
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
const isChat = (m) => !NONCHAT_PROVIDER.test(m.provider) && !NONCHAT_MODEL.test(m.model);

const isCoder = (m) => /coder|codex|code|deepseek|devstral|qwen3-coder|starcoder|codestral/i.test(m.model) || /coder|code/i.test(m.name || "");
const isFast = (m) => /flash|mini|nano|lite|small|haiku|instant|turbo|-fast\b|fast-/i.test(m.model) || m.caps?.contextWindow <= 64000;

const ROLES = {
  thinking: {
    match: (m) => m.caps?.reasoning === true,
    rank: (m) => strengthScore(m.model) * 1e9 + (m.caps?.contextWindow || 0),
  },
  coding: {
    match: (m) => isCoder(m) && (m.caps?.contextWindow || 0) >= 64000,
    rank: (m) => strengthScore(m.model) * 1e9 + (m.caps?.contextWindow || 0),
  },
  vision: {
    match: (m) => m.caps?.vision === true,
    rank: (m) => strengthScore(m.model) * 1e9 + (m.caps?.contextWindow || 0),
  },
  longctx: {
    match: (m) => (m.caps?.contextWindow || 0) >= 500000,
    rank: (m) => (m.caps?.contextWindow || 0) * 1e6 + strengthScore(m.model),
  },
  fast: {
    match: (m) => isFast(m),
    rank: (m) => strengthScore(m.model) * 1e9 + (m.caps?.contextWindow || 0),
  },
};

async function api(path, opts = {}, token) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(token ? { Cookie: `auth_token=${token}` } : {}), ...(opts.headers || {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const login = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) });
const token = (login.headers.get("set-cookie") || "").match(/auth_token=([^;]+)/)?.[1];
if (!token) { console.error("login failed"); process.exit(1); }

const [{ body: models }, { body: avail }, { body: combos }, { body: health }] = await Promise.all([
  api("/api/models", {}, token),
  api("/api/models/availability", {}, token),
  api("/api/combos", {}, token),
  api("/api/combos/health", {}, token),
]);
const list = Array.isArray(models) ? models : models.models || models.data || [];

// build dead-model set
const dead = new Set();
const deadProviders = new Set();
for (const a of avail?.models || []) {
  if (a.status !== "unavailable") continue;
  if (a.model === "__all") deadProviders.add(a.provider);
  else dead.add(`${a.provider}/${a.model}`);
}
console.log(`inventory: ${list.length} models; dead providers: ${deadProviders.size}, dead models: ${dead.size}`);

// proven-healthy set: combo models not flagged unavailable by last health poll
const comboList = combos.combos || combos;
const unavByName = {};
for (const h of health?.health || []) unavByName[h.name] = new Set(h.unavailableModels || []);
const healthySet = new Set();
for (const c of comboList) {
  const un = unavByName[c.name] || new Set();
  for (const m of c.models || []) if (!un.has(m)) healthySet.add(m);
}
console.log(`proven-healthy models: ${healthySet.size}`);

const HEALTHY_ONLY = !process.argv.includes("--all");
const invByRouted = new Map(list.map((m) => [m.routedModel, m]));

let candidates;
if (HEALTHY_ONLY) {
  // proven-routable only: healthySet entries, caps from inventory or pattern fallback
  candidates = [...healthySet]
    .filter((r) => !NONCHAT_MODEL.test(r))
    .map((r) => {
      const inv = invByRouted.get(r);
      const baseModel = r.split("/").slice(1).join("/");
      const caps = inv?.caps || getCapabilitiesForModel(null, baseModel);
      return { provider: r.split("/")[0], model: baseModel, name: inv?.name || baseModel, routedModel: r, caps, pricing: inv?.pricing || null };
    });
} else {
  candidates = list.filter(
    (m) =>
      isChat(m) &&
      !deadProviders.has(m.provider) &&
      !dead.has(m.routedModel) &&
      !dead.has(`${m.provider}/${m.model}`)
  );
}
console.log(`candidate models: ${candidates.length} (healthy-only=${HEALTHY_ONLY})`);

// de-dupe same routedModel
const seen = new Set();
const unique = candidates.filter((m) => (seen.has(m.routedModel) ? false : (seen.add(m.routedModel), true)));

for (const [role, cfg] of Object.entries(ROLES)) {
  const matched = unique.filter(cfg.match);
  matched.sort((a, b) => cfg.rank(b) - cfg.rank(a));
  const picked = matched.slice(0, MAX_PER_COMBO).map((m) => m.routedModel);
  console.log(`\n=== ${PREFIX}${role} (${picked.length} of ${matched.length}) ===`);
  picked.forEach((r, i) => console.log(` ${String(i + 1).padStart(2)}. ${r}`));
  if (APPLY && picked.length) {
    const existing = comboList.find((c) => c.name === `${PREFIX}${role}`);
    const res = existing
      ? await api(`/api/combos/${existing.id}`, { method: "PUT", body: JSON.stringify({ models: picked }) }, token)
      : await api("/api/combos", { method: "POST", body: JSON.stringify({ name: `${PREFIX}${role}`, models: picked }) }, token);
    console.log(`  -> ${existing ? "PUT" : "POST"} ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
  }
}
if (!APPLY) console.log("\n(dry-run — pass --apply to create)");
