import { NextResponse } from "next/server";
import { getComboById, updateCombo, getProviderConnections, getProviderNodes } from "@/lib/localDb";
import { getComboHealth } from "@/lib/comboHealth";
import { resetComboRotation } from "open-sse/services/combo.js";
import registryProviders from "open-sse/providers/registry";

// POST /api/combos/[id]/fix — Auto-fix a degraded combo by removing models
// whose providers have no active connection, keeping only routable models.
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const combo = await getComboById(id);

    if (!combo) {
      return NextResponse.json({ error: "Combo not found" }, { status: 404 });
    }

    const models = Array.isArray(combo.models) ? combo.models : [];
    if (models.length === 0) {
      return NextResponse.json({ error: "Combo has no models to fix" }, { status: 400 });
    }

    // Build provider node map (same logic as health route)
    const [connections, nodes] = await Promise.all([
      getProviderConnections(),
      getProviderNodes(),
    ]);
    const providerNodeMap = {};
    for (const node of nodes || []) {
      if (node.prefix && node.id) providerNodeMap[node.prefix] = node.id;
    }
    for (const entry of registryProviders) {
      if (!entry) continue;
      const canonical = entry.alias || entry.id;
      if (!canonical) continue;
      if (entry.id && entry.id !== canonical) providerNodeMap[entry.id] = canonical;
      if (entry.uiAlias) providerNodeMap[entry.uiAlias] = canonical;
      if (Array.isArray(entry.aliases)) {
        for (const a of entry.aliases) {
          if (a) providerNodeMap[a] = canonical;
        }
      }
    }

    // Check current health
    const health = getComboHealth(combo, connections, providerNodeMap);

    if (health.status === "healthy") {
      return NextResponse.json({
        fixed: false,
        message: "Combo is already healthy",
        health,
      });
    }

    // Remove unavailable models, keep only routable ones
    const unavailableSet = new Set(health.unavailableModels);
    const fixedModels = models.filter((m) => !unavailableSet.has(m));

    if (fixedModels.length === 0) {
      return NextResponse.json({
        fixed: false,
        message: "All models are unavailable — cannot auto-fix. Add models from active providers.",
        health,
      }, { status: 400 });
    }

    if (fixedModels.length === models.length) {
      return NextResponse.json({
        fixed: false,
        message: "No models to remove — degradation may be transient. Try probing health.",
        health,
      });
    }

    // Update combo with only healthy models
    const updated = await updateCombo(id, { models: fixedModels });
    if (combo?.name) resetComboRotation(combo.name);

    // Re-check health after fix
    const newHealth = getComboHealth(updated, connections, providerNodeMap);

    return NextResponse.json({
      fixed: true,
      removedModels: models.filter((m) => unavailableSet.has(m)),
      remainingModels: fixedModels,
      previousHealth: health,
      health: newHealth,
    });
  } catch (error) {
    console.log("Error auto-fixing combo:", error);
    return NextResponse.json({ error: "Failed to auto-fix combo" }, { status: 500 });
  }
}
