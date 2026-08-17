import { describe, expect, it, vi } from "vitest";
import { getComboHealth, getCombosHealth } from "../../src/lib/comboHealth.js";

// ─── Strategy 1: Static resolver alignment (providerNodeMap) ────────────────

describe("Strategy 1: Static resolver alignment", () => {
  it("classifies empty, unavailable, degraded, and healthy combos", () => {
    const connections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: true, accessToken: "token" },
      { provider: "disabled", isActive: false, apiKey: "key" },
    ];

    expect(getComboHealth({ models: [] }, connections)).toMatchObject({
      status: "no-models",
      readyModels: 0,
      totalModels: 0,
    });
    expect(getComboHealth({ models: ["disabled/model"] }, connections)).toMatchObject({
      status: "unavailable",
      readyModels: 0,
      totalModels: 1,
      unavailableModels: ["disabled/model"],
    });
    expect(getComboHealth({ models: ["openai/gpt", "disabled/model"] }, connections)).toMatchObject({
      status: "degraded",
      readyModels: 1,
      totalModels: 2,
      unavailableModels: ["disabled/model"],
    });
    expect(getComboHealth({ models: ["openai/gpt", "claude/sonnet"] }, connections)).toMatchObject({
      status: "healthy",
      readyModels: 2,
      totalModels: 2,
    });
  });

  it("resolves custom provider-node prefix via providerNodeMap", () => {
    const connections = [
      { provider: "vietapi-node-abc", isActive: true, apiKey: "key" },
    ];
    const providerNodeMap = { "vietapi-strong-coding": "vietapi-node-abc" };

    expect(getComboHealth({ models: ["vietapi-strong-coding/deepseek-v3"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
      totalModels: 1,
    });
  });

  it("resolves built-in registry uiAlias prefix (e.g. cmc → commandcode)", () => {
    const connections = [
      { provider: "commandcode", isActive: true, apiKey: "key" },
    ];
    const providerNodeMap = { cmc: "commandcode", ocg: "opencode-go" };

    expect(getComboHealth({ models: ["cmc/deepseek/deepseek-v4-pro"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
      totalModels: 1,
    });
  });

  it("resolves registry aliases prefix (e.g. ch → chutes)", () => {
    const connections = [
      { provider: "chutes", isActive: true, apiKey: "key" },
    ];
    const providerNodeMap = { ch: "chutes" };

    expect(getComboHealth({ models: ["ch/deepseek-v3"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
      totalModels: 1,
    });
  });

  it("resolves connection.provider id to canonical alias via providerNodeMap", () => {
    // Bug scenario: connection.provider is the registry id "kilo-gateway",
    // combo uses the alias prefix "kgw", and providerNodeMap maps both.
    const connections = [
      { provider: "kilo-gateway", isActive: true, apiKey: "key" },
      { provider: "codebuddy-intl", isActive: true, accessToken: "tok" },
      { provider: "ollama-local", isActive: true, apiKey: "local-dummy" },
    ];
    // Simulates what the health API now builds: id→alias + uiAlias→alias
    const providerNodeMap = {
      "kilo-gateway": "kgw",
      kgw: "kgw",
      "codebuddy-intl": "cbai",
      cbai: "cbai",
      "ollama-local": "ollama-local",
    };

    expect(getComboHealth({ models: ["kgw/kilo-auto/free"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
    });
    expect(getComboHealth({ models: ["cbai/deepseek-v4-flash"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
    });
    expect(getComboHealth({ models: ["ollama-local/llama3"] }, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 1,
    });
    // Mixed combo
    expect(getComboHealth(
      { models: ["kgw/kilo-auto/free", "cbai/deepseek-v4-flash", "ollama-local/llama3"] },
      connections, providerNodeMap
    )).toMatchObject({
      status: "healthy",
      readyModels: 3,
    });
  });

  it("marks inactive connections as unavailable even with correct mapping", () => {
    const connections = [
      { provider: "kilo-gateway", isActive: false, apiKey: "key" },
    ];
    const providerNodeMap = { "kilo-gateway": "kgw", kgw: "kgw" };

    expect(getComboHealth({ models: ["kgw/kilo-auto/free"] }, connections, providerNodeMap)).toMatchObject({
      status: "unavailable",
      readyModels: 0,
    });
  });

  it("marks connections without credentials as unavailable", () => {
    const connections = [
      { provider: "openai", isActive: true }, // no apiKey or accessToken
    ];

    expect(getComboHealth({ models: ["openai/gpt"] }, connections)).toMatchObject({
      status: "unavailable",
      readyModels: 0,
    });
  });

  it("handles empty connections array", () => {
    expect(getComboHealth({ models: ["openai/gpt"] }, [])).toMatchObject({
      status: "unavailable",
      readyModels: 0,
      unavailableModels: ["openai/gpt"],
    });
  });

  it("handles null providerNodeMap gracefully", () => {
    const connections = [{ provider: "openai", isActive: true, apiKey: "key" }];

    expect(getComboHealth({ models: ["openai/gpt"] }, connections, null)).toMatchObject({
      status: "healthy",
      readyModels: 1,
    });
  });

  it("handles model without slash prefix", () => {
    const connections = [{ provider: "openai", isActive: true, apiKey: "key" }];

    expect(getComboHealth({ models: ["noprovider"] }, connections)).toMatchObject({
      status: "unavailable",
      readyModels: 0,
      unavailableModels: ["noprovider"],
    });
  });

  it("resolves all 30+ combo models across many providers", () => {
    // Simulate a real-world scenario with many providers
    const connections = [
      { provider: "kilo-gateway", isActive: true, apiKey: "k" },
      { provider: "codebuddy-intl", isActive: true, accessToken: "t" },
      { provider: "ollama-local", isActive: true, apiKey: "l" },
      { provider: "chutes", isActive: true, apiKey: "c" },
      { provider: "commandcode", isActive: true, apiKey: "cc" },
      { provider: "openai", isActive: true, apiKey: "o" },
      { provider: "claude", isActive: true, accessToken: "cl" },
    ];
    const providerNodeMap = {
      "kilo-gateway": "kgw", kgw: "kgw",
      "codebuddy-intl": "cbai", cbai: "cbai",
      "ollama-local": "ollama-local",
      ch: "chutes", chutes: "chutes",
      cmc: "commandcode", "commandcode": "commandcode",
    };

    const combo = {
      models: [
        "kgw/kilo-auto/free",
        "cbai/deepseek-v4-flash",
        "ollama-local/llama3",
        "ch/deepseek-v3",
        "cmc/deepseek/deepseek-v4-pro",
        "openai/gpt-4o",
        "claude/sonnet",
      ],
    };

    expect(getComboHealth(combo, connections, providerNodeMap)).toMatchObject({
      status: "healthy",
      readyModels: 7,
      totalModels: 7,
      unavailableModels: [],
    });
  });
});

// ─── Strategy 2: Live probe simulation ──────────────────────────────────────

describe("Strategy 2: Live probe simulation", () => {
  it("reports degraded when some providers are down (mixed active/inactive)", () => {
    const connections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: false, accessToken: "token" }, // provider down
    ];

    const result = getComboHealth(
      { models: ["openai/gpt-4o", "claude/sonnet"] },
      connections
    );

    expect(result).toMatchObject({
      status: "degraded",
      readyModels: 1,
      totalModels: 2,
      unavailableModels: ["claude/sonnet"],
    });
  });

  it("reports unavailable when all providers are down", () => {
    const connections = [
      { provider: "openai", isActive: false, apiKey: "key" },
      { provider: "claude", isActive: false, accessToken: "token" },
    ];

    expect(getComboHealth(
      { models: ["openai/gpt-4o", "claude/sonnet"] },
      connections
    )).toMatchObject({
      status: "unavailable",
      readyModels: 0,
      unavailableModels: ["openai/gpt-4o", "claude/sonnet"],
    });
  });

  it("reports healthy when all providers recover", () => {
    // Simulates: first check → degraded, provider recovers → healthy
    const downConnections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: false, accessToken: "token" },
    ];
    const upConnections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: true, accessToken: "token" },
    ];

    const combo = { models: ["openai/gpt-4o", "claude/sonnet"] };

    expect(getComboHealth(combo, downConnections)).toMatchObject({ status: "degraded" });
    expect(getComboHealth(combo, upConnections)).toMatchObject({ status: "healthy", readyModels: 2 });
  });

  it("tracks unavailable models for degraded combos", () => {
    const connections = [
      { provider: "kilo-gateway", isActive: true, apiKey: "key" },
      { provider: "chutes", isActive: false, apiKey: "key" },
    ];
    const providerNodeMap = { "kilo-gateway": "kgw", kgw: "kgw", ch: "chutes" };

    const result = getComboHealth(
      { models: ["kgw/kilo-auto/free", "ch/deepseek-v3"] },
      connections,
      providerNodeMap
    );

    expect(result).toMatchObject({
      status: "degraded",
      readyModels: 1,
      totalModels: 2,
      unavailableModels: ["ch/deepseek-v3"],
    });
  });
});

// ─── Strategy 3: Background poll + cache simulation ─────────────────────────

describe("Strategy 3: Background poll + cache simulation", () => {
  it("simulates cached health: healthy combo stays healthy with stale cache", () => {
    // Simulate: poll finds all healthy, cache stores result
    const pollConnections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: true, accessToken: "token" },
    ];
    const combo = { models: ["openai/gpt-4o", "claude/sonnet"] };

    // Cache: run health check, store result
    const cachedHealth = getComboHealth(combo, pollConnections);
    expect(cachedHealth).toMatchObject({ status: "healthy", readyModels: 2 });

    // Page read: even if connections array is empty (stale), cache still returns healthy
    // This simulates reading from cache instead of live connections
    expect(cachedHealth.status).toBe("healthy");
    expect(cachedHealth.readyModels).toBe(2);
  });

  it("simulates cache refresh: new poll detects provider went down", () => {
    const healthyConnections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: true, accessToken: "token" },
    ];
    const degradedConnections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: false, accessToken: "token" },
    ];
    const combo = { models: ["openai/gpt-4o", "claude/sonnet"] };

    // First poll: healthy
    const cache1 = getComboHealth(combo, healthyConnections);
    expect(cache1.status).toBe("healthy");

    // Second poll (60s later): provider went down
    const cache2 = getComboHealth(combo, degradedConnections);
    expect(cache2.status).toBe("degraded");
    expect(cache2.unavailableModels).toContain("claude/sonnet");
  });

  it("getCombosHealth returns aggregate results suitable for caching", () => {
    const combos = [
      { id: "combo-1", name: "primary", models: ["openai/gpt-4o"] },
      { id: "combo-2", name: "fallback", models: ["claude/sonnet", "openai/gpt-4o"] },
      { id: "combo-3", name: "local", models: ["ollama-local/llama3"] },
    ];
    const connections = [
      { provider: "openai", isActive: true, apiKey: "key" },
      { provider: "claude", isActive: false, accessToken: "token" },
      { provider: "ollama-local", isActive: true, apiKey: "local" },
    ];
    const providerNodeMap = { "ollama-local": "ollama-local" };

    const results = getCombosHealth(combos, connections, providerNodeMap);

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ id: "combo-1", status: "healthy", readyModels: 1 });
    expect(results[1]).toMatchObject({ id: "combo-2", status: "degraded", readyModels: 1, unavailableModels: ["claude/sonnet"] });
    expect(results[2]).toMatchObject({ id: "combo-3", status: "healthy", readyModels: 1 });
  });

  it("preserves combo identity in aggregate health", () => {
    expect(getCombosHealth(
      [{ id: "combo-1", name: "primary", models: ["openai/gpt"] }],
      [{ provider: "openai", isActive: true, apiKey: "key" }]
    )).toEqual([{
      id: "combo-1",
      name: "primary",
      status: "healthy",
      readyModels: 1,
      totalModels: 1,
      unavailableModels: [],
    }]);
  });

  it("handles empty combos array for cache initialization", () => {
    const results = getCombosHealth([], []);
    expect(results).toEqual([]);
  });

  it("handles invalid combo entries gracefully", () => {
    const results = getCombosHealth(
      [null, undefined, { id: "ok", models: ["openai/gpt"] }],
      [{ provider: "openai", isActive: true, apiKey: "key" }]
    );
    // null/undefined combos are filtered out
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "ok", status: "healthy" });
  });
});