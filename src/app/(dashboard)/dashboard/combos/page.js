"use client";

import { useState, useEffect, useMemo } from "react";
import { Card, Button, Modal, CardSkeleton, ModelSelectModal, ConfirmModal, CapacityBadges, Select, Toggle, ComboFormModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { buildDuplicateGroups } from "@/lib/combos/duplicateGroups";

// Capacity adapter: global fallback pools of models per input-modality capability.
// A request needing a capability the target model/combo lacks switches straight
// to the first enabled model here instead of erroring or dropping the data.
const CAPACITY_ADAPTER_CAPS = [
  { key: "vision", label: "Vision", icon: "visibility", desc: "Images" },
  // pdf, videoInput temporarily hidden — no translator support yet for those blocks.
  { key: "audioInput", label: "Audio", icon: "graphic_eq", desc: "Audio input" },
];
const DEFAULT_FALLBACK_MODEL = "oc/mimo-v2.5-free";
const COMBO_SORT_OPTIONS = [
  { value: "default", label: "Sort: Default" },
  { value: "name", label: "Name A–Z" },
  { value: "health", label: "Health: needs attention" },
  { value: "models", label: "Model count: high to low" },
];
const HEALTH_SORT_RANK = { unavailable: 0, degraded: 1, "no-models": 2, healthy: 3 };
const COMBO_HEALTH_FILTERS = [
  { value: "all", label: "Health: all" },
  { value: "attention", label: "Needs attention" },
  { value: "healthy", label: "Healthy" },
  { value: "degraded", label: "Degraded" },
  { value: "unavailable", label: "Unavailable" },
  { value: "no-models", label: "No models" },
];
const HEALTH_REFRESH_MS = 60 * 1000;
const EMPTY_CAP_ENTRY = { enabled: true, roundRobin: false, models: [] };

// Combo templates for quick creation
const COMBO_TEMPLATES = [
  {
    name: "Free Coding",
    description: "Free-tier coding models from multiple providers",
    models: [
      "kilo-gateway/gemini-2.5-flash",
      "kilo-gateway/gemini-2.5-pro",
      "kilocode/qwen3-coder-480b",
      "kilocode/glm-4.5",
      "openrouter/google/gemini-2.5-flash-preview",
    ],
  },
  {
    name: "Free Reasoning",
    description: "Free-tier reasoning models",
    models: [
      "kilo-gateway/gemini-2.5-pro",
      "kilo-gateway/gemini-2.5-flash",
      "kilocode/qwen3-coder-480b",
      "kilocode/deepseek-r1",
      "openrouter/google/gemini-2.5-pro-preview",
    ],
  },
  {
    name: "Free Vision",
    description: "Free-tier models with vision support",
    models: [
      "kilo-gateway/gemini-2.5-flash",
      "kilo-gateway/gemini-2.5-pro",
      "openrouter/google/gemini-2.5-flash-preview",
      "openrouter/meta-llama/llama-4-maverick",
    ],
  },
  {
    name: "Multi-Provider Fallback",
    description: "Broad fallback across all free providers",
    models: [
      "kilo-gateway/gemini-2.5-flash",
      "kilocode/qwen3-coder-480b",
      "openrouter/google/gemini-2.5-flash-preview",
      "bazaarlink/hunter-alpha",
      "kilocode/glm-4.5",
    ],
  },
];
const EMPTY_CAPACITY_ADAPTER = {
  vision: { ...EMPTY_CAP_ENTRY },
  pdf: { ...EMPTY_CAP_ENTRY },
  audioInput: { ...EMPTY_CAP_ENTRY },
  videoInput: { ...EMPTY_CAP_ENTRY },
};
// Backward-compat: legacy stored form was an array of {model, enabled}.
function normalizeCapEntry(entry) {
  if (Array.isArray(entry)) {
    return { enabled: true, roundRobin: false, models: entry.map((e) => e?.model || e).filter(Boolean) };
  }
  if (entry && typeof entry === "object") {
    return {
      enabled: entry.enabled !== false,
      roundRobin: !!entry.roundRobin,
      models: Array.isArray(entry.models) ? entry.models.filter(Boolean) : [],
    };
  }
  return { ...EMPTY_CAP_ENTRY };
}

export default function CombosPage() {
  const [combos, setCombos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCombo, setEditingCombo] = useState(null);
  const [activeProviders, setActiveProviders] = useState([]);
  const [comboStrategies, setComboStrategies] = useState({});
  const [comboHealth, setComboHealth] = useState({});
  const [lastPollAt, setLastPollAt] = useState(null);
  const [comboProbes, setComboProbes] = useState({});
  const [probing, setProbing] = useState(false);
  const [sortMode, setSortMode] = useState("default");
  const [healthFilter, setHealthFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");
  const searchQuery = useHeaderSearchStore((s) => s.query);
  const registerSearch = useHeaderSearchStore((s) => s.register);
  const unregisterSearch = useHeaderSearchStore((s) => s.unregister);
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_CAPACITY_ADAPTER);
  const { getCaps } = useModelCaps();
  const [confirmState, setConfirmState] = useState(null);
  const { copied, copy } = useCopyToClipboard();
  const [fixingComboId, setFixingComboId] = useState(null);
  const [fixingAll, setFixingAll] = useState(false);
  const [fixResults, setFixResults] = useState({});
  const [dupOpen, setDupOpen] = useState(false);
  const [dupSel, setDupSel] = useState({});
  const [pruning, setPruning] = useState(false);

  useEffect(() => {
    registerSearch("Search combos or models...");
    return () => unregisterSearch();
  }, [registerSearch, unregisterSearch]);

  useEffect(() => {
    fetchData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-poll passive health while the page is open so stale flags and
  // lastPollAt stay fresh without a full reload.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/combos/health");
        if (!res.ok) return;
        const data = await res.json();
        setComboHealth(Object.fromEntries((data.health || []).map((item) => [item.id, item])));
        setLastPollAt(data.lastPollAt || null);
      } catch { /* keep last known health on transient errors */ }
    }, HEALTH_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const fetchData = async () => {
    try {
      const [combosRes, providersRes, settingsRes, healthRes] = await Promise.all([
        fetch("/api/combos"),
        fetch("/api/providers"),
        fetch("/api/settings"),
        fetch("/api/combos/health"),
      ]);
      const combosData = await combosRes.json();
      const providersData = await providersRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const healthData = healthRes.ok ? await healthRes.json() : {};

      // Only LLM combos here - webSearch/webFetch combos belong to media-providers/web
      if (combosRes.ok) setCombos((combosData.combos || []).filter(c => !c.kind || c.kind === "llm"));
      if (providersRes.ok) {
        setActiveProviders(providersData.connections || []);
      }
      setComboStrategies(settingsData.comboStrategies || {});
      setComboHealth(Object.fromEntries((healthData.health || []).map((item) => [item.id, item])));
      setLastPollAt(healthData.lastPollAt || null);
      const rawAdapter = settingsData.capacityAdapter || {};
      const normalized = {};
      for (const cap of CAPACITY_ADAPTER_CAPS) {
        normalized[cap.key] = normalizeCapEntry(rawAdapter[cap.key]);
      }
      setCapacityAdapter(normalized);
    } catch (error) {
      console.log("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleProbeCombos = async () => {
    setProbing(true);
    try {
      const res = await fetch("/api/combos/health", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to probe combos");
      setComboProbes(Object.fromEntries((data.probes || []).map((probe) => [probe.id, probe])));
      // Re-fetch passive health to pick up cached probe data
      try {
        const healthRes = await fetch("/api/combos/health");
        if (healthRes.ok) {
          const healthData = await healthRes.json();
      setComboHealth(Object.fromEntries((healthData.health || []).map((item) => [item.id, item])));
      setLastPollAt(healthData.lastPollAt || null);
        }
      } catch (_) { /* ignore refresh errors */ }
    } catch (error) {
      alert(error.message);
    } finally {
      setProbing(false);
    }
  };

  // Probe a single combo — POST /api/combos/health?id= limits the probe to one combo
  const handleProbeSingle = async (comboId) => {
    try {
      const res = await fetch(`/api/combos/health?id=${encodeURIComponent(comboId)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to probe");
      const probe = (data.probes || []).find((p) => p.id === comboId);
      if (probe) {
        setComboProbes((prev) => ({ ...prev, [comboId]: probe }));
      }
      // Refresh health data for the stale flag
      try {
        const healthRes = await fetch("/api/combos/health");
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setComboHealth(Object.fromEntries((healthData.health || []).map((item) => [item.id, item])));
          setLastPollAt(healthData.lastPollAt || null);
        }
      } catch (_) { /* ignore */ }
    } catch (error) {
      console.error("Probe failed:", error);
    }
  };

  const handleSetCapacityAdapter = async (next) => {
    setCapacityAdapter(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacityAdapter: next }),
      });
    } catch (error) {
      console.log("Error updating capacity adapter:", error);
    }
  };

  const handleCreate = async (data) => {
    try {
      const res = await fetch("/api/combos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setShowCreateModal(false);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to create combo");
      }
    } catch (error) {
      console.log("Error creating combo:", error);
    }
  };

  const handleUpdate = async (id, data) => {
    try {
      const res = await fetch(`/api/combos/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        await fetchData();
        setEditingCombo(null);
      } else {
        const err = await res.json();
        alert(err.error || "Failed to update combo");
      }
    } catch (error) {
      console.log("Error updating combo:", error);
    }
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Combo",
      message: "Delete this combo?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/combos/${id}`, { method: "DELETE" });
          if (res.ok) {
            setCombos(combos.filter(c => c.id !== id));
          }
        } catch (error) {
          console.log("Error deleting combo:", error);
        }
      }
    });
  };

  // Merge a per-combo strategy patch into settings.comboStrategies. Passing an empty
  // patch (strategy back to default "fallback") drops the entry entirely.
  const handleSetComboStrategy = async (comboName, patch) => {
    try {
      const updated = { ...comboStrategies };
      const next = { ...(updated[comboName] || {}), ...patch };
      // Prune to keep settings clean: default fallback with no extras = no entry.
      if (!next.fallbackStrategy || next.fallbackStrategy === "fallback") {
        delete updated[comboName];
      } else {
        updated[comboName] = next;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comboStrategies: updated }),
      });

      setComboStrategies(updated);
    } catch (error) {
      console.log("Error updating combo strategy:", error);
    }
  };

  // Auto-fix a single combo: remove models from inactive providers
  const handleFixCombo = async (comboId) => {
    setFixingComboId(comboId);
    try {
      const res = await fetch(`/api/combos/${comboId}/fix`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to fix combo");
        return;
      }
      setFixResults((prev) => ({ ...prev, [comboId]: data }));
      if (data.fixed) {
        await fetchData(); // Refresh combos list
      }
    } catch (error) {
      console.log("Error fixing combo:", error);
      alert("Failed to fix combo");
    } finally {
      setFixingComboId(null);
    }
  };

  // Bulk fix all degraded/unavailable combos
  const handleFixAll = async () => {
    const degradedIds = Object.entries(comboHealth)
      .filter(([, h]) => h.status === "degraded" || h.status === "unavailable")
      .map(([id]) => id);
    if (degradedIds.length === 0) return;
    setFixingAll(true);
    let fixedCount = 0;
    for (const id of degradedIds) {
      try {
        const res = await fetch(`/api/combos/${id}/fix`, { method: "POST" });
        const data = await res.json();
        if (data.fixed) fixedCount++;
        setFixResults((prev) => ({ ...prev, [id]: data }));
      } catch { /* continue */ }
    }
    setFixingAll(false);
    if (fixedCount > 0) await fetchData();
  };

  // Count degraded combos for the bulk fix button
  const degradedCount = useMemo(
    () => Object.values(comboHealth).filter((h) => h.status === "degraded" || h.status === "unavailable").length,
    [comboHealth],
  );

  const staleProbeCount = useMemo(
    () => Object.values(comboHealth).filter((h) => h.probeStale).length,
    [comboHealth],
  );

  // Combos whose model list is byte-identical to another combo's: redundant
  // copies that only differ by name (legacy aliases, per-agent duplicates).
  const dupGroups = useMemo(() => buildDuplicateGroups(combos), [combos]);
  const dupRedundantCount = useMemo(
    () => dupGroups.reduce((total, g) => total + g.members.length - 1, 0),
    [dupGroups],
  );
  const dupSiblingsByName = useMemo(
    () => Object.fromEntries(
      dupGroups.flatMap((g) => g.members.map((name) => [name, g.members.filter((n) => n !== name)])),
    ),
    [dupGroups],
  );
  // How many combos the current modal ticks would delete (keeper excluded).
  const dupDeleteCount = useMemo(
    () => dupGroups.reduce((total, g) => (total + (dupSel[g.signature]?.apply ? g.members.length - 1 : 0)), 0),
    [dupGroups, dupSel],
  );

  const openDupModal = () => {
    setDupSel(Object.fromEntries(dupGroups.map((g) => [
      g.signature,
      // Only pre-tick groups the heuristic can collapse without guessing: those
      // holding legacy-name leftovers. Safe either way — a keeper always survives.
      { apply: g.duplicates.length > 0, keeper: g.suggestedKeeper },
    ])));
    setDupOpen(true);
  };

  const handlePruneDuplicates = async () => {
    const names = [];
    const keepNames = [];
    for (const g of dupGroups) {
      const sel = dupSel[g.signature];
      if (!sel?.apply) continue;
      keepNames.push(sel.keeper);
      names.push(...g.members.filter((n) => n !== sel.keeper));
    }
    if (names.length === 0) return;
    setPruning(true);
    try {
      const res = await fetch("/api/combos/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, names, keepNames }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to remove duplicates");
        return;
      }
      await fetchData();
      setDupOpen(false);
    } catch (error) {
      console.log("Error removing duplicate combos:", error);
      alert("Failed to remove duplicates");
    } finally {
      setPruning(false);
    }
  };

  // Distinct provider prefixes across all combos, for the provider filter.
  const providerOptions = useMemo(() => {
    const prefixes = new Set();
    for (const c of combos) {
      for (const m of c.models || []) {
        const prefix = m.split("/")[0];
        if (prefix) prefixes.add(prefix);
      }
    }
    return [
      { value: "all", label: "Provider: all" },
      ...[...prefixes].sort().map((p) => ({ value: p, label: p })),
    ];
  }, [combos]);

  const isFiltering =
    searchQuery.trim() !== "" || healthFilter !== "all" || providerFilter !== "all";

  const filteredCombos = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return combos.filter((combo) => {
      if (healthFilter !== "all") {
        const status = comboHealth[combo.id]?.status;
        if (healthFilter === "attention") {
          if (status !== "degraded" && status !== "unavailable") return false;
        } else if (status !== healthFilter) return false;
      }
      if (providerFilter !== "all" && !(combo.models || []).some((m) => m.startsWith(`${providerFilter}/`))) return false;
      if (q) {
        const inName = (combo.name || "").toLowerCase().includes(q);
        const inModels = (combo.models || []).some((m) => m.toLowerCase().includes(q));
        if (!inName && !inModels) return false;
      }
      return true;
    });
  }, [combos, comboHealth, searchQuery, healthFilter, providerFilter]);

  const sortedCombos = useMemo(() => {
    if (sortMode === "default") return filteredCombos;
    return [...filteredCombos].sort((a, b) => {
      if (sortMode === "health") {
        const healthDiff = (HEALTH_SORT_RANK[comboHealth[a.id]?.status] ?? 4) - (HEALTH_SORT_RANK[comboHealth[b.id]?.status] ?? 4);
        if (healthDiff) return healthDiff;
      }
      if (sortMode === "models") {
        const modelDiff = (b.models?.length || 0) - (a.models?.length || 0);
        if (modelDiff) return modelDiff;
      }
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [filteredCombos, comboHealth, sortMode]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-text-muted mt-1">
            Group models under one name, then pick a strategy per combo:
          </p>
          <ul className="text-sm text-text-muted mt-2 flex flex-col gap-1">
            <li><span className="font-medium text-text-main">Fallback</span> — tries models in order (next on failure)</li>
            <li><span className="font-medium text-text-main">Round Robin</span> — rotates models across requests to spread load</li>
            <li><span className="font-medium text-text-main">Fusion</span> — queries all models in parallel, then a judge synthesizes one answer. Best quality, but costs the most: every request bills all panel models + the judge (N+1 calls)</li>
          </ul>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <div className="flex items-center gap-2 flex-1 sm:flex-none">
            <Button icon="health_and_safety" variant="ghost" onClick={handleProbeCombos} disabled={probing} className="whitespace-nowrap">
              {probing ? "Checking..." : "Check Health"}
            </Button>
            {degradedCount > 0 && (
              <Button icon="auto_fix_high" variant="ghost" onClick={handleFixAll} disabled={fixingAll} className="whitespace-nowrap text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300">
                {fixingAll ? "Fixing..." : `Fix All (${degradedCount})`}
              </Button>
            )}
            {dupGroups.length > 0 && (
              <Button icon="content_copy" variant="ghost" onClick={openDupModal} className="whitespace-nowrap" title="Combos that repeat another combo's model list">
                {`Duplicates (${dupRedundantCount})`}
              </Button>
            )}
            {lastPollAt ? (
              <span className="text-[11px] text-text-muted whitespace-nowrap" title={`Auto-polled at ${new Date(lastPollAt).toLocaleString()}`}>
                Last: {new Date(lastPollAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap" title="Background health poll has not run yet — statuses reflect provider config only">
                Never probed
              </span>
            )}
            {staleProbeCount > 0 && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap" title={`${staleProbeCount} combo probe(s) are older than 5 minutes`}>
                <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">schedule</span>
                {staleProbeCount} stale
              </span>
            )}
          </div>
          <Button icon="add" onClick={() => setShowCreateModal(true)} className="flex-1 whitespace-nowrap sm:flex-none">
            Create Combo
          </Button>
        </div>
      </div>

       {/* Combos List */}
       {combos.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
              <span className="material-symbols-outlined text-[32px]">layers</span>
            </div>
            <p className="text-text-main font-medium mb-1">No combos yet</p>
            <p className="text-sm text-text-muted mb-4">Create model combos with fallback support</p>
            <Button icon="add" onClick={() => setShowCreateModal(true)} className="w-full sm:w-auto">
              Create Combo
            </Button>
          </div>
        </Card>
       ) : (
         <div className="flex flex-col gap-4">
           <div className="flex flex-wrap items-center gap-2">
             {isFiltering && (
               <span className="text-[11px] text-text-muted whitespace-nowrap">
                 {filteredCombos.length} of {combos.length} shown
               </span>
             )}
             <div className="flex-1" />
             <div className="w-full sm:w-[160px]">
               <Select
                 options={COMBO_HEALTH_FILTERS}
                 value={healthFilter}
                 onChange={(e) => setHealthFilter(e.target.value)}
                 selectClassName="py-1.5 text-xs"
               />
             </div>
             <div className="w-full sm:w-[160px]">
               <Select
                 options={providerOptions}
                 value={providerFilter}
                 onChange={(e) => setProviderFilter(e.target.value)}
                 selectClassName="py-1.5 text-xs"
               />
             </div>
             <div className="w-full sm:w-[240px]">
               <Select
                 options={COMBO_SORT_OPTIONS}
                 value={sortMode}
                 onChange={(e) => setSortMode(e.target.value)}
                 selectClassName="py-1.5 text-xs"
               />
             </div>
           </div>
           {sortedCombos.length === 0 && (
             <div className="text-center py-8 border border-dashed border-border rounded-xl">
               <span className="material-symbols-outlined text-[32px] text-text-muted mb-2">search_off</span>
               <p className="text-text-muted text-sm">No combos match your search or filters</p>
             </div>
           )}
           {sortedCombos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              getCaps={getCaps}
              activeProviders={activeProviders}
              copied={copied}
              onCopy={copy}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => handleDelete(combo.id)}
              strategy={comboStrategies[combo.name] || {}}
               health={comboHealth[combo.id]}
               probe={comboProbes[combo.id]}
               dupSiblings={dupSiblingsByName[combo.name]}
               onSetStrategy={(patch) => handleSetComboStrategy(combo.name, patch)}
               onFix={() => handleFixCombo(combo.id)}
               fixing={fixingComboId === combo.id}
               fixResult={fixResults[combo.id]}
               onProbe={() => handleProbeSingle(combo.id)}
            />
          ))}
        </div>
      )}

      {/* Capacity Adapter */}
      <CapacityAdapterSection
        capacityAdapter={capacityAdapter}
        onChange={handleSetCapacityAdapter}
        activeProviders={activeProviders}
        getCaps={getCaps}
      />

      {/* Create Modal - Use key to force remount and reset state */}
      {showCreateModal && (
        <ComboFormModal
          key="create"
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleCreate}
          activeProviders={activeProviders}
          templates={COMBO_TEMPLATES}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          isOpen={!!editingCombo}
          combo={editingCombo}
          onClose={() => setEditingCombo(null)}
          onSave={(data) => handleUpdate(editingCombo.id, data)}
          activeProviders={activeProviders}
        />
      )}

      {/* Duplicate model-set pruning */}
      <Modal
        isOpen={dupOpen}
        onClose={() => setDupOpen(false)}
        title="Duplicate Combos"
        size="full"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDupOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              icon="delete_sweep"
              onClick={handlePruneDuplicates}
              disabled={pruning || dupDeleteCount === 0}
            >
              {pruning ? "Removing..." : `Remove ${dupDeleteCount} combo${dupDeleteCount === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-muted">
          {dupGroups.length} set{dupGroups.length === 1 ? "" : "s"} of combos repeat the exact same model list.
          Tick a set, choose the one name to keep, and the rest are removed.
        </p>
        <p className="mt-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          Removing a name breaks any client still calling it (CLI config, agent, script). Check external configs
          before applying; combos are not restorable after deletion.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {dupGroups.map((group) => {
            const sel = dupSel[group.signature] || { apply: false, keeper: group.suggestedKeeper };
            return (
              <div key={group.signature} className="rounded-[10px] border border-border-subtle p-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={!!sel.apply}
                    onChange={(e) => setDupSel((prev) => ({
                      ...prev,
                      [group.signature]: { ...sel, apply: e.target.checked },
                    }))}
                  />
                  <span className="text-sm font-medium">
                    {group.members.length} combos · {group.modelCount} models each
                  </span>
                </label>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {group.members.map((name) => (
                    <label key={name} className="flex cursor-pointer items-center gap-1.5 font-mono text-xs">
                      <input
                        type="radio"
                        name={`keeper-${group.signature}`}
                        className="size-3.5 shrink-0"
                        checked={sel.keeper === name}
                        onChange={() => setDupSel((prev) => ({
                          ...prev,
                          [group.signature]: { ...sel, keeper: name },
                        }))}
                      />
                      <span className={sel.keeper === name ? "text-emerald-600 dark:text-emerald-400" : "text-text-muted"}>
                        {name}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}

function ProbeBadge({ probe, probeStale }) {
  if (!probe) return null;
  const stale = probeStale !== false;
  const base = "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium";
  const hasAutoPush = Array.isArray(probe.autoPushedToTail) && probe.autoPushedToTail.length > 0;

  // Compute relative time from checkedAt for stale probes
  let staleLabel = "";
  if (stale && probe.checkedAt) {
    const elapsed = Date.now() - new Date(probe.checkedAt).getTime();
    if (elapsed > 86400000) staleLabel = `${Math.floor(elapsed / 86400000)}d ago`;
    else if (elapsed > 3600000) staleLabel = `${Math.floor(elapsed / 3600000)}h ago`;
    else if (elapsed > 60000) staleLabel = `${Math.floor(elapsed / 60000)}m ago`;
    else staleLabel = "just now";
  }

  if (probe.status === "healthy") {
    return (
      <span className={`${base} ${stale ? "bg-emerald-500/5 text-emerald-600/60 dark:text-emerald-400/60" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`} title={`Live check: ${probe.latencyMs}ms${stale ? ` (stale, ${staleLabel})` : ""}`}>
        {stale ? "⚡" : "✓"} {probe.latencyMs}ms{stale ? ` ${staleLabel}` : ""}
      </span>
    );
  }
  if (hasAutoPush) {
    return (
      <span className={`${base} bg-amber-500/10 text-amber-600 dark:text-amber-400`} title={`Auto-pushed to tail: ${probe.autoPushedToTail.join(", ")}`}>
        ⬇ {probe.autoPushedToTail.length} moved to tail
      </span>
    );
  }
  return (
    <span className={`${base} bg-red-500/10 text-red-600 dark:text-red-400`} title={`Live check failed: ${probe.error || "unavailable"}`}>
      ✗ {probe.error ? probe.error.slice(0, 30) : "fail"}
    </span>
  );
}

function ComboHealthBadge({ health }) {
  if (!health) return null;
  const styles = {
    healthy: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    degraded: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    unavailable: "bg-red-500/10 text-red-600 dark:text-red-400",
    "no-models": "bg-black/5 text-text-muted dark:bg-white/5",
  };
  const labels = {
    healthy: "Healthy",
    degraded: "Degraded",
    unavailable: "Unavailable",
    "no-models": "No models",
  };
  const brokenCount = health.brokenConnections?.length || 0;
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${styles[health.status] || styles.unavailable}`}
      title={`${health.readyModels}/${health.totalModels} configured models can route${brokenCount ? ` — ${brokenCount} broken connection(s)` : ""}`}
    >
      {labels[health.status] || "Unavailable"} {health.totalModels ? `${health.readyModels}/${health.totalModels}` : ""}{brokenCount ? ` ⚠${brokenCount}` : ""}
    </span>
  );
}

const STRATEGY_OPTIONS = [
  { value: "fallback", label: "Fallback — try in order" },
  { value: "round-robin", label: "Round Robin — rotate" },
  { value: "fusion", label: "Fusion — panel + judge" },
];

function ComboCard({ combo, getCaps, activeProviders = [], copied, onCopy, onEdit, onDelete, strategy = {}, health, probe: _probeIgnored, onSetStrategy, onFix, fixing, fixResult, onProbe, dupSiblings = [] }) {
  const [showJudgeSelect, setShowJudgeSelect] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const current = strategy.fallbackStrategy || "fallback";
  const judge = strategy.judgeModel || "";
  const isFusion = current === "fusion";
  // Use cached probe from health object (populated by API from KV cache)
  const probe = health?.probe;

  // Build model-level health map.
  // Red = config health marks the model unavailable (same source as the
  // "Healthy X/Y" status). Green = live probe confirmed the model works.
  // A transient probe failure (modelProbes[].ok === false) must NOT paint a
  // red dot when the combo is reported healthy, otherwise the dots contradict
  // the overall status shown on the card.
  const modelHealthMap = useMemo(() => {
    const map = {};
    if (health?.unavailableModels) {
      for (const m of health.unavailableModels) map[m] = false;
    }
    if (probe?.modelProbes) {
      for (const mp of probe.modelProbes) {
        if (mp.ok && !(mp.model in map)) map[mp.model] = true;
      }
    }
    return map;
  }, [probe, health]);

  // Runtime cooldown tiers per model: healthy | retryable | exhausted.
  const tierMap = useMemo(
    () => Object.fromEntries((health?.modelTiers || []).map((t) => [t.model, t])),
    [health],
  );

  const needsFix = health && (health.status === "degraded" || health.status === "unavailable");

  return (
    <Card padding="sm" className="group">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">layers</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
              {dupSiblings.length > 0 && (
                <span
                  className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                  title={`Same ${combo.models.length}-model list as: ${dupSiblings.join(", ")}`}
                >
                  duplicate set ×{dupSiblings.length + 1}
                </span>
              )}
              <ComboHealthBadge health={health} />
              <ProbeBadge probe={probe} probeStale={health?.probeStale} />
            </div>
              {probe && (
                <p className={`mt-1 text-[11px] ${probe.status === "healthy" ? "text-emerald-600 dark:text-emerald-400" : probe.autoPushedToTail?.length ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}`}>
                  Live check {probe.status === "healthy" ? `passed in ${probe.latencyMs}ms${health?.probeStale ? " (stale)" : ""}` : probe.autoPushedToTail?.length ? `${probe.autoPushedToTail.length} model(s) auto-pushed to tail: ${probe.autoPushedToTail.join(", ")}` : `failed${probe.error ? `: ${probe.error}` : ""}`}
                  {probe.checkedAt && <span className="text-text-muted ml-1">· {new Date(probe.checkedAt).toLocaleTimeString()}</span>}
                </p>
              )}
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                combo.models.slice(0, 3).map((model, index) => {
                  const modelOk = modelHealthMap[model];
                  const hasProbe = model in modelHealthMap;
                  return (
                    <code key={index} className="inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5">
                      {hasProbe && (
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${modelOk ? "bg-emerald-500" : "bg-red-500"}`}
                          title={modelOk ? "Model healthy" : "Model unavailable"}
                        />
                      )}
                      <span>{model}</span>
                      <CapacityBadges caps={getCaps?.(model)} />
                    </code>
                  );
                })
              )}
              {combo.models.length > 3 && (
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5 transition-colors"
                  title={expanded ? "Collapse model list" : `Show all ${combo.models.length} models`}
                >
                  <span className="material-symbols-outlined text-[12px]">{expanded ? "expand_less" : "expand_more"}</span>
                  {expanded ? "Show less" : `+${combo.models.length - 3} more`}
                </button>
              )}
            </div>
            {/* Expanded: full ordered fallback chain with per-model health/tier */}
            {expanded && combo.models.length > 0 && (
              <div className="mt-1.5 flex max-h-56 min-w-0 flex-col gap-0.5 overflow-y-auto rounded-md border border-border-subtle p-1.5">
                {combo.models.map((model, index) => {
                  const modelOk = modelHealthMap[model];
                  const hasProbe = model in modelHealthMap;
                  const tier = tierMap[model];
                  return (
                    <div key={`${model}-${index}`} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                      <span className="w-4 shrink-0 text-right text-[10px] font-medium text-text-muted">{index + 1}</span>
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${hasProbe ? (modelOk ? "bg-emerald-500" : "bg-red-500") : "bg-text-muted/30"}`}
                        title={hasProbe ? (modelOk ? "Model healthy" : "Model unavailable") : "No probe data"}
                      />
                      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-muted">{model}</code>
                      {tier && tier.tier !== "healthy" && (
                        <span
                          className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${tier.tier === "retryable" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}
                          title={tier.blockedUntilMs ? `Auto-pushed to tail until ${new Date(tier.blockedUntilMs).toLocaleTimeString()}` : tier.tier}
                        >
                          {tier.tier === "retryable" ? "cooldown" : "blocked"}
                        </span>
                      )}
                      <CapacityBadges caps={getCaps?.(model)} />
                    </div>
                  );
                })}
              </div>
            )}
            {/* Broken connection diagnostics */}
            {health?.brokenConnections?.length > 0 && (
              <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
                {health.brokenConnections.map((bc, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded bg-red-500/8 px-1.5 py-0.5 text-[10px] text-red-600 dark:text-red-400 dark:bg-red-500/10"
                    title={bc.lastError ? `${bc.provider}: ${bc.lastError}` : `${bc.provider}: ${bc.testStatus || "no credentials"}`}
                  >
                    <span className="material-symbols-outlined text-[11px]">link_off</span>
                    {bc.provider}{bc.lastError ? `: ${bc.lastError.slice(0, 30)}` : ` (${bc.testStatus || "no key"})`}
                  </span>
                ))}
              </div>
            )}
            {/* Fusion: judge picker (Auto = first model) */}
            {isFusion && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-text-muted">Judge</span>
                <button
                  onClick={() => setShowJudgeSelect(true)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-dashed border-primary/40 px-1.5 py-0.5 font-mono text-[11px] text-primary hover:border-primary hover:bg-primary/5 transition-colors"
                  title="Pick the model that fuses panel answers"
                >
                  <span className="material-symbols-outlined text-[13px]">gavel</span>
                  <span className="truncate">{judge || `Auto — ${combo.models[0] || "first model"}`}</span>
                </button>
                {judge && (
                  <button
                    onClick={() => onSetStrategy({ judgeModel: "" })}
                    className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                    title="Reset judge to Auto"
                  >
                    <span className="material-symbols-outlined text-[13px]">close</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Strategy selector — always visible */}
          <div className="w-full sm:w-[200px]">
            <Select
              options={STRATEGY_OPTIONS}
              value={current}
              onChange={(e) => onSetStrategy({ fallbackStrategy: e.target.value })}
              selectClassName="py-1.5 text-xs"
            />
          </div>

          <div className="grid grid-cols-4 gap-1 sm:flex">
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(combo.name, `combo-${combo.id}`); }}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Copy combo name"
            >
              <span className="material-symbols-outlined text-[18px]">
                {copied === `combo-${combo.id}` ? "check" : "content_copy"}
              </span>
              <span className="text-[10px] leading-tight">Copy</span>
            </button>
            <button
              onClick={onEdit}
              className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
              title="Edit"
            >
              <span className="material-symbols-outlined text-[18px]">edit</span>
              <span className="text-[10px] leading-tight">Edit</span>
            </button>
            <button
              onClick={onDelete}
              className="flex flex-col items-center rounded px-2 py-1 text-red-500 transition-colors hover:bg-red-500/10"
              title="Delete"
            >
              <span className="material-symbols-outlined text-[18px]">delete</span>
              <span className="text-[10px] leading-tight">Delete</span>
            </button>
            {needsFix && onFix && (
              <button
                onClick={(e) => { e.stopPropagation(); onFix(); }}
                disabled={fixing}
                className="flex flex-col items-center rounded px-2 py-1 text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                title="Auto-fix: remove unavailable models"
              >
                <span className="material-symbols-outlined text-[18px]">
                  {fixing ? "hourglass_empty" : "auto_fix_high"}
                </span>
                <span className="text-[10px] leading-tight">{fixing ? "Fixing..." : "Fix"}</span>
              </button>
            )}
            {onProbe && (
              <button
                onClick={(e) => { e.stopPropagation(); onProbe(); }}
                className="flex flex-col items-center rounded px-2 py-1 text-text-muted transition-colors hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
                title="Re-probe this combo"
              >
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                <span className="text-[10px] leading-tight">Probe</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Fix result banner */}
      {fixResult && (
        <div className={`mt-2 rounded-md px-3 py-2 text-xs ${fixResult.fixed ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300"}`}>
          {fixResult.fixed ? (
            <span>
              <span className="font-medium">Fixed!</span> Removed {fixResult.removedModels?.length} unavailable model(s). {fixResult.remainingModels?.length} remaining.
            </span>
          ) : (
            <span>{fixResult.message}</span>
          )}
        </div>
      )}

      {/* Judge model picker (single-select; combo members make natural judges too) */}
      {showJudgeSelect && (
        <ModelSelectModal
          isOpen={showJudgeSelect}
          onClose={() => setShowJudgeSelect(false)}
          onSelect={(m) => { onSetStrategy({ judgeModel: m?.value || "" }); setShowJudgeSelect(false); }}
          activeProviders={activeProviders}
          title="Select Judge Model"
          addedModelValues={judge ? [judge] : []}
          closeOnSelect={true}
        />
      )}
    </Card>
  );
}

function CapacityAdapterSection({ capacityAdapter, onChange, activeProviders, getCaps }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">Vision Adapter</p>
          <p className="text-xs text-text-muted mt-0.5">
            Your model can&apos;t read image/audio? Auto-switches to a model in the pool below.
          </p>
          <ul className="mt-1.5 text-[11px] text-text-muted flex flex-col gap-0.5">
            <li><span className="font-medium text-text-main">Vision</span> — images (png, jpg, webp, …)</li>
            <li><span className="font-medium text-text-main">Audio</span> — audio input</li>
          </ul>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {CAPACITY_ADAPTER_CAPS.map((cap) => (
          <CapacityAdapterCap
            key={cap.key}
            cap={cap}
            entry={capacityAdapter[cap.key] || EMPTY_CAP_ENTRY}
            onChange={(entry) => onChange({ ...capacityAdapter, [cap.key]: entry })}
            activeProviders={activeProviders}
            getCaps={getCaps}
          />
        ))}
      </div>
    </div>
  );
}

function CapacityAdapterCap({ cap, entry, onChange, activeProviders, getCaps }) {
  const [showModelSelect, setShowModelSelect] = useState(false);
  const { enabled, roundRobin, models } = entry;

  const patch = (p) => onChange({ ...entry, ...p });

  const handleAdd = (model) => {
    if (models.includes(model.value)) return;
    patch({ models: [...models, model.value] });
  };

  const handleRemove = (index) => {
    const next = models.filter((_, i) => i !== index);
    patch({ models: next.length === 0 ? [DEFAULT_FALLBACK_MODEL] : next });
  };

  const handleMove = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= models.length) return;
    const next = [...models];
    [next[index], next[target]] = [next[target], next[index]];
    patch({ models: next });
  };

  return (
    <Card padding="sm" className={`group ${!enabled ? "opacity-50" : ""}`}>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Master toggle + icon + label + chips */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center">
          <Toggle
            checked={enabled}
            onChange={(v) => patch({ enabled: v })}
            aria-label={`Enable ${cap.label} adapter`}
          />
          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-primary text-[18px]">{cap.icon}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <code className="font-mono text-sm font-medium">{cap.label}</code>
              <span className="text-[10px] text-text-muted">— {cap.desc}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {models.length === 0 ? (
                <span className="text-xs text-text-muted italic">No models</span>
              ) : (
                models.slice(0, 3).map((model, index) => (
                  <code
                    key={`${model}-${index}`}
                    className="group/chip inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted dark:bg-white/5"
                  >
                    <span>{model}</span>
                    <CapacityBadges caps={getCaps?.(model)} />
                    <button onClick={() => handleMove(index, -1)} disabled={index === 0} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === 0 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_upward</span>
                    </button>
                    <button onClick={() => handleMove(index, 1)} disabled={index === models.length - 1} className={`leading-none opacity-0 group-hover/chip:opacity-100 ${index === models.length - 1 ? "text-text-muted/20" : "text-text-muted hover:text-primary"}`}>
                      <span className="material-symbols-outlined text-[12px]">arrow_downward</span>
                    </button>
                    <button onClick={() => handleRemove(index)} className="leading-none opacity-0 group-hover/chip:opacity-100 text-text-muted hover:text-red-500">
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </code>
                ))
              )}
              {models.length > 3 && (
                <span className="text-[10px] text-text-muted">+{models.length - 3} more</span>
              )}
            </div>
          </div>
        </div>

        {/* Actions: Round-robin toggle + Add Model */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer select-none">
            <Toggle
              checked={roundRobin}
              onChange={(v) => patch({ roundRobin: v })}
              disabled={!enabled}
              aria-label={`Round-robin ${cap.label} adapter`}
            />
            <span>Round</span>
          </label>
          <Button
            icon="add"
            variant="ghost"
            size="sm"
            onClick={() => setShowModelSelect(true)}
            disabled={!enabled}
            title={`Add ${cap.label} model`}
          >
            Add Model
          </Button>
        </div>
      </div>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={handleAdd}
          activeProviders={activeProviders}
          title={`Add ${cap.label} Model`}
          addedModelValues={models}
          capFilter={cap.key}
          closeOnSelect={false}
        />
      )}
    </Card>
  );
}
