#!/usr/bin/env node
/**
 * build-cli-combos.mjs
 *
 * Builds ONE isolated ordered-fallback combo per AI coding agent / CLI on your
 * PC (Codex, Claude Code, Gemini CLI, OpenCode, Kiro, Kilo, Cursor, Cline, ...)
 * so each agent gets a resilient routing group on 9Router. Point the agent's
 * OpenAI-compatible base URL at http://<router>/v1 with model = the combo name.
 *
 * Design follows the repo's documented account-combo convention
 * (docs/9router-3-project-strategies.md):
 *   - client-account agents  ->  account-<id>-coding-max  (own routes only)
 *   - other agents           ->  <id>-coding-max
 * Client-account = Gemini CLI, Kiro, Kilo Gateway, Cursor (account-quota,
 * isolated). Codex/Claude/Cline/OpenCode are API-key or free-tier (not isolated).
 * Each combo contains ONLY that provider's currently-exposed models, ordered by
 * a coarse name-based strength heuristic (pro/ultra/max/large first; mini/flash/
 * nano/free last). No live probing. Global comboStrategy already defaults to
 * "fallback", so no per-combo strategy write is needed.
 *
 * The instance must be running and reachable (ROUTER_URL). This sandbox has no
 * live 9Router, so run it on the machine that hosts 9Router.
 *
 * Flags / env:
 *   --apply               actually write (default DRY-RUN: prints the plan)
 *   --providers a,b,c     target agent/provider ids (default: the agents below)
 *   --client-account x,y  ids treated as account-isolated (default: gemini-cli,
 *                         kiro, kilo-gateway, cursor)
 *   --role SUFFIX         combo name suffix (default: coding-max)
 *   --max N               cap models per combo (default: 18)
 *   --list [providers]    inspect mode: per-agent table of exposed models
 *                          (routedModel, chat, reasoning, ctx, price, free, picked)
 *   --require-reasoning   in --list, only mark models with caps.reasoning as picked
 *   --min-ctx N           in --list, only mark models with ctx >= N as picked
 *   --cross-provider      include models from ALL providers (not just prefix-matched)
 *                          respects auth boundaries: OAuth-only agents don't get API-key models
 *   --roles r1,r2,...     build role-based combos (cross-provider by default).
 *                          Produces <cli>-<role> combos per agent. Roles: pm, ba, dev,
 *                          qa, supervisor. Each role has built-in model suitability
 *                          thresholds (minCtx, requireReasoning, minStrength).
 *   --check               enumerate + plan only, no 9Router combo calls
 *   --self-check          run offline assertions, no network
 *   --help
 *
 *   ROUTER_URL (default http://localhost:20128)
 *   ROUTER_API_KEY (Bearer; else reuses the local CLI token)
 *   DATA_DIR
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.resolve(HERE, "..", "open-sse", "providers", "registry");

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:20128";
const DRY_RUN = !hasFlag("--apply");
const ROLE = flagValue("--role") || process.env.ROLE || "coding-max";
const MAX_MODELS = parseInt(flagValue("--max") || process.env.MAX_MODELS || "18", 10);
const CHECK_ONLY = hasFlag("--check");
const SELF_CHECK = hasFlag("--self-check");
const LIST = hasFlag("--list");
const REQUIRE_REASONING = hasFlag("--require-reasoning");
const MIN_CTX = parseInt(flagValue("--min-ctx") || "0", 10);
const CROSS_PROVIDER = hasFlag("--cross-provider");
const ROLES_FLAG = flagValue("--roles");
const ROLES = ROLES_FLAG
  ? ROLES_FLAG.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

// Role-based model suitability thresholds
// Each role defines: minCtx, requireReasoning, minStrength (strengthScore floor)
const ROLE_PROFILES = {
  pm:         { minCtx: 64000,  requireReasoning: false, minStrength: -99, label: "pm" },
  ba:         { minCtx: 128000, requireReasoning: false, minStrength: -99, label: "ba" },
  dev:        { minCtx: 200000, requireReasoning: true,  minStrength: -99, label: "dev" },
  qa:         { minCtx: 128000, requireReasoning: true,  minStrength: -99, label: "qa" },
  supervisor: { minCtx: 200000, requireReasoning: true,  minStrength: 3,   label: "supervisor" },
};

// When --roles is set, cross-provider is always on (user wants models across all providers)
const ROLE_MODE = ROLES.length > 0;
const EFFECTIVE_CROSS_PROVIDER = CROSS_PROVIDER || ROLE_MODE;

const DEFAULT_PROVIDERS = [
  "codex", "claude", "gemini-cli", "opencode",
  "kiro", "kilo-gateway", "cursor", "cline",
];
const DEFAULT_CLIENT_ACCOUNT = ["gemini-cli", "kiro", "kilo-gateway", "cursor"];

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

// non-chat model ids we should not put in a coding fallback chain
const NON_CHAT = /(embed|whisper|[^a-z]tts|[^a-z]stt|dall|flux|imagen|\/image|image-gen|-image$)/i;

// --- arg helpers ------------------------------------------------------------
function hasFlag(f) { return process.argv.includes(f); }
function flagValue(f) {
  const i = process.argv.indexOf(f);
  return i === -1 ? null : process.argv[i + 1] || null;
}

// --- CLI token (mirrors cli/src/cli/api/client.js) ---------------------------
function getDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}
function cliToken() {
  let raw = "";
  try { raw = fs.readFileSync(path.join(getDataDir(), "machine-id"), "utf8").trim(); } catch {}
  let secret = "";
  try { secret = fs.readFileSync(path.join(getDataDir(), "auth", "cli-secret"), "utf8").trim(); } catch {}
  if (!raw) return "";
  return crypto.createHash("sha256").update(raw + CLI_TOKEN_SALT + secret).digest("hex").substring(0, 16);
}

// --- HTTP helpers ------------------------------------------------------------
async function apiFetch(method, p, body) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.ROUTER_API_KEY) headers["Authorization"] = `Bearer ${process.env.ROUTER_API_KEY}`;
  else {
    const t = cliToken();
    if (t) headers[CLI_TOKEN_HEADER] = t;
  }
  const res = await fetch(ROUTER_URL + p, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch {}
  return { ok: res.ok, status: res.status, data };
}
// --- registry resolution -----------------------------------------------------
async function loadRegistryProvider(id) {
  const file = path.join(REGISTRY_DIR, `${id}.js`);
  try {
    const mod = await import(pathToFileURL(file).href);
    const p = mod.default;
    if (p && p.id) return { id: p.id, alias: p.alias || p.id, aliases: Array.isArray(p.aliases) ? p.aliases : [] };
  } catch {}
  return { id, alias: id, aliases: [] };
}
function candidatePrefixes(p) {
  return [...new Set([p.id, p.alias, ...p.aliases].filter(Boolean))];
}

// --- strength ordering (coarse, name-based) ----------------------------------
function strengthScore(s) {
  const t = String(s).toLowerCase();
  let score = 0;
  if (/opus/.test(t)) score += 6;
  if (/pro/.test(t)) score += 5;
  if (/ultra/.test(t)) score += 5;
  if (/max/.test(t)) score += 4;
  if (/large/.test(t)) score += 3;
  if (/thinking|reason/.test(t)) score += 2;
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
function orderModels(arr) {
  return arr
    .map((m, i) => ({ m, score: strengthScore(m), i }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((x) => x.m);
}

// --- live model enumeration --------------------------------------------------
// Returns full model objects (routedModel, caps{reasoning,contextWindow,...}, pricing)
// so inspect mode can show per-model suitability, not just a name list.
async function getExposedModelsRaw() {
  const r = await apiFetch("GET", "/api/models");
  if (!r.ok) throw new Error(`GET /api/models -> ${r.status} ${JSON.stringify(r.data)}`);
  const list = Array.isArray(r.data?.models) ? r.data.models : [];
  return list.map((m) => ({
    ...m,
    routedModel: m.routedModel || m.fullModel || `${m.provider}/${m.model}`,
  }));
}
function groupByPrefixRaw(models) {
  const map = new Map();
  for (const m of models) {
    const prefix = m.routedModel.split("/")[0];
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix).push(m);
  }
  return map;
}
function isChat(rm) { return !NON_CHAT.test(rm); }

// free markers per docs/9router-3-project-strategies.md: /free :free -free _free
const FREE_RE = /^.*(\/free$|:free|-free|_free)/i;
function isFree(rm) { return FREE_RE.test(rm); }

// optional strictness for "appropriate": reasoning-capable + context floor
function passesFilter(m) {
  if (REQUIRE_REASONING && !m.caps?.reasoning) return false;
  if (MIN_CTX && (m.caps?.contextWindow || 0) < MIN_CTX) return false;
  return true;
}

// Role-based model filter: checks role-specific thresholds
function passesRoleFilter(m, roleProfile) {
  if (!isChat(m.routedModel)) return false;
  if (roleProfile.requireReasoning && !m.caps?.reasoning) return false;
  if (roleProfile.minCtx && (m.caps?.contextWindow || 0) < roleProfile.minCtx) return false;
  if (roleProfile.minStrength > -99 && strengthScore(m.routedModel) < roleProfile.minStrength) return false;
  return true;
}

// --- cross-provider helpers ---------------------------------------------------
// OAuth-only providers (account-based CLIs that use browser auth)
const OAUTH_ONLY_IDS = new Set(["kiro", "kilo-gateway", "cursor", "gemini-cli"]);

// Check if a model's provider is compatible with the CLI agent's auth type
function isProviderCompatible(cliId, modelProvider) {
  // OAuth-only CLIs should only get their own prefix models (account isolation)
  if (OAUTH_ONLY_IDS.has(cliId)) return false;
  // API-key or free-tier CLIs can get any provider
  return true;
}

// Get all suitable models from ALL providers for cross-provider mode
function getCrossProviderModels(allModels, cliId, ownPrefixes) {
  const ownPrefixSet = new Set(ownPrefixes);
  return allModels.filter((m) => {
    // Always include own-prefix models
    const prefix = m.routedModel.split("/")[0];
    if (ownPrefixSet.has(prefix)) return true;
    // For cross-provider: must be chat, pass filters, and provider must be compatible
    return isChat(m.routedModel) && passesFilter(m) && isProviderCompatible(cliId, prefix);
  });
}

// Get cross-provider models filtered for a specific role
function getRoleModels(allModels, cliId, ownPrefixes, roleProfile) {
  const ownPrefixSet = new Set(ownPrefixes);
  return allModels.filter((m) => {
    const prefix = m.routedModel.split("/")[0];
    if (ownPrefixSet.has(prefix) && isChat(m.routedModel)) return true;
    return passesRoleFilter(m, roleProfile) && isProviderCompatible(cliId, prefix);
  });
}
function fmtPrice(p) {
  if (!p) return "-";
  const inp = p.input ?? p.in;
  const out = p.output ?? p.out;
  if (typeof inp === "number" || typeof out === "number") return `$${inp ?? "?"}|$${out ?? "?"}`;
  return typeof p === "string" ? p : JSON.stringify(p);
}

// --- inspect mode: per-agent table of exposed models ------------------------
async function listModels() {
  const { list, ca } = resolveTargets();
  const raw = await getExposedModelsRaw();
  const byPrefix = groupByPrefixRaw(raw);
  const head = "routedModel".padEnd(46) + " chat reas    ctx   " + "price".padEnd(13) + "free pick";

  if (ROLE_MODE) {
    // Role mode: show per-role sub-tables for each CLI
    for (const id of list) {
      const p = await loadRegistryProvider(id);
      const cands = candidatePrefixes(p);
      const isClient = ca.has(id);
      for (const roleName of ROLES) {
        const rp = ROLE_PROFILES[roleName];
        if (!rp) { console.log(`\n[warn] unknown role: ${roleName}`); continue; }
        const rows = getRoleModels(raw, id, cands, rp);
        const seen = new Set();
        const uniq = rows.filter((m) => (seen.has(m.routedModel) ? false : (seen.add(m.routedModel), true)));
        const comboName = isClient ? `account-${id}-${roleName}` : `${id}-${roleName}`;
        console.log(`\n=== ${comboName} role=${roleName} minCtx=${rp.minCtx} reas=${rp.requireReasoning} minStr=${rp.minStrength} ===`);
        console.log(head);
        if (!uniq.length) { console.log("  (no matching models)"); continue; }
        for (const m of uniq) {
          const chat = isChat(m.routedModel) ? "Y" : "n";
          const reas = m.caps?.reasoning ? "Y" : ".";
          const ctx = m.caps?.contextWindow ?? "?";
          const pick = passesRoleFilter(m, rp) ? "Y" : ".";
          console.log(
            m.routedModel.padEnd(46) +
            ` ${chat}    ${reas}  ${String(ctx).padEnd(6)}` +
            fmtPrice(m.pricing).padEnd(13) +
            ` ${isFree(m.routedModel) ? "Y" : "."}    ${pick}`
          );
        }
      }
    }
    return;
  }

  // Non-role mode (existing behavior)
  for (const id of list) {
    const p = await loadRegistryProvider(id);
    const cands = candidatePrefixes(p);
    let rows;
    if (EFFECTIVE_CROSS_PROVIDER) {
      rows = getCrossProviderModels(raw, id, cands);
    } else {
      rows = [];
      for (const c of cands) for (const m of byPrefix.get(c) || []) rows.push(m);
    }
    const seen = new Set();
    const uniq = rows.filter((m) => (seen.has(m.routedModel) ? false : (seen.add(m.routedModel), true)));
    const crossLabel = EFFECTIVE_CROSS_PROVIDER ? " cross-provider" : "";
    console.log(`\n=== ${id} (account=${ca.has(id)}) prefixes=[${cands.join(",")}]${crossLabel}${REQUIRE_REASONING ? " require-reasoning" : ""}${MIN_CTX ? ` min-ctx=${MIN_CTX}` : ""} ===`);
    console.log(head);
    if (!uniq.length) { console.log("  (no exposed models)"); continue; }
    for (const m of uniq) {
      const chat = isChat(m.routedModel) ? "Y" : "n";
      const reas = m.caps?.reasoning ? "Y" : ".";
      const ctx = m.caps?.contextWindow ?? "?";
      const pick = isChat(m.routedModel) && passesFilter(m) ? "Y" : ".";
      console.log(
        m.routedModel.padEnd(46) +
        ` ${chat}    ${reas}  ${String(ctx).padEnd(6)}` +
        fmtPrice(m.pricing).padEnd(13) +
        ` ${isFree(m.routedModel) ? "Y" : "."}    ${pick}`
      );
    }
  }
}

// --- combo upsert ------------------------------------------------------------
async function getCombos() {
  const r = await apiFetch("GET", "/api/combos");
  if (!r.ok) throw new Error(`GET /api/combos -> ${r.status}`);
  return Array.isArray(r.data?.combos) ? r.data.combos : [];
}
async function upsertCombo(name, models) {
  const combos = await getCombos();
  const existing = combos.find((c) => c.name === name);
  if (existing && JSON.stringify(existing.models) === JSON.stringify(models)) {
    console.log(`[skip]   ${name} already matches target`);
    return "skip";
  }
  if (DRY_RUN) {
    console.log(`[dry-run] ${name}: ${models.join(" -> ")}`);
    return "dry";
  }
  if (existing) {
    const r = await apiFetch("PUT", `/api/combos/${existing.id}`, { models });
    console.log(r.ok ? `[updated] ${name}` : `[error] ${name}: ${r.status} ${JSON.stringify(r.data)}`);
    return r.ok ? "updated" : "error";
  }
  const r = await apiFetch("POST", "/api/combos", { name, models });
  console.log(r.ok ? `[created] ${name}` : `[error] ${name}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.ok ? "created" : "error";
}
// --- main --------------------------------------------------------------------
function resolveTargets() {
  const fromFlag = flagValue("--providers");
  const list = (fromFlag || process.env.PROVIDERS || DEFAULT_PROVIDERS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
  const caFlag = flagValue("--client-account");
  const ca = new Set((caFlag || DEFAULT_CLIENT_ACCOUNT.join(",")).split(",").map((s) => s.trim()).filter(Boolean));
  return { list, ca };
}

async function runOnce() {
  const { list, ca } = resolveTargets();
  const raw = await getExposedModelsRaw();
  const byPrefix = groupByPrefixRaw(raw);
  let total = 0;
  for (const c of byPrefix.values()) total += c.length;
  console.log(`[info] ${total} exposed models across ${byPrefix.size} prefixes${ROLE_MODE ? " (role mode)" : EFFECTIVE_CROSS_PROVIDER ? " (cross-provider mode)" : ""}`);

  for (const id of list) {
    const p = await loadRegistryProvider(id);
    const cands = candidatePrefixes(p);
    const isClient = ca.has(id);

    if (ROLE_MODE) {
      // Role mode: create one combo per role per CLI
      for (const roleName of ROLES) {
        const rp = ROLE_PROFILES[roleName];
        if (!rp) { console.log(`[warn] unknown role: ${roleName}`); continue; }
        const candidates = getRoleModels(raw, id, cands, rp);
        const seen = new Set();
        const unique = candidates.filter((m) => isChat(m.routedModel) && (seen.has(m.routedModel) ? false : (seen.add(m.routedModel), true)));
        const name = isClient ? `account-${id}-${roleName}` : `${id}-${roleName}`;
        if (unique.length === 0) {
          console.log(`[skip]   ${name}: no matching models (minCtx=${rp.minCtx} reas=${rp.requireReasoning} minStr=${rp.minStrength})`);
          continue;
        }
        const ordered = orderModels(unique.map((m) => m.routedModel)).slice(0, MAX_MODELS);
        console.log(`[plan]   ${name} (${ordered.length} model(s), role=${roleName})`);
        if (!CHECK_ONLY) await upsertCombo(name, ordered);
      }
    } else {
      // Original single-suffix mode
      let candidates;
      if (EFFECTIVE_CROSS_PROVIDER) {
        candidates = getCrossProviderModels(raw, id, cands);
      } else {
        candidates = [];
        for (const c of cands) for (const m of byPrefix.get(c) || []) candidates.push(m);
      }
      const chat = [];
      let skippedNonChat = 0;
      for (const m of candidates) {
        if (isChat(m.routedModel)) chat.push(m);
        else skippedNonChat++;
      }
      const seen = new Set();
      const unique = chat.filter((m) => (seen.has(m.routedModel) ? false : (seen.add(m.routedModel), true)));
      if (unique.length === 0) {
        console.log(`[skip]   ${id}: no exposed chat models (candidates: ${cands.join(",")})`);
        continue;
      }
      const ordered = orderModels(unique.map((m) => m.routedModel)).slice(0, MAX_MODELS);
      const name = isClient ? `account-${id}-${ROLE}` : `${id}-${ROLE}`;
      if (skippedNonChat) console.log(`[info] ${id}: dropped ${skippedNonChat} non-chat model(s)`);
      console.log(`[plan]   ${name} (${ordered.length} model(s))`);
      if (!CHECK_ONLY) await upsertCombo(name, ordered);
    }
  }
  console.log(`[done] dryRun=${DRY_RUN} check=${CHECK_ONLY}`);
}

// --- offline self-check ------------------------------------------------------
function selfCheck() {
  const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exit(1); } };
  ok(orderModels(["oc/x-mini", "oc/x-pro", "oc/x-flash"]).join() === "oc/x-pro,oc/x-flash,oc/x-mini", "pro before flash before mini");
  ok(orderModels(["oc/a-flash", "oc/b-flash"]).join() === "oc/a-flash,oc/b-flash", "stable tie order");
  ok(orderModels(["oc/gpt-120b", "oc/gpt-8b", "oc/gpt-1b"]).join() === "oc/gpt-120b,oc/gpt-8b,oc/gpt-1b", "param desc");
  ok(candidatePrefixes({ id: "cloudflare-ai", alias: "cloudflare-ai", aliases: ["cf"] }).join() === "cloudflare-ai,cf", "candidate prefixes");
  ok(!isChat("oc/text-embedding-3-small"), "embedding filtered");
  ok(isChat("oc/gpt-4o"), "chat kept");
  ok(isChat("nvidia/minimaxai/minimax-m3"), "chat kept (nvidia)");
  // cross-provider: OAuth-only CLIs should not get other providers
  ok(!isProviderCompatible("kiro", "ds"), "kiro (OAuth) should not get ds models");
  ok(!isProviderCompatible("cursor", "nvidia"), "cursor (OAuth) should not get nvidia models");
  ok(isProviderCompatible("codex", "ds"), "codex (API-key) should get ds models");
  ok(isProviderCompatible("cline", "nvidia"), "cline (API-key) should get nvidia models");
  // role profiles: supervisor requires reasoning + strength >= 3
  ok(ROLE_PROFILES.supervisor.requireReasoning === true, "supervisor requires reasoning");
  ok(ROLE_PROFILES.supervisor.minStrength === 3, "supervisor minStrength=3");
  ok(ROLE_PROFILES.pm.requireReasoning === false, "pm does not require reasoning");
  ok(ROLE_PROFILES.pm.minCtx === 64000, "pm minCtx=64000");
  ok(Object.keys(ROLE_PROFILES).length === 5, "5 role profiles defined");
  // role filter: model with ctx=32000 should fail pm (64k min)
  ok(!passesRoleFilter({ routedModel: "cx/test", caps: { contextWindow: 32000 } }, ROLE_PROFILES.pm), "32k ctx fails pm");
  // role filter: model with ctx=100000 should pass pm
  ok(passesRoleFilter({ routedModel: "cx/test", caps: { contextWindow: 100000 } }, ROLE_PROFILES.pm), "100k ctx passes pm");
  // role filter: supervisor rejects weak models (strengthScore < 3)
  ok(!passesRoleFilter({ routedModel: "cx/mini-model", caps: { contextWindow: 250000, reasoning: true } }, ROLE_PROFILES.supervisor), "mini fails supervisor minStrength");
  // role filter: supervisor accepts strong models
  ok(passesRoleFilter({ routedModel: "cx/gpt-4o-pro", caps: { contextWindow: 250000, reasoning: true } }, ROLE_PROFILES.supervisor), "pro passes supervisor minStrength");
  console.log("self-check OK");
  process.exit(0);
}

// --- entrypoint --------------------------------------------------------------
if (hasFlag("--help")) {
  console.log("See header comment for usage.");
  process.exit(0);
}
if (SELF_CHECK) selfCheck();

if (LIST) {
  listModels().then(() => process.exit(0)).catch((e) => { console.error("[fatal]", e); process.exit(1); });
} else if (CHECK_ONLY) {
  runOnce().catch((e) => { console.error("[fatal]", e); process.exit(1); });
} else {
  runOnce().then(() => process.exit(0)).catch((e) => { console.error("[fatal]", e); process.exit(1); });
}


