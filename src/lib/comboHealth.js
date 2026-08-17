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

/**
 * Build a reverse map from resolved provider ID → all original prefixes that map to it.
 * This allows health checks to match connections whose .provider field may be a
 * custom provider-node UUID that got registered under a different prefix.
 */
function buildReverseNodeMap(providerNodeMap) {
  const reverse = {};
  if (!providerNodeMap) return reverse;
  for (const [prefix, resolved] of Object.entries(providerNodeMap)) {
    if (resolved !== prefix) {
      if (!reverse[resolved]) reverse[resolved] = [];
      reverse[resolved].push(prefix);
    }
  }
  return reverse;
}

export function getComboHealth(combo, connections = [], providerNodeMap = null) {
  const models = Array.isArray(combo?.models) ? combo.models.filter(Boolean) : [];
  if (models.length === 0) {
    return { status: "no-models", readyModels: 0, totalModels: 0, unavailableModels: [] };
  }

  // Build set of ready provider identifiers from active connections.
  // Resolve each connection.provider through providerNodeMap so both the raw
  // ID (e.g. "kilo-gateway") and its canonical alias (e.g. "kgw") are marked ready.
  const readyProviders = new Set();
  for (const conn of connections) {
    if (!connectionCanRoute(conn)) continue;
    const raw = conn.provider;
    readyProviders.add(raw);
    // Resolve to canonical if providerNodeMap has it
    if (providerNodeMap && providerNodeMap[raw]) {
      readyProviders.add(providerNodeMap[raw]);
    }
  }
  // Also build reverse: for each ready provider, find what prefixes it covers
  const reverseMap = buildReverseNodeMap(providerNodeMap);
  for (const provider of readyProviders) {
    // If this provider maps from some prefix, that prefix is also "ready"
    if (reverseMap[provider]) {
      for (const prefix of reverseMap[provider]) {
        readyProviders.add(prefix);
      }
    }
  }

  const unavailableModels = models.filter((model) => {
    const prefix = providerIdFromModel(model);
    const resolved = resolveProviderForHealth(prefix, providerNodeMap);
    return !readyProviders.has(resolved) && !readyProviders.has(prefix);
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
  return (Array.isArray(combos) ? combos : [])
    .filter(Boolean)
    .map((combo) => ({
      id: combo.id,
      name: combo.name,
      ...getComboHealth(combo, connections, providerNodeMap),
    }));
}
