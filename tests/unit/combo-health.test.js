import { describe, expect, it } from "vitest";
import { getComboHealth, getCombosHealth } from "../../src/lib/comboHealth.js";

describe("combo health", () => {
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
    // Simulates what the health API builds from registryProviders
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
});