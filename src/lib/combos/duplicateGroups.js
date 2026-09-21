// Detect combos that configure the exact same ordered model list.
// Ordered, not set-based: fallback order changes behaviour, so [a,b] != [b,a].
// ponytail: exact-order equality only. Add subset/reorder detection when an
// operator actually asks for "this combo is *almost* that one".

// Name prefixes that mark a combo as a legacy/duplicate alias rather than the
// canonical one for its model list (see scripts/build-cli-combos.mjs history).
const LEGACY_NAME_PATTERNS = [/^\d+-/, /^primary-/, /^ci-/, /^legacy-/, /^old-/, /^backup-/];

export function modelSignature(models) {
  return (Array.isArray(models) ? models : []).join("\u0000");
}

export function isLegacyName(name) {
  const n = String(name || "");
  return LEGACY_NAME_PATTERNS.some((re) => re.test(n));
}

/**
 * Group combos sharing an identical ordered model list.
 * Keepers = explicit keepNames, plus every non-legacy name in the group.
 * Duplicates = the legacy leftovers, i.e. what a prune may delete.
 * @param {Array<{id?:string,name:string,models:string[]}>} combos
 * @param {{keepNames?: string[]}} [opts]
 * @returns {Array<{signature:string, modelCount:number, models:string[], keepers:string[], duplicates:string[]}>}
 */
export function buildDuplicateGroups(combos = [], { keepNames = [] } = {}) {
  const protectedNames = new Set(keepNames);
  const rank = (combo) => (protectedNames.has(combo.name) ? 0 : isLegacyName(combo.name) ? 2 : 1);

  const bySignature = new Map();
  for (const combo of combos) {
    if (!combo?.name || !Array.isArray(combo.models) || combo.models.length === 0) continue;
    const sig = modelSignature(combo.models);
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(combo);
  }

  const groups = [];
  for (const [signature, members] of bySignature) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const keepers = sorted.filter((c) => rank(c) < 2);
    const duplicates = sorted.filter((c) => rank(c) === 2);
    groups.push({
      signature,
      modelCount: members[0].models.length,
      models: members[0].models,
      members: sorted.map((c) => c.name),
      keepers: keepers.map((c) => c.name),
      duplicates: duplicates.map((c) => c.name),
      // Safe default when an operator collapses the whole group to one combo.
      suggestedKeeper: sorted[0].name,
    });
  }
  // Biggest cleanups first; stable tie-break so the UI list does not jump around.
  return groups.sort(
    (a, b) => b.duplicates.length - a.duplicates.length || (a.keepers[0] || "").localeCompare(b.keepers[0] || ""),
  );
}

/**
 * Turn duplicate groups into a prune plan, guessed from combos already in hand.
 * @param {Array<{id?:string,name:string,models:string[]}>} combos
 * @param {{keepNames?: string[]}} [opts]
 */
export function buildPrunePlan(combos = [], opts = {}) {
  const groups = buildDuplicateGroups(combos, opts);
  const duplicateNames = groups.flatMap((g) => g.duplicates);
  const duplicateSet = new Set(duplicateNames);
  return {
    groups,
    groupsWithDuplicates: groups.filter((g) => g.duplicates.length > 0).length,
    duplicates: duplicateNames,
    duplicateIds: combos.filter((c) => duplicateSet.has(c.name)).map((c) => c.id).filter(Boolean),
  };
}

/**
 * Safety gate for destructive calls. Only combos that share their model list
 * with another combo may be deleted, never a protected name, and never the last
 * member of a group (a group always keeps at least one combo standing).
 * @param {Array<{id?:string,name:string,models:string[]}>} combos
 * @param {string[]} requestedNames
 * @param {{keepNames?: string[]}} [opts]
 */
export function selectDeletableNames(combos = [], requestedNames = [], opts = {}) {
  const { keepNames = [] } = opts;
  const protectedNames = new Set(keepNames);
  const wanted = new Set(requestedNames.filter((n) => typeof n === "string" && n.length > 0));

  const deletable = [];
  const skipped = [];
  for (const group of buildDuplicateGroups(combos, opts)) {
    const hits = group.members.filter((n) => wanted.has(n) && !protectedNames.has(n));
    const survivors = group.members.length - hits.length;
    if (survivors < 1) {
      skipped.push(...hits); // would wipe the whole group — refuse
      continue;
    }
    deletable.push(...hits);
  }

  for (const name of wanted) {
    if (!deletable.includes(name) && !skipped.includes(name)) skipped.push(name);
  }
  return { deletable, skipped };
}
