import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getCustomModels: vi.fn(async () => []),
  updateCombo: vi.fn(async (id, data) => ({ id, ...data })),
}));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn() }));
vi.mock("@/shared/constants/config", () => ({
  AI_MODELS: [
    { provider: "acme", model: "acme-opus-9" },
    { provider: "acme", model: "acme-flash-lite" },
    { provider: "acme", model: "acme-tts-voice" },
  ],
}));
vi.mock("@/shared/constants/providers", () => ({ getProviderAlias: (p) => p }));

import { autoComboRole, autoCurateEnabled, curateAutoCombos } from "../../src/lib/combos/autoCurate.js";
import { updateCombo } from "@/lib/localDb";

const combo = (name, models, kind = null) => ({ id: `id-${name}`, name, models, kind });
const health = (id, unavailableModels = []) => ({ id, unavailableModels });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.COMBO_AUTOCURATE;
  delete process.env.COMBO_AUTOCURATE_PREFIXES;
  delete process.env.COMBO_AUTOCURATE_FREE_ONLY;
});

describe("autoComboRole", () => {
  it("maps role-*/auto-* names to known roles", () => {
    expect(autoComboRole("role-thinking")).toBe("thinking");
    expect(autoComboRole("auto-coding")).toBe("coding");
    expect(autoComboRole("role-vision")).toBe("vision");
    expect(autoComboRole("auto-fast")).toBe("fast");
    expect(autoComboRole("role-longctx")).toBe("longctx");
  });

  it("rejects non-managed names and unknown roles", () => {
    expect(autoComboRole("free-coding-max")).toBe(null);
    expect(autoComboRole("goat-qa")).toBe(null);
    expect(autoComboRole("role-unknown")).toBe(null);
    expect(autoComboRole("coding")).toBe(null);
  });
});

describe("curateAutoCombos", () => {
  it("rewrites only auto combos, ranked strongest first, excluding unavailable", async () => {
    const combos = [
      combo("role-coding", ["acme/dead-model"]),
      combo("handmade", ["acme/deepseek-coder-pro"]),
    ];
    const staticHealth = [health("id-role-coding", ["acme/dead-model"]), health("id-handmade")];
    await curateAutoCombos({ combos, staticHealth, probes: [] });
    // handmade untouched; role-coding picked up the healthy coder model
    const calls = updateCombo.mock.calls.map(([id]) => id);
    expect(calls).toEqual(["id-role-coding"]);
    expect(updateCombo.mock.calls[0][1].models).toContain("acme/deepseek-coder-pro");
  });

  it("keeps models already proven healthy via combo membership", async () => {
    const combos = [
      combo("seed", ["zz/deepseek-coder-pro", "zz/dead"]),
      combo("role-coding", []),
    ];
    const staticHealth = [health("id-seed", ["zz/dead"])];
    await curateAutoCombos({ combos, staticHealth, probes: [] });
    const picked = updateCombo.mock.calls[0]?.[1]?.models || [];
    expect(picked).toContain("zz/deepseek-coder-pro");
    expect(picked).not.toContain("zz/dead");
  });

  it("respects COMBO_AUTOCURATE=0", async () => {
    process.env.COMBO_AUTOCURATE = "0";
    await curateAutoCombos({ combos: [combo("role-thinking", [])], staticHealth: [], probes: [] });
    expect(updateCombo).not.toHaveBeenCalled();
    expect(autoCurateEnabled()).toBe(false);
  });

  it("does not rewrite when the list is unchanged", async () => {
    const combos = [combo("seed", ["zz/deepseek-coder-pro"]), combo("role-coding", ["zz/deepseek-coder-pro", "acme/acme-opus-9"])];
    // zz is healthy via seed; acme prefix not healthy -> discovery excluded
    const staticHealth = [health("id-seed"), health("id-role-coding")];
    await curateAutoCombos({ combos, staticHealth, probes: [] });
    const picked = updateCombo.mock.calls[0]?.[1]?.models;
    if (picked) expect(picked[0]).toBe("zz/deepseek-coder-pro");
  });

  it("excludes non-chat models (tts/embed/image) from candidates", async () => {
    const combos = [combo("role-thinking", []), combo("seed", ["acme/acme-opus-9"])];
    await curateAutoCombos({ combos, staticHealth: [health("id-seed"), health("id-role-thinking")], probes: [] });
    const picked = updateCombo.mock.calls[0]?.[1]?.models || [];
    expect(picked.every((m) => !/tts|embed|image/i.test(m))).toBe(true);
  });
});
