/**
 * Local Docker + API smoke test for 9Router combo health.
 * Automates everything that can be automated from a developer machine:
 *   1. Builds + starts the stack via `docker compose up --build -d`.
 *   2. Waits for /api/health.
 *   3. Lists combos (GET /api/combos) -> CSV/JSON.
 *   4. Asserts 2-hour poll cadence markers + modelTiers (GET /api/combos/health).
 *   5. Optionally POSTs live probes.
 *   6. Source-level checks: 3-tier cooldown classification + all-blocked 503.
 *   7. Tears down (docker compose down -v).
 *
 * Usage:
 *   node scripts/test-combo-local.mjs
 *   node scripts/test-combo-local.mjs --json | --csv        # write reports
 *   node scripts/test-combo-local.mjs --no-down             # leave stack running
 *   node scripts/test-combo-local.mjs --probe               # also POST live probes
 *   node scripts/test-combo-local.mjs --source-only         # skip Docker, checks only
 *
 * Env:
 *   BASE_URL   default http://localhost:20130
 *   API_KEY    9Router dashboard key (if auth is enabled)
 */
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";

const exec = promisify(execCb);
const BASE = process.env.BASE_URL || "http://localhost:20130";
const API_KEY = process.env.API_KEY || "";
const args = process.argv.slice(2);
const flags = {
  json: args.includes("--json"),
  csv: args.includes("--csv"),
  down: !args.includes("--no-down"),
  probe: args.includes("--probe"),
  sourceOnly: args.includes("--source-only"),
};

function c(str, msg) { console.log(`\x1b[36m${str}\x1b[0m ${msg}`); }
const log = {
  pass: (m) => console.log(`\x1b[32mPASS\x1b[0m ${m}`),
  fail: (m) => console.log(`\x1b[31mFAIL\x1b[0m ${m}`),
  info: (m) => c("...", m),
  warn: (m) => console.log(`\x1b[33mWARN\x1b[0m ${m}`),
};

const results = [];
function record(name, ok, detail = "") {
  results.push({ check: name, ok, detail: String(detail) });
  if (ok) log.pass(name);
  else log.fail(`${name} - ${detail || ""}`);
}

async function runDocker(cmd, { ignoreFailure = false } = {}) {
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 1024 * 1024 });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (e) {
    const out = { ok: false, stdout: String(e.stdout || "").trim(), stderr: String(e.stderr || "").trim() };
    if (!ignoreFailure) throw out;
    return out;
  }
}

async function daemonAvailable() {
  try {
    await runDocker('docker info --format "{{.ServerVersion}}"');
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    ...opts,
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  return { res, body };
}

async function waitForHealth(url, ms = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const { res } = await fetchJson(`${url}/api/health`, { method: "GET" });
      if (res.ok) return true;
    } catch { /* retry */ }
    await sleep(1000);
  }
  return false;
}

async function dockerCycle() {
  c("build", "Building 9router image (docker compose build)...");
  const build = await runDocker("docker compose build", { ignoreFailure: true });
  if (!build.ok) { record("image_build", false, build.stderr || build.stdout); return false; }
  record("image_build", true);

  c("up", "Starting stack (docker compose up -d)...");
  const up = await runDocker("docker compose up -d", { ignoreFailure: true });
  if (!up.ok) { record("compose_up", false, up.stderr || up.stdout); return false; }
  record("compose_up", true);

  c("wait", `Waiting for /api/health at ${BASE} ...`);
  const healthy = await waitForHealth(BASE);
  record("api_health", healthy, healthy ? "" : "never became healthy");
  return healthy;
}

async function listCombos() {
  c("list", "GET /api/combos");
  const { res, body } = await fetchJson(`${BASE}/api/combos`);
  const ok = res.ok && Array.isArray(body?.combos);
  record("list_combos", ok, ok ? "" : `status=${res.status}`);
  if (!ok) return [];
  if (flags.json) { writeFileSync("combos.json", JSON.stringify(body.combos, null, 2), "utf8"); c("out", "wrote combos.json"); }
  if (flags.csv) {
    const rows = body.combos.map((m) => `${m.id},${m.name},${Array.isArray(m.models) ? m.models.length : 0},${m.kind || ""}`);
    writeFileSync("combos.csv", "id,name,models,kind\n" + rows.join("\n"), "utf8");
    c("out", "wrote combos.csv");
  }
  c("found", `${body.combos.length} combo(s): ${body.combos.map((m) => m.name).join(", ") || "(none)"}`);
  return body.combos;
}

async function fetchHealth() {
  c("health", "GET /api/combos/health");
  const { res, body } = await fetchJson(`${BASE}/api/combos/health`);
  const ok = res.ok && Array.isArray(body?.health);
  record("health_endpoint", ok, `status=${res.status}`);
  if (!ok) return;
  // 2-hour poll cadence markers (exposed by backgroundComboHealthPoll)
  const lastPollOk = body.lastPollAt !== null && typeof body.lastPollAt === "string";
  const countOk = typeof body.pollComboCount === "number";
  record("poll_cadence_markers", lastPollOk && countOk,
    `lastPollAt=${body.lastPollAt} pollComboCount=${body.pollComboCount}`);
  // Runtime tier status projected into health entries
  const withTiers = body.health.some((h) => Array.isArray(h.modelTiers));
  record("modelTiers_present", withTiers, withTiers ? "" : "no modelTiers array in any health entry");
  if (flags.json) {
    writeFileSync("combos-health.json", JSON.stringify(body, null, 2), "utf8");
    c("out", "wrote combos-health.json");
  }
}

async function liveProbes() {
  c("probe", "POST /api/combos/health (live probes)...");
  const { res, body } = await fetchJson(`${BASE}/api/combos/health`, { method: "POST", body: "" });
  const ok = res.ok && Array.isArray(body?.probes);
  record("live_probes", ok, ok ? "" : `status=${res.status} body=${JSON.stringify(body).slice(0, 120)}`);
}

async function sourceChecks() {
  c("source", "Source-level cooldown + all-blocked checks...");
  const { classifyProbeCooldown, PROBE_COOLDOWN } = await import("./lib/probe-cooldown.mjs");

  const quota = classifyProbeCooldown(429, "rate limit exceeded");
  const other = classifyProbeCooldown(401, "invalid api key");
  const transient = classifyProbeCooldown(null, "connection refused");
  record("cooldown_quota_15m", quota === 15 * 60 * 1000, `got ${quota}`);
  record("cooldown_other_5m", other === 5 * 60 * 1000, `got ${other}`);
  record("cooldown_transient_2m", transient === 2 * 60 * 1000, `got ${transient}`);
  c("cfg", `PROBE_COOLDOWN = ${JSON.stringify(PROBE_COOLDOWN)}`);

  const {
    handleComboChat,
    markComboModelQuotaBlocked,
    getComboModelTiers,
    resetComboRotation,
    getEarliestComboBlockExpiry,
    } = await import("../open-sse/services/combo.js");

  // All-blocked early exit: 503 + Retry-After, zero upstream calls.
  resetComboRotation();
  const models = ["a/b", "c/d"];
  markComboModelQuotaBlocked("smoke-combo", "a/b", 30_000);
  markComboModelQuotaBlocked("smoke-combo", "c/d", 30_000);

  const calls = [];
  const result = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (_b, model) => {
      calls.push(model);
      return { ok: false, status: 500, statusText: "fail" };
    },
    log: { info() {}, warn() {}, error() {} },
    comboName: "smoke-combo",
    comboStrategy: "fallback",
  });
  record("all_blocked_503", !result.ok && result.status === 503, `status=${result.status}`);
  record("all_blocked_zero_calls", calls.length === 0, `made ${calls.length} upstream call(s)`);
  record("all_blocked_retry_after", result.headers.get("Retry-After") != null,
    `Retry-After=${result.headers.get("Retry-After")}`);
  record("earliest_block_expiry", getEarliestComboBlockExpiry("smoke-combo") != null, "");
  record("tier_exhausted",
    (() => {
      const t = getComboModelTiers("smoke-combo", models);
      return t.every((m) => m.tier === "exhausted" || m.tier === "retryable");
    })(),
    JSON.stringify(getComboModelTiers("smoke-combo", models)));

  // Expired block: combo proceeds normally.
  resetComboRotation();
  markComboModelQuotaBlocked("smoke-expiry", "a/b", 50);
  await sleep(70);
  const expCalls = [];
  const expRes = await handleComboChat({
    body: { messages: [{ role: "user", content: "hi" }] },
    models,
    handleSingleModel: async (_b, model) => {
      expCalls.push(model);
      return { ok: true, status: 200 };
    },
    log: { info() {}, warn() {}, error() {} },
    comboName: "smoke-expiry",
    comboStrategy: "fallback",
  });
  record("expired_block_proceeds", expRes.ok && expCalls.length === 1, `ok=${expRes.ok} calls=${expCalls.length}`);

  return results;
}

async function teardown() {
  if (!flags.down) return;
  c("down", "Tearing down (docker compose down -v)...");
  await runDocker("docker compose down -v", { ignoreFailure: true });
}

async function writeReport() {
  const summary = {
    base: BASE,
    checks: results,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
  if (flags.json) {
    writeFileSync("test-combo-local-report.json", JSON.stringify(summary, null, 2), "utf8");
    c("out", "wrote test-combo-local-report.json");
  }
  if (flags.csv) {
    const rows = results.map((r) => `${r.check},${r.ok ? "1" : "0"},"${r.detail.replace(/"/g, '""')}"`).join("\n");
    writeFileSync("test-combo-local-report.csv", "check,ok,detail\n" + rows, "utf8");
    c("out", "wrote test-combo-local-report.csv");
  }
  return summary;
}

(async () => {
  if (flags.sourceOnly) {
    await sourceChecks();
    const s = await writeReport();
    console.log(`\nsummary: ${s.passed}/${results.length} passed`);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
    return;
  }

  const haveDocker = await daemonAvailable();
  if (!haveDocker) {
    log.warn("No Docker daemon reachable - skipping container smoke. Running source-level checks only.");
    await sourceChecks();
    const s = await writeReport();
    console.log(`\nsummary: ${s.passed}/${results.length} passed`);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
    return;
  }

  try {
    const healthy = await dockerCycle();
    if (!healthy) throw new Error("container did not become healthy");
    await listCombos();
    await fetchHealth();
    if (flags.probe) await liveProbes();
    await sourceChecks();
    const s = await writeReport();
    console.log(`\nsummary: ${s.passed}/${results.length} passed`);
    process.exit(results.some((r) => !r.ok) ? 1 : 0);
  } catch (e) {
    log.fail(`Fatal: ${e?.message || e}`);
    record("fatal", false, String(e?.message || e));
    if (flags.down) await teardown();
    process.exit(1);
  } finally {
    if (flags.down) await teardown();
  }
})().catch((e) => { console.error(e); process.exit(1); });