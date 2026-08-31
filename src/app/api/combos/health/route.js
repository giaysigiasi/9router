import { NextResponse } from "next/server";
import { getCombos, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { getCombosHealth } from "@/lib/comboHealth";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { makeKv } from "@/lib/db/helpers/kvStore";
import { markComboModelQuotaBlocked } from "open-sse/services/combo.js";
import registryProviders from "open-sse/providers/registry";

export const dynamic = "force-dynamic";

const probesKv = makeKv("comboHealth");
const PROBE_STALE_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const metaKv = makeKv("comboHealthMeta");
    const [combos, connections, nodes, cachedProbes, pollMeta] = await Promise.all([
      getCombos(),
      getProviderConnections(),
      getProviderNodes(),
      probesKv.getAll().catch(() => ({})),
      metaKv.get("_lastPollAt").catch(() => null),
    ]);
    // Build prefix → canonical provider ID map for health resolution
    const providerNodeMap = {};
    // 1) Custom DB provider-nodes: prefix → node ID
    for (const node of nodes || []) {
      if (node.prefix && node.id) providerNodeMap[node.prefix] = node.id;
    }
    // 2) Built-in registry providers: uiAlias/aliases/id → canonical alias
    for (const entry of registryProviders) {
      if (!entry) continue;
      const canonical = entry.alias || entry.id;
      if (!canonical) continue;
      // Map entry.id → canonical so connection.provider (which uses id) resolves
      if (entry.id && entry.id !== canonical) providerNodeMap[entry.id] = canonical;
      if (entry.uiAlias) providerNodeMap[entry.uiAlias] = canonical;
      if (Array.isArray(entry.aliases)) {
        for (const a of entry.aliases) {
          if (a) providerNodeMap[a] = canonical;
        }
      }
    }
    const health = getCombosHealth(combos, connections, providerNodeMap);
    // Attach cached probe data (with staleness flag)
    const now = Date.now();
    for (const h of health) {
      const probe = cachedProbes[h.id];
      if (probe) {
        h.probe = probe;
        h.probeStale = !probe.checkedAt || (now - new Date(probe.checkedAt).getTime()) > PROBE_STALE_MS;
      }
    }
    return NextResponse.json({
      health,
      lastPollAt: pollMeta?.value || null,
      pollComboCount: pollMeta?.combos || null,
    });
  } catch (error) {
    console.log("Error fetching combo health:", error);
    return NextResponse.json({ error: "Failed to fetch combo health" }, { status: 500 });
  }
}

const DEGRADE_COOLDOWN_MS = 15 * 60 * 1000; // 15 min auto-push-to-tail

export async function POST() {
  try {
    const combos = (await getCombos()).filter((combo) => !combo.kind || combo.kind === "llm");
    const probes = await Promise.all(combos.map(async (combo) => {
      try {
        const result = await pingModelByKind(combo.name, "chat");
        const degraded = !result.ok;
        // Auto-move-to-tail: mark individual models that are degraded
        if (degraded && Array.isArray(combo.models)) {
          // Probe each model individually to find which ones are degraded
          const modelProbes = await Promise.all(combo.models.map(async (m) => {
            try {
              const r = await pingModelByKind(m, "chat");
              return { model: m, ok: r.ok };
            } catch { return { model: m, ok: false }; }
          }));
          for (const mp of modelProbes) {
            if (!mp.ok) {
              markComboModelQuotaBlocked(combo.name, mp.model, DEGRADE_COOLDOWN_MS);
            }
          }
          return {
            id: combo.id,
            name: combo.name,
            status: "degraded",
            latencyMs: result.latencyMs,
            error: result.error,
            checkedAt: new Date().toISOString(),
            modelProbes: modelProbes.map(mp => ({ model: mp.model, ok: mp.ok })),
            autoPushedToTail: modelProbes.filter(mp => !mp.ok).map(mp => mp.model),
          };
        }
        return {
          id: combo.id,
          name: combo.name,
          status: result.ok ? "healthy" : "unavailable",
          latencyMs: result.latencyMs,
          error: result.error,
          checkedAt: new Date().toISOString(),
        };
      } catch (err) {
        return {
          id: combo.id,
          name: combo.name,
          status: "unavailable",
          error: err?.message || "probe failed",
          checkedAt: new Date().toISOString(),
        };
      }
    }));
    // Cache probe results in KV for the GET endpoint
    const probeMap = {};
    for (const p of probes) probeMap[p.id] = p;
    await probesKv.setMany(probeMap);
    return NextResponse.json({ probes });
  } catch (error) {
    console.log("Error probing combo health:", error);
    return NextResponse.json({ error: "Failed to probe combo health" }, { status: 500 });
  }
}
