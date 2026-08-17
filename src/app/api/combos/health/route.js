import { NextResponse } from "next/server";
import { getCombos, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { getCombosHealth } from "@/lib/comboHealth";
import { pingModelByKind } from "@/app/api/models/test/ping";
import { makeKv } from "@/lib/db/helpers/kvStore";
import registryProviders from "open-sse/providers/registry";

export const dynamic = "force-dynamic";

const probesKv = makeKv("comboHealth");
const PROBE_STALE_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    const [combos, connections, nodes, cachedProbes] = await Promise.all([
      getCombos(),
      getProviderConnections(),
      getProviderNodes(),
      probesKv.getAll().catch(() => ({})),
    ]);
    // Build prefix → canonical provider ID map for health resolution
    const providerNodeMap = {};
    // 1) Custom DB provider-nodes: prefix → node ID
    for (const node of nodes || []) {
      if (node.prefix && node.id) providerNodeMap[node.prefix] = node.id;
    }
    // 2) Built-in registry providers: uiAlias/aliases → alias
    for (const entry of registryProviders) {
      if (!entry) continue;
      const canonical = entry.alias || entry.id;
      if (!canonical) continue;
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
    return NextResponse.json({ health });
  } catch (error) {
    console.log("Error fetching combo health:", error);
    return NextResponse.json({ error: "Failed to fetch combo health" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const combos = (await getCombos()).filter((combo) => !combo.kind || combo.kind === "llm");
    const probes = await Promise.all(combos.map(async (combo) => {
      const result = await pingModelByKind(combo.name, "chat");
      return {
        id: combo.id,
        name: combo.name,
        status: result.ok ? "healthy" : "unavailable",
        latencyMs: result.latencyMs,
        error: result.error,
        checkedAt: new Date().toISOString(),
      };
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