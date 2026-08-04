import { describe, it, expect } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";

describe("Cheap Key provider", () => {
  const cheapkey = REGISTRY.find((e) => e.id === "cheapkey");

  it("should be registered in REGISTRY", () => {
    expect(cheapkey).toBeDefined();
    expect(cheapkey.display.name).toBe("Cheap Key");
    expect(cheapkey.id).toBe("cheapkey");
  });

  it("should have correct configuration", () => {
    expect(cheapkey.transport.baseUrl).toBe("https://cheapkeyai.shop/v1/chat/completions");
    expect(cheapkey.authType).toBe("apikey");
    expect(cheapkey.pricingTier).toBe("cheap");
  });

  it("should have a non-empty model list", () => {
    expect(cheapkey.models).toBeDefined();
    expect(cheapkey.models.length).toBeGreaterThan(0);
    const modelIds = cheapkey.models.map(m => m.id);
    expect(modelIds).toContain("gpt-4o");
    expect(modelIds).toContain("claude-3-5-sonnet");
  });

  it("keeps every registry id unique", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});