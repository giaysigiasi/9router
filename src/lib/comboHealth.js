function providerIdFromModel(model) {
  if (typeof model !== "string") return "";
  const slash = model.indexOf("/");
  return slash > 0 ? model.slice(0, slash) : "";
}

function connectionCanRoute(connection) {
  return connection?.isActive && Boolean(connection.apiKey || connection.accessToken);
}

export function getComboHealth(combo, connections = []) {
  const models = Array.isArray(combo?.models) ? combo.models.filter(Boolean) : [];
  if (models.length === 0) {
    return { status: "no-models", readyModels: 0, totalModels: 0, unavailableModels: [] };
  }

  const readyProviders = new Set(
    connections.filter(connectionCanRoute).map((connection) => connection.provider)
  );
  const unavailableModels = models.filter((model) => !readyProviders.has(providerIdFromModel(model)));
  const readyModels = models.length - unavailableModels.length;

  return {
    status: readyModels === models.length ? "healthy" : readyModels ? "degraded" : "unavailable",
    readyModels,
    totalModels: models.length,
    unavailableModels,
  };
}

export function getCombosHealth(combos, connections) {
  return (Array.isArray(combos) ? combos : []).map((combo) => ({
    id: combo.id,
    name: combo.name,
    ...getComboHealth(combo, connections),
  }));
}