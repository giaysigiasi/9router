function providerIdFromModel(model) {
  if (typeof model !== "string") return "";
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "";
}

function connectionCanRoute(connection) {
  return connection?.isActive && Boolean(connection.apiKey || connection.accessToken);
}

/**
 * Resolve a model prefix to the provider connection identifier.
 * Checks providerNodeMap first (prefix → resolved node ID), then falls back to prefix itself.
 */
function resolveProviderForHealth(prefix, providerNodeMap) {
  if (providerNodeMap && providerNodeMap[prefix]) return providerNodeMap[prefix];
  return prefix;
}

export function getComboHealth(combo, connections = [], providerNodeMap = null) {
  const models = Array.isArray(combo?.models) ? combo.models.filter(Boolean) : [];
  if (models.length === 0) {
    return { status: "no-models", readyModels: 0, totalModels: 0, unavailableModels: [] };
  }

  const readyProviders = new Set(
    connections.filter(connectionCanRoute).map((connection) => connection.provider)
  );
  const unavailableModels = models.filter((model) => {
    const prefix = providerIdFromModel(model);
    const resolved = resolveProviderForHealth(prefix, providerNodeMap);
    return !readyProviders.has(resolved);
  });
  const readyModels = models.length - unavailableModels.length;

  return {
    status: readyModels === models.length ? "healthy" : readyModels ? "degraded" : "unavailable",
    readyModels,
    totalModels: models.length,
    unavailableModels,
  };
}

export function getCombosHealth(combos, connections, providerNodeMap = null) {
  return (Array.isArray(combos) ? combos : []).map((combo) => ({
    id: combo.id,
    name: combo.name,
    ...getComboHealth(combo, connections, providerNodeMap),
  }));
}
