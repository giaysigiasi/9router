"use client";

import { useState, useEffect, useMemo } from "react";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS, OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/providers";

const REFRESH_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 3600000, label: "1h" },
  { value: 7200000, label: "2h" },
  { value: 14400000, label: "4h" },
];

const GROUP_OPTIONS = [
  { value: "all", label: "All Models" },
  { value: "free", label: "Free (No Auth)" },
  { value: "freeTier", label: "Free Tier" },
  { value: "paid-apikey", label: "Paid - API Key" },
  { value: "paid-oauth", label: "Paid - OAuth" },
  { value: "byPrice", label: "By Input Credit" },
];

const ModelFinderClient = () => {
  const [models, setModels] = useState([]);
  const [filteredModels, setFilteredModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [providerFilter, setProviderFilter] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [sortField, setSortField] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [groupFilter, setGroupFilter] = useState("all");
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);

  // New states for improvements
  const [compareMode, setCompareMode] = useState(false);
  const [selectedForCompare, setSelectedForCompare] = useState([]);
  const [testResults, setTestResults] = useState({});
  const [providerHealth, setProviderHealth] = useState({});
  const [calcTokens, setCalcTokens] = useState(1000);
  const [calcModel, setCalcModel] = useState("");
  const [quickTestAllLoading, setQuickTestAllLoading] = useState(false);

  const fetchModels = async () => {
    try {
      const response = await fetch("/api/models");
      if (!response.ok) throw new Error("Failed to fetch models");
      const data = await response.json();
      setModels(data.models);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProviderHealth = async () => {
    try {
      const response = await fetch("/api/providers/health");
      if (!response.ok) return;
      const data = await response.json();
      const healthMap = {};
      (data.data || []).forEach((p) => {
        healthMap[p.name] = p;
      });
      setProviderHealth(healthMap);
    } catch (err) {
      console.error("Failed to fetch provider health:", err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedGroup = localStorage.getItem("model-group");
    if (savedGroup) setGroupFilter(savedGroup);
    const savedRefresh = localStorage.getItem("model-refresh");
    if (savedRefresh) setRefreshInterval(parseInt(savedRefresh, 10));
    fetchModels();
    fetchProviderHealth();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("model-favorites");
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem("model-group", groupFilter);
  }, [groupFilter]);

  useEffect(() => {
    localStorage.setItem("model-refresh", String(refreshInterval));
  }, [refreshInterval]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const id = setInterval(() => {
      fetchModels();
      fetchProviderHealth();
    }, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval]);

  const getProviderCategory = (providerId) => {
    if (FREE_PROVIDERS[providerId]) return "free";
    if (FREE_TIER_PROVIDERS[providerId]) return "freeTier";
    if (OAUTH_PROVIDERS[providerId]) return "paid-oauth";
    if (APIKEY_PROVIDERS[providerId]) return "paid-apikey";
    return "paid-apikey";
  };

  const filtered = useMemo(() => {
    let result = models;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.fullModel.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
      );
    }

    if (providerFilter) {
      result = result.filter((m) => m.provider === providerFilter);
    }

    if (capabilityFilter) {
      result = result.filter((m) => m.caps[capabilityFilter]);
    }

    if (groupFilter === "free") {
      result = result.filter((m) => getProviderCategory(m.provider) === "free");
    } else if (groupFilter === "freeTier") {
      result = result.filter((m) => getProviderCategory(m.provider) === "freeTier");
    } else if (groupFilter === "paid-apikey") {
      result = result.filter((m) => getProviderCategory(m.provider) === "paid-apikey");
    } else if (groupFilter === "paid-oauth") {
      result = result.filter((m) => getProviderCategory(m.provider) === "paid-oauth");
    } else if (groupFilter === "byPrice") {
      result = [...result].sort((a, b) => (a.pricing?.input || 0) - (b.pricing?.input || 0));
    }

    result = [...result].sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case "provider":
          av = a.provider;
          bv = b.provider;
          break;
        case "contextWindow":
          av = a.caps.contextWindow || 0;
          bv = b.caps.contextWindow || 0;
          break;
        case "maxOutput":
          av = a.caps.maxOutput || 0;
          bv = b.caps.maxOutput || 0;
          break;
        case "inputPrice":
          av = a.pricing?.input || 0;
          bv = b.pricing?.input || 0;
          break;
        case "outputPrice":
          av = a.pricing?.output || 0;
          bv = b.pricing?.output || 0;
          break;
        case "fullModel":
          av = a.fullModel;
          bv = b.fullModel;
          break;
        case "health": {
          const rank = (providerName) => {
            const h = providerHealth[providerName];
            if (!h) return 3;
            if (h.status === "healthy" || h.status === "ok") return 0;
            if (h.status === "degraded") return 1;
            return 2;
          };
          const ar = rank(a.provider);
          const br = rank(b.provider);
          if (ar !== br) return sortDir === "asc" ? ar - br : br - ar;
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          break;
        }
        case "name":
        default:
          av = a.name;
          bv = b.name;
          break;
      }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [models, searchQuery, providerFilter, capabilityFilter, groupFilter, sortField, sortDir]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    alert(`Copied: ${text}`);
  };

  const toggleSelect = (model) => {
    setSelectedModels((prev) =>
      prev.includes(model.fullModel)
        ? prev.filter((m) => m !== model.fullModel)
        : [...prev, model.fullModel]
    );
  };

  const toggleFavorite = (e, model) => {
    e.stopPropagation();
    setFavorites((prev) => {
      const next = prev.includes(model.fullModel)
        ? prev.filter((m) => m !== model.fullModel)
        : [...prev, model.fullModel];
      localStorage.setItem("model-favorites", JSON.stringify(next));
      return next;
    });
  };

  const testModel = async (model) => {
    setTestResults((prev) => ({
      ...prev,
      [model.fullModel]: { loading: true },
    }));

    try {
      const response = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: model.fullModel, messages: [{ role: "user", content: "ping" }] }),
      });

      const data = await response.json();
      setTestResults((prev) => ({
        ...prev,
        [model.fullModel]: {
          loading: false,
          ...data,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [model.fullModel]: {
          loading: false,
          success: false,
          error: err.message,
        },
      }));
    }
  };

  const toggleCompare = (model) => {
    setSelectedForCompare((prev) => {
      if (prev.find((m) => m.fullModel === model.fullModel)) {
        return prev.filter((m) => m.fullModel !== model.fullModel);
      }
      if (prev.length >= 4) return prev;
      return [...prev, model];
    });
  };

  const bulkDisable = async () => {
    setBulkActionLoading(true);
    try {
      const groups = {};
      selectedModels.forEach((fullModel) => {
        const model = models.find((m) => m.fullModel === fullModel);
        if (!model) return;
        const alias = model.provider;
        if (!groups[alias]) groups[alias] = [];
        groups[alias].push(model.model);
      });

      await Promise.all(
        Object.entries(groups).map(([providerAlias, ids]) =>
          fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias, ids }),
          })
        )
      );

      const res = await fetch("/api/models");
      const data = await res.json();
      setModels(data.models);
      setSelectedModels([]);
      alert(`Disabled ${selectedModels.length} model(s)`);
    } catch (err) {
      alert("Failed to disable models: " + err.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const bulkCopy = () => {
    const snippets = selectedModels.map((m) => `model: "${m}"`).join("\n");
    copyToClipboard(snippets);
  };

  const quickTestAll = async () => {
    setQuickTestAllLoading(true);
    try {
      await Promise.all(filtered.map((m) => testModel(m)));
    } finally {
      setQuickTestAllLoading(false);
    }
  };

  const formatLastUpdated = () => {
    if (!lastUpdated) return "";
    const diff = Math.floor((Date.now() - lastUpdated) / 1000);
    if (diff < 60) return "Just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const getCategoryBadge = (providerId) => {
    const cat = getProviderCategory(providerId);
    if (cat === "free") return { label: "Free", color: "bg-green-100 text-green-800" };
    if (cat === "freeTier") return { label: "Free Tier", color: "bg-blue-100 text-blue-800" };
    return null;
  };

  const getPriceColor = (inputPrice) => {
    if (!inputPrice && inputPrice !== 0) return "bg-gray-100 text-gray-800";
    if (inputPrice === 0) return "bg-green-100 text-green-800";
    if (inputPrice < 1) return "bg-blue-100 text-blue-800";
    if (inputPrice < 5) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getHealthDot = (providerName) => {
    const health = providerHealth[providerName];
    if (!health) return { color: "bg-gray-400", label: "Unknown" };
    if (health.status === "healthy" || health.status === "ok")
      return { color: "bg-green-500", label: `Healthy (${health.latency}ms)` };
    if (health.status === "degraded")
      return { color: "bg-yellow-500", label: `Degraded (${health.latency}ms)` };
    return { color: "bg-red-500", label: "Down" };
  };

  const calculateCost = () => {
    const model = models.find((m) => m.fullModel === calcModel);
    if (!model || !model.pricing) return null;
    const inputCost = (calcTokens / 1000000) * model.pricing.input;
    const outputCost = (calcTokens / 1000000) * model.pricing.output;
    return {
      input: inputCost.toFixed(4),
      output: outputCost.toFixed(4),
      total: (inputCost + outputCost).toFixed(4),
    };
  };

  if (loading) return <div>Loading models...</div>;
  if (error === "Failed to fetch models") {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Model Finder</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">Authentication required. Please log in to view models.</p>
          <a href="/login" className="text-blue-600 hover:underline mt-2 inline-block">
            Go to Login
          </a>
        </div>
      </div>
    );
  }
  if (error) return <div>Error: {error}</div>;

  const providers = [...new Set(models.map((m) => m.provider))];
  const cost = calculateCost();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Model Finder</h1>

      {/* Cost Calculator */}
      <div className="mb-4 p-3 border rounded-lg bg-gray-50">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">Cost Calculator:</span>
          <input
            type="number"
            placeholder="Tokens"
            value={calcTokens}
            onChange={(e) => setCalcTokens(Number(e.target.value))}
            className="p-2 border rounded text-sm w-32"
            min="0"
          />
          <select
            value={calcModel}
            onChange={(e) => setCalcModel(e.target.value)}
            className="p-2 border rounded text-sm"
          >
            <option value="">Select model...</option>
            {filtered.slice(0, 50).map((m) => (
              <option key={m.fullModel} value={m.fullModel}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
          {cost && (
            <span className="text-sm text-gray-700">
              In: ${cost.input} | Out: ${cost.output} | <strong>Total: ${cost.total}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="flex gap-4 mb-4 flex-wrap items-center">
        <input
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="p-2 border rounded"
        />
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="">All Providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>

        <select
          value={capabilityFilter}
          onChange={(e) => setCapabilityFilter(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="">All Capabilities</option>
          <option value="vision">Vision</option>
          <option value="search">Search</option>
          <option value="reasoning">Reasoning</option>
        </select>

        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="p-2 border rounded"
        >
          {GROUP_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 border rounded p-1">
          <span className="text-xs font-medium text-gray-600 px-1">Sort:</span>
          <select
            value={sortField}
            onChange={(e) => setSortField(e.target.value)}
            className="p-2 border rounded text-sm"
          >
            <option value="name">Name</option>
            <option value="provider">Provider</option>
            <option value="contextWindow">Context Window</option>
            <option value="maxOutput">Max Output</option>
            <option value="inputPrice">Input Price</option>
            <option value="outputPrice">Output Price</option>
            <option value="fullModel">Full Model ID</option>
            <option value="health">Health</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="px-3 py-2 border rounded text-sm hover:bg-gray-50 font-medium"
          >
            {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
          </button>
        </div>

        <div className="flex items-center gap-2 border rounded p-1">
          <span className="text-xs font-medium text-gray-600 px-1">Refresh:</span>
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(parseInt(e.target.value, 10))}
            className="p-2 border rounded text-sm"
          >
            {REFRESH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              fetchModels();
              fetchProviderHealth();
            }}
            className="px-3 py-2 border rounded text-sm hover:bg-gray-50 font-medium"
          >
            ↻
          </button>
          <button
            onClick={quickTestAll}
            disabled={quickTestAllLoading || filtered.length === 0}
            className="px-3 py-2 border rounded text-sm hover:bg-gray-50 font-medium disabled:opacity-50"
          >
            {quickTestAllLoading ? "Testing..." : "Quick Test All"}
          </button>
          {lastUpdated && <span className="text-xs text-gray-500 px-1">{formatLastUpdated()}</span>}
        </div>
      </div>

      {/* Compare Mode Toggle */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => {
            setCompareMode(!compareMode);
            if (compareMode) setSelectedForCompare([]);
          }}
          className={`px-4 py-2 rounded text-sm font-medium ${
            compareMode ? "bg-purple-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"
          }`}
        >
          {compareMode ? "Exit Compare Mode" : "Compare Models"}
        </button>
        {compareMode && selectedForCompare.length >= 2 && (
          <button
            onClick={() => {
              const modal = document.getElementById("compare-modal");
              if (modal) modal.showModal();
            }}
            className="px-4 py-2 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
          >
            Compare ({selectedForCompare.length})
          </button>
        )}
        {compareMode && (
          <span className="text-xs text-gray-600">Select up to 4 models to compare</span>
        )}
      </div>

      {selectedModels.length > 0 && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded flex gap-2 items-center flex-wrap">
          <span className="text-sm font-medium">{selectedModels.length} selected</span>
          <button
            onClick={bulkCopy}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
          >
            Copy All
          </button>
          <button
            onClick={bulkDisable}
            disabled={bulkActionLoading}
            className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
          >
            {bulkActionLoading ? "Disabling..." : "Disable Selected"}
          </button>
          <button
            onClick={() => setSelectedModels([])}
            className="px-3 py-1 border rounded text-sm hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((model) => {
          const isSelected = selectedModels.includes(model.fullModel);
          const isFav = favorites.includes(model.fullModel);
          const categoryBadge = getCategoryBadge(model.provider);
          const priceColor = getPriceColor(model.pricing?.input);
          const health = getHealthDot(model.provider);
          const testResult = testResults[model.fullModel];
          const isComparing = selectedForCompare.find((m) => m.fullModel === model.fullModel);

          return (
            <div
              key={model.fullModel}
              className={`border p-4 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer relative ${
                isSelected ? "ring-2 ring-blue-500" : ""
              }`}
              onClick={() => !compareMode && copyToClipboard(`model: "${model.routedModel}"`)}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(model)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-bold text-lg">{model.name}</h2>
                    <button
                      onClick={(e) => toggleFavorite(e, model)}
                      className="text-xl leading-none"
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      {isFav ? "⭐" : "☆"}
                    </button>
                    {categoryBadge && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${categoryBadge.color}`}>
                        {categoryBadge.label}
                      </span>
                    )}
                    {model.pricing && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${priceColor}`}>
                        ${model.pricing.input}/1M in
                      </span>
                    )}
                    {/* Provider Health Dot */}
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${health.color}`}
                      title={health.label}
                    ></span>
                  </div>
                  <p className="text-sm text-gray-500">{model.provider}</p>
                  <div className="text-xs mt-2">
                    <p>Context: {model.caps.contextWindow}</p>
                    <p>Max Output: {model.caps.maxOutput}</p>
                  </div>
                  {model.pricing && (
                    <div className="text-xs mt-2">
                      <p>Input: ${model.pricing.input}/1M tokens</p>
                      <p>Output: ${model.pricing.output}/1M tokens</p>
                    </div>
                  )}
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {model.caps.vision && <span className="bg-blue-200 px-2 py-1 rounded-full text-xs">Vision</span>}
                    {model.caps.search && <span className="bg-green-200 px-2 py-1 rounded-full text-xs">Search</span>}
                    {model.caps.reasoning && <span className="bg-purple-200 px-2 py-1 rounded-full text-xs">Reasoning</span>}
                  </div>

                  {/* Quick Test Button */}
                  <div className="mt-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        testModel(model);
                      }}
                      disabled={testResult?.loading}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-50"
                    >
                      {testResult?.loading ? "Testing..." : "Quick Test"}
                    </button>
                    {testResult && !testResult.loading && (
                      <span className={`ml-2 text-xs ${testResult.success ? "text-green-600" : "text-red-600"}`}>
                        {testResult.success ? `✅ ${testResult.latency}ms` : `❌ ${testResult.error}`}
                      </span>
                    )}
                  </div>

                  {/* Compare Checkbox */}
                  {compareMode && (
                    <div className="mt-2">
                      <label className="flex items-center gap-1 text-sm">
                        <input
                          type="checkbox"
                          checked={!!isComparing}
                          onChange={() => toggleCompare(model)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        Compare
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-gray-500 mt-8">No models match your filters.</div>
      )}

      {/* Compare Modal */}
      {compareMode && selectedForCompare.length >= 2 && (
        <dialog id="compare-modal" className="p-0 rounded-lg shadow-2xl max-w-4xl w-full mx-auto">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">Compare Models</h2>
              <button
                onClick={() => document.getElementById("compare-modal").close()}
                className="text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Feature</th>
                    {selectedForCompare.map((m) => (
                      <th key={m.fullModel} className="text-left p-2">
                        {m.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Provider</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.provider}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Context Window</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.caps.contextWindow?.toLocaleString() || "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Max Output</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.caps.maxOutput?.toLocaleString() || "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Input Price</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.pricing ? `$${m.pricing.input}/1M` : "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Output Price</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.pricing ? `$${m.pricing.output}/1M` : "N/A"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Vision</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.caps.vision ? "✅" : "❌"}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b">
                    <td className="p-2 font-medium">Search</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.caps.search ? "✅" : "❌"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="p-2 font-medium">Reasoning</td>
                    {selectedForCompare.map((m) => (
                      <td key={m.fullModel} className="p-2">
                        {m.caps.reasoning ? "✅" : "❌"}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
};

export default ModelFinderClient;