import { describe, it, expect } from "vitest";
import {
  isLegacyName,
  modelSignature,
  buildDuplicateGroups,
  buildPrunePlan,
  selectDeletableNames,
} from "../../src/lib/combos/duplicateGroups.js";

const combo = (name, models) => ({ id: `id-${name}`, name, models });

describe("combo duplicate grouping", () => {
  it("signs by ordered model list, not as a set", () => {
    expect(modelSignature(["a", "b"])).toBe(modelSignature(["a", "b"]));
    expect(modelSignature(["a", "b"])).not.toBe(modelSignature(["b", "a"]));
  });

  it("flags legacy alias names", () => {
    expect(isLegacyName("1-coding-max")).toBe(true);
    expect(isLegacyName("primary-reasoning")).toBe(true);
    expect(isLegacyName("ci-coding-max")).toBe(true);
    expect(isLegacyName("free-coding-max")).toBe(false);
    expect(isLegacyName("codex-dev")).toBe(false);
  });

  it("groups identical model lists and keeps the canonical name", () => {
    const groups = buildDuplicateGroups([
      combo("1-coding-max", ["a", "b"]),
      combo("free-coding-max", ["a", "b"]),
      combo("2-coding-max", ["a", "b"]),
      combo("unique-combo", ["z"]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keepers).toEqual(["free-coding-max"]);
    expect(groups[0].duplicates).toEqual(["1-coding-max", "2-coding-max"]);
    expect(groups[0].modelCount).toBe(2);
  });

  it("treats every non-legacy name in a group as a keeper (no silent deletion)", () => {
    const groups = buildDuplicateGroups([
      combo("codex-pm", ["a", "b"]),
      combo("claude-pm", ["a", "b"]),
    ]);
    expect(groups[0].keepers).toEqual(["claude-pm", "codex-pm"]);
    expect(groups[0].duplicates).toEqual([]);
  });

  it("honours keepNames over the legacy heuristic", () => {
    const groups = buildDuplicateGroups(
      [combo("1-coding-max", ["a"]), combo("free-coding-max", ["a"])],
      { keepNames: ["1-coding-max"] },
    );
    expect(groups[0].keepers).toEqual(["1-coding-max", "free-coding-max"]);
    expect(groups[0].duplicates).toEqual([]);
  });

  it("ignores empty and single-member groups", () => {
    expect(buildDuplicateGroups([combo("empty", []), combo("lonely", ["a"])])).toEqual([]);
  });

  it("plans prune targets with ids", () => {
    const plan = buildPrunePlan([
      combo("3-reasoning", ["a", "b"]),
      combo("free-reasoning", ["a", "b"]),
    ]);
    expect(plan.duplicates).toEqual(["3-reasoning"]);
    expect(plan.duplicateIds).toEqual(["id-3-reasoning"]);
    expect(plan.groupsWithDuplicates).toBe(1);
    expect(plan.groups[0].suggestedKeeper).toBe("free-reasoning");
  });

  it("blocks deleting unknowns and unique combos", () => {
    const combos = [combo("1-coding-max", ["a"]), combo("free-coding-max", ["a"]), combo("solo", ["q"])];
    const { deletable, skipped } = selectDeletableNames(combos, ["1-coding-max", "solo"]);
    expect(deletable).toEqual(["1-coding-max"]);
    expect(skipped).toEqual(["solo"]);
  });

  it("refuses to empty a group even when the request lists the keeper", () => {
    const combos = [combo("1-coding-max", ["a"]), combo("free-coding-max", ["a"])];
    const { deletable, skipped } = selectDeletableNames(combos, ["1-coding-max", "free-coding-max"]);
    expect(deletable).toEqual([]);
    expect(skipped.sort()).toEqual(["1-coding-max", "free-coding-max"]);
  });

  it("allows collapsing a whole group down to an explicitly chosen keeper", () => {
    const combos = [
      combo("codex-pm", ["a"]),
      combo("claude-pm", ["a"]),
      combo("cline-pm", ["a"]),
    ];
    const { deletable, skipped } = selectDeletableNames(
      combos,
      ["codex-pm", "claude-pm", "cline-pm"],
      { keepNames: ["codex-pm"] },
    );
    expect(deletable).toEqual(["claude-pm", "cline-pm"]);
    expect(skipped).toEqual(["codex-pm"]);
  });

  it("refuses to delete every member of a group", () => {
    const { deletable, skipped } = selectDeletableNames(
      [combo("a-one", ["a"]), combo("b-one", ["a"])],
      ["a-one", "b-one"],
    );
    expect(deletable).toEqual([]);
    expect(skipped.sort()).toEqual(["a-one", "b-one"]);
  });
});
