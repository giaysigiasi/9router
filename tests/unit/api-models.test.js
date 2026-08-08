import { describe, it, expect, vi } from "vitest";
import { GET } from "@/app/api/models/route";

// Mock dependencies from the actual route
vi.mock("@/shared/constants/config", () => ({
  AI_MODELS: [
    { provider: "openai", model: "gpt-4", name: "GPT-4" },
    { provider: "anthropic", model: "claude-2", name: "Claude 2" },
  ],
}));

vi.mock("@/models", () => ({
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

describe("/api/models", () => {
  it("should return a list of models", async () => {
    const req = {};

    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.models).toBeInstanceOf(Array);
    expect(data.models.length).toBeGreaterThan(0);
    expect(data.models[0]).toHaveProperty("provider");
    expect(data.models[0]).toHaveProperty("model");
    expect(data.models[0]).toHaveProperty("name");
    expect(data.models[0]).toHaveProperty("caps");
  });
});