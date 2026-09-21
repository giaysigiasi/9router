import { NextResponse } from "next/server";
import { getCombos, deleteCombo, getSettings, updateSettings } from "@/lib/localDb";
import { buildPrunePlan, selectDeletableNames } from "@/lib/combos/duplicateGroups.js";

export const dynamic = "force-dynamic";

// Same filter as the combos page: only LLM combos, media combos live elsewhere.
function llmCombos(combos) {
  return combos.filter((c) => !c.kind || c.kind === "llm");
}

// GET /api/combos/duplicates - report combos sharing an identical model list
export async function GET() {
  try {
    const plan = buildPrunePlan(llmCombos(await getCombos()));
    return NextResponse.json({
      groups: plan.groups,
      groupsWithDuplicates: plan.groupsWithDuplicates,
      duplicates: plan.duplicates,
    });
  } catch (error) {
    console.log("Error building duplicate combo report:", error);
    return NextResponse.json({ error: "Failed to build duplicate report" }, { status: 500 });
  }
}

// POST /api/combos/duplicates - { confirm: true, names: [...], keepNames: [...] }
// Deletes only members of a duplicate group; keepNames and the last member of a
// group are always spared, everything else is reported back as skipped.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return NextResponse.json({ error: "Confirmation required: send { confirm: true, names: [...] }" }, { status: 400 });
    }

    const combos = llmCombos(await getCombos());
    const { deletable, skipped } = selectDeletableNames(combos, body?.names || [], {
      keepNames: body?.keepNames || [],
    });
    if (deletable.length === 0) {
      return NextResponse.json({ deleted: [], skipped, error: "No deletable combo names in request" }, { status: 400 });
    }

    const byName = new Map(combos.map((c) => [c.name, c]));
    const deleted = [];
    for (const name of deletable) {
      const combo = byName.get(name);
      if (combo && (await deleteCombo(combo.id))) deleted.push(name);
      else skipped.push(name);
    }

    // Strategies are keyed by combo name — drop entries for deleted combos.
    if (deleted.length > 0) {
      try {
        const strategies = { ...((await getSettings()).comboStrategies || {}) };
        let dirty = false;
        for (const name of deleted) {
          if (Object.prototype.hasOwnProperty.call(strategies, name)) {
            delete strategies[name];
            dirty = true;
          }
        }
        if (dirty) await updateSettings({ comboStrategies: strategies });
      } catch (err) {
        console.log("Error pruning combo strategies for deleted combos:", err);
      }
    }

    const remaining = buildPrunePlan(llmCombos(await getCombos()));
    return NextResponse.json({ deleted, skipped, duplicatesLeft: remaining.duplicates.length, groups: remaining.groups });
  } catch (error) {
    console.log("Error pruning duplicate combos:", error);
    return NextResponse.json({ error: "Failed to prune duplicate combos" }, { status: 500 });
  }
}
