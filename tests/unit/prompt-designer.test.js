import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/app/api/skills/prompt-designer/route";

describe("prompt designer", () => {
  it("includes requested product context in generated prompt", () => {
    const prompt = buildPrompt({
      goal: "Build an onboarding page",
      product: "AI note app",
      stack: "Next.js and Tailwind",
      platform: "web",
      styleKeywords: "minimal dark",
    });

    expect(prompt).toContain("Build an onboarding page");
    expect(prompt).toContain("AI note app");
    expect(prompt).toContain("Next.js and Tailwind");
    expect(prompt).toContain("minimal dark");
    expect(prompt).toContain("accessibility requirements");
  });
});