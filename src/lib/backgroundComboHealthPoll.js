// Background combo health polling — probes all combos every 2 hours and caches
// results in the same KV store used by GET /api/combos/health.
// Follows the same fail-open pattern as backgroundTokenRefresh.js.

import { getCombos, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { curateAutoCombos } from "@/lib/combos/autoCurate.js";
import { getCombosHealth } from "@/lib/comboHealth";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { makeKv } from "@/lib/db/helpers/kvStore";
import { markComboModelQuotaBlocked } from "open-sse/services/combo.js";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import registryProviders from "open-sse/providers/registry";

const probesKv = makeKv("comboHealth");

/** Poll interval: 2 hours (configurable via COMBO_HEALTH_POLL_MS env). */
const POLL_INTERVAL_MS = Number(process.env.COMBO_HEALTH_POLL_MS) || 2 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 30 * 1000; // 30s after boot

// Probe cooldown tiers — maps error classification to auto-push-to-tail duration.
const PROBE_COOLDOWN = {
  quota:     15 * 60 * 1000,  // rate-limit / quota: 15 min
  other:      5 * 60 * 1000,  // auth / hard failure: 5 min
  transient:  2 * 60 * 1000,  // unknown / connection: 2 min
};

/**
 * Classify a probe result and return the appropriate cooldown duration (ms)
 * or 0 if the probe should NOT block the model.
 */
function classifyProbeCooldown(status, errorText) {
  if (status == null) {
    return PROBE_COOLDOWN.transient;
  }
  const { cooldownMs, reason } = checkFallbackError(status, errorText || "");
  if (!cooldownMs || cooldownMs <= 0) return 0;
  return PROBE_COOLDOWN[reason] ?? PROBE_COOLDOWN.transient;
}

let started = false;
let intervalHandle = null;
let initialTimeoutHandle = null;
let tickRunning = false;

function isNonServerRuntime() {
  if (typeof window !== "undefined") return true;
  const phase = process.env.NEXT_PHASE || "";
  if (phase === "phase-production-build" || phase === "phase-export" || phase === "phase-static") return true;
  if (process.env.NEXT_RUNTIME === "edge") return true;
  return false;
}

function buildProviderNodeMap(nodes) {
  const map = {};
  for (const node of nodes || []) {
    if (node.prefix && node.id) map[node.prefix] = node.id;
  }
  for (const entry of registryProviders) {
    if (!entry) continue;
    const canonical = entry.alias || entry.id;
    if (!canonical) continue;
    if (entry.id && entry.id !== canonical) map[entry.id] = canonical;
    if (entry.uiAlias) map[entry.uiAlias] = canonical;
    if (Array.isArray(entry.aliases)) {
      for (const a of entry.aliases) {
        if (a) map[a] = canonical;
      }
    }
  }
  return map;
}

async function tick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const combos = (await getCombos()).filter((c) => !c.kind || c.kind === "llm");
    if (combos.length === 0) return;

    const [connections, nodes] = await Promise.all([
      getProviderConnections(),
      getProviderNodes(),
    ]);
    const providerNodeMap = buildProviderNodeMap(nodes);

    // Static health (instant — from connection status)
    const staticHealth = getCombosHealth(combos, connections, providerNodeMap);

    // Live probes for each combo
    const probes = await Promise.all(combos.map(async (combo) => {
      try {
        const result = await pingModelByKind(combo.name, "chat");
        const degraded = !result.ok;
        if (degraded && Array.isArray(combo.models)) {
          const modelProbes = await Promise.all(combo.models.map(async (m) => {
            try {
              const r = await pingModelByKind(m, "chat");
              return { model: m, ok: r.ok, status: r.status ?? null, error: r.error ?? null };
            } catch { return { model: m, ok: false, status: null, error: "probe threw" }; }
          }));
          const pushedToTail = [];
          for (const mp of modelProbes) {
            if (!mp.ok) {
              const cooldownMs = classifyProbeCooldown(mp.status, mp.error);
              if (cooldownMs > 0) {
                markComboModelQuotaBlocked(combo.name, mp.model, cooldownMs);
                pushedToTail.push(mp.model);
              }
            }
          }
          return {
            id: combo.id, name: combo.name, status: "degraded",
            latencyMs: result.latencyMs, error: result.error,
            checkedAt: new Date().toISOString(),
            modelProbes: modelProbes.map(mp => ({ model: mp.model, ok: mp.ok })),
            autoPushedToTail: pushedToTail,
          };
        }
        return {
          id: combo.id, name: combo.name,
          status: result.ok ? "healthy" : "unavailable",
          latencyMs: result.latencyMs, error: result.error,
          checkedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: combo.id, name: combo.name, status: "unavailable",
          error: err?.message || "probe failed",
          checkedAt: new Date().toISOString(),
        };
      }
    }));

    // Merge static health + probe data, store in KV
    const now = Date.now();
    const merged = {};
    for (const h of staticHealth) {
      const probe = probes.find((p) => p.id === h.id);
      if (probe) {
        h.probe = probe;
        h.probeStale = false;
      }
      h.lastPollAt = new Date(now).toISOString();
      merged[h.id] = h;
    }
    // Store individual probe results for the GET endpoint
    const probeMap = {};
    for (const p of probes) probeMap[p.id] = p;
    await probesKv.setMany(probeMap);

    // Store poll metadata
    const metaKv = makeKv("comboHealthMeta");
    await metaKv.setMany({ _lastPollAt: { value: new Date(now).toISOString(), combos: combos.length } });

    // Re-derive auto combos (role-*/auto-* names) from this tick's healthy set
    await curateAutoCombos({ combos, staticHealth, probes }).catch((e) => {
      console.error("[ComboAutoCurate] error:", e?.message || e);
    });

    console.log(`[ComboHealthPoll] Polled ${combos.length} combos (${probes.filter(p => p.status === "healthy").length} healthy)`);
  } catch (err) {
    console.error("[ComboHealthPoll] tick error:", err?.message || err);
  } finally {
    tickRunning = false;
  }
}

export function startBackgroundComboHealthPoll() {
  if (started || isNonServerRuntime()) return;
  started = true;
  initialTimeoutHandle = setTimeout(() => {
    tick().catch(() => {});
    intervalHandle = setInterval(() => { tick().catch(() => {}); }, POLL_INTERVAL_MS);
  }, INITIAL_DELAY_MS);
}

export function stopBackgroundComboHealthPoll() {
  started = false;
  if (initialTimeoutHandle) { clearTimeout(initialTimeoutHandle); initialTimeoutHandle = null; }
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}