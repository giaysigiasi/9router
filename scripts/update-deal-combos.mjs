#!/usr/bin/env node
/**
 * update-deal-combos.mjs  (provider-driven)
 *
 * Auto-sync 9Router combos that use ONLY one provider's models to that
 * provider's current DEAL (discounted / off-peak / limited-free) models.
 *
 * The script is provider-agnostic: it loads every provider catalog from
 * open-sse/providers/registry/*.js, and for each provider that has a DEAL
 * SOURCE configured it scrapes the deals, resolves them to valid model ids,
 * then updates that provider's exclusive combos to contain exactly the deal
 * models (order-preserving; unchanged combos are skipped).
 *
 * Only providers present in DEAL_SOURCES get updated. Command Code is wired to
 * https://commandcode.ai/models. To add another provider, add one entry to
 * DEAL_SOURCES below — no other code changes needed.
 *
 * Flags / env:
 *   --provider <id|all>   which provider(s) to process (default: commandcode)
 *   --apply               actually write (default DRY-RUN)
 *   --once                single pass then exit (default loops on INTERVAL_MIN)
 *   --only-deals          only touch combos already composed solely of deal models
 *   --mode all            target = every model of the provider (not just deals)
 *   --check               scrape + map only, no 9Router calls
 *   --create NAME         also create/update a dedicated combo named NAME
 *
 *   ROUTER_URL, ROUTER_API_KEY, MODE, INTERVAL_MIN, PROVIDER, CREATE_NAME,
 *   ONLY_DEALS, DATA_DIR
 *
 * Auth: reuses the CLI token (machine-id + cli-secret). Override with
 * ROUTER_API_KEY (Bearer). Needs a running 9Router (default http://localhost:20128).
 *
 * ponytail: deals come from per-provider scrape sources. Add a provider by
 * extending DEAL_SOURCES — there is no shared "all providers deals API" yet.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.resolve(HERE, "..", "open-sse", "providers", "registry");

const ROUTER_URL = process.env.ROUTER_URL || "http://localhost:20128";

const MODE = (process.env.MODE || (hasFlag("--mode") ? flagValue("--mode") : "deals")).toLowerCase();
const PROVIDER = process.env.PROVIDER || (hasFlag("--provider") ? flagValue("--provider") : "commandcode");
const DRY_RUN = !hasFlag("--apply");
const ONCE = hasFlag("--once");
const ONLY_DEALS = hasFlag("--only-deals") || process.env.ONLY_DEALS === "1";
const CHECK_ONLY = hasFlag("--check");
const CREATE_NAME = process.env.CREATE_NAME || (hasFlag("--create") ? flagValue("--create") : "");
const INTERVAL_MIN = parseInt(process.env.INTERVAL_MIN || (ONCE ? "0" : "60"), 10);

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

// Embedded fallback only used if the registry import for commandcode fails.
const EMBEDDED_COMMANDCODE = {
  id: "commandcode",
  models: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "zai-org/GLM-5", name: "GLM 5" },
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview" },
    { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus" },
    { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash" },
  ],
};

// --- per-provider deal sources ----------------------------------------------
// Add a provider here with a `scrape()` that returns [{ name, isDeal }].
async function scrapeCommandCode() {
  const html = await (await fetch("https://commandcode.ai/models")).text();
  return parseModelRows(html);
}
const DEAL_SOURCES = {
  commandcode: { scrape: scrapeCommandCode },
};

// --- tiny flag helpers -------------------------------------------------------
function hasFlag(f) {
  return process.argv.includes(f);
}
function flagValue(f) {
  const i = process.argv.indexOf(f);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "";
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

// --- model-row scraping (commandcode.ai style) -------------------------------
function normalize(s) {
  return String(s).toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function rowIsDeal(row) {
  if (/title="Off-peak shown/i.test(row)) return true;
  const m = row.match(/text-black no-underline[^>]*>([^<]+)<\/a>/i);
  if (m) {
    const t = m[1].trim().toLowerCase();
    if (t !== "+1" && /-?\d+%/.test(t)) return true;            // discount badge (-50%, -98%, ...)
    if (t === "free" && /title="Ends /i.test(row)) return true; // limited-time free (has an "Ends ..." date)
  }
  return false;
}
function parseModelRows(html) {
  const rows = html.split(/<tr[\s>]/i).slice(1);
  const out = [];
  for (const row of rows) {
    const nameMatch = row.match(/truncate text-white[^>]*>([^<]+)</);
    if (!nameMatch) continue;
    out.push({ name: nameMatch[1].trim(), isDeal: rowIsDeal(row) });
  }
  return out;
}

// --- load all provider catalogs from the registry ---------------------------
async function loadProviders() {
  let files = [];
  try {
    files = fs.readdirSync(REGISTRY_DIR).filter((f) => f.endsWith(".js") && f !== "index.js");
  } catch (e) {
    console.warn(`[warn] cannot read registry dir (${e.message})`);
  }
  const provs = [];
  for (const f of files) {
    try {
      const mod = await import(pathToFileURL(path.join(REGISTRY_DIR, f)).href);
      const p = mod.default;
      if (p && p.id && Array.isArray(p.models)) provs.push(p);
    } catch {
      /* skip files that don't parse as a provider registry */
    }
  }
  if (!provs.some((p) => p.id === "commandcode")) provs.push(EMBEDDED_COMMANDCODE);
  return provs;
}


// --- process one provider ----------------------------------------------------
async function runProvider(prov, source) {
  const prefix = prov.id;
  const catalog = prov.models || [];
  const idToName = new Map(catalog.map((m) => [m.id, m.name]));

  // 1) scrape deals
  let scraped = [];
  try {
    scraped = await source.scrape();
  } catch (e) {
    console.error(`[error] provider ${prefix}: deal scrape failed (${e.message})`);
    return;
  }
  const dealNames = scraped.filter((m) => m.isDeal).map((m) => normalize(m.name));

  // 2) resolve deal model ids within this provider's catalog
  const isDealName = (regName) => {
    const n = normalize(regName);
    return dealNames.some((d) => d.includes(n) || n.includes(d));
  };
  const targetNativeIds =
    MODE === "all" ? catalog.map((m) => m.id) : catalog.filter((m) => isDealName(m.name)).map((m) => m.id);

  // 3) confirm the prefix 9Router actually uses for this provider
  try {
    const r = await apiFetch("GET", "/v1/models");
    if (r.ok) {
      const arr = r.data?.data || r.data?.models || [];
      const ids = arr.map((m) => m.id).filter((id) => typeof id === "string" && id.startsWith(prefix + "/"));
      if (ids.length === 0) {
        console.warn(`[warn] provider ${prefix}: no models visible via /v1/models (verify the connection is active)`);
      }
    }
  } catch (e) {
    console.warn(`[warn] provider ${prefix}: /v1/models unreachable (${e.message})`);
  }

  const targetIds = targetNativeIds.map((id) => `${prefix}/${id}`);
  console.log(`[info] ${prefix}: ${dealNames.length} deal(s) on site; target = ${targetIds.length} id(s)`);
  if (targetIds.length === 0) {
    console.log(`[warn] ${prefix}: no target ids resolved — nothing to do`);
    return;
  }
  for (const id of targetIds) console.log(`        - ${id}  (${idToName.get(id.split("/").slice(1).join("/")) || "?"})`);

  if (CHECK_ONLY) return;

  // 4) load combos and update the provider-exclusive ones
  const cr = await apiFetch("GET", "/api/combos");
  if (!cr.ok) {
    console.error(`[error] provider ${prefix}: GET /api/combos failed: ${cr.status} ${JSON.stringify(cr.data)}`);
    return;
  }
  const combos = cr.data?.combos || [];
  const isProvOnly = (c) =>
    Array.isArray(c.models) && c.models.length > 0 && c.models.every((m) => m.startsWith(prefix + "/"));
  const isAllDeals = (c) =>
    Array.isArray(c.models) && c.models.length > 0 && c.models.every((m) => targetIds.includes(m));

  let selected = combos.filter(isProvOnly);
  if (ONLY_DEALS) selected = selected.filter(isAllDeals);
  console.log(`[info] ${prefix}: ${combos.length} combo(s) total; ${selected.length} selected`);

  let updated = 0,
    skipped = 0;
  for (const c of selected) {
    const changed = JSON.stringify(c.models) !== JSON.stringify(targetIds);
    if (!changed) {
      console.log(`[skip] ${c.name} already matches target`);
      skipped++;
      continue;
    }
    if (DRY_RUN) {
      console.log(`[dry-run] ${c.name}: ${c.models.join(" -> ")}  =>  ${targetIds.join(" -> ")}`);
      continue;
    }
    const ur = await apiFetch("PUT", `/api/combos/${c.id}`, { models: targetIds });
    if (ur.ok) {
      console.log(`[updated] ${c.name}`);
      updated++;
    } else {
      console.error(`[error] update ${c.name} failed: ${ur.status} ${JSON.stringify(ur.data)}`);
    }
  }

  if (CREATE_NAME) {
    const existing = combos.find((c) => c.name === CREATE_NAME);
    if (existing) {
      if (JSON.stringify(existing.models) === JSON.stringify(targetIds)) {
        console.log(`[skip] ${CREATE_NAME} already matches target`);
      } else if (DRY_RUN) {
        console.log(`[dry-run] would update dedicated combo ${CREATE_NAME} -> ${targetIds.join(", ")}`);
      } else {
        const ur = await apiFetch("PUT", `/api/combos/${existing.id}`, { models: targetIds });
        console.log(ur.ok ? `[updated] dedicated combo ${CREATE_NAME}` : `[error] dedicated combo ${CREATE_NAME}: ${ur.status}`);
      }
    } else if (DRY_RUN) {
      console.log(`[dry-run] would create dedicated combo ${CREATE_NAME} -> ${targetIds.join(", ")}`);
    } else {
      const cr2 = await apiFetch("POST", "/api/combos", { name: CREATE_NAME, models: targetIds });
      console.log(cr2.ok ? `[created] dedicated combo ${CREATE_NAME}` : `[error] create ${CREATE_NAME}: ${cr2.status}`);
    }
  }

  console.log(`[done] ${prefix}: updated=${updated} skipped=${skipped} dryRun=${DRY_RUN}`);
}

// --- entrypoint --------------------------------------------------------------
async function runOnce() {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] update-deal-combos — provider=${PROVIDER} mode=${MODE} dryRun=${DRY_RUN} onlyDeals=${ONLY_DEALS}`);
  const providers = await loadProviders();
  const targets =
    PROVIDER === "all"
      ? providers.filter((p) => DEAL_SOURCES[p.id])
      : providers.filter((p) => p.id === PROVIDER || (p.aliases || []).includes(PROVIDER));

  if (targets.length === 0) {
    console.error(`[error] no provider matched "${PROVIDER}" (have deal sources: ${Object.keys(DEAL_SOURCES).join(", ")})`);
    return;
  }
  for (const p of targets) {
    const src = DEAL_SOURCES[p.id];
    if (!src) {
      console.log(`[skip] provider ${p.id}: no deal source configured`);
      continue;
    }
    await runProvider(p, src);
  }
}

if (CHECK_ONLY) {
  runOnce().catch((e) => {
    console.error("[fatal]", e);
    process.exit(1);
  });
} else if (INTERVAL_MIN > 0) {
  runOnce().catch((e) => console.error("[fatal]", e));
  setInterval(() => runOnce().catch((e) => console.error("[fatal]", e)), INTERVAL_MIN * 60000);
  console.log(`[scheduler] looping every ${INTERVAL_MIN} min. Press Ctrl+C to stop.`);
} else {
  runOnce()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error("[fatal]", e);
      process.exit(1);
    });
}

