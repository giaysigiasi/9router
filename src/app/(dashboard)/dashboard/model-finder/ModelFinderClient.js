"use client";

import { useState, useEffect } from "react";

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

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await fetch("/api/models");
        if (!response.ok) {
          throw new Error("Failed to fetch models");
        }
        const data = await response.json();
        setModels(data.models);
        setFilteredModels(data.models);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("model-favorites");
    if (saved) setFavorites(JSON.parse(saved));
  }, []);

  useEffect(() => {
    let filtered = models;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.fullModel.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q)
      );
    }

    if (providerFilter) {
      filtered = filtered.filter((m) => m.provider === providerFilter);
    }

    if (capabilityFilter) {
      filtered = filtered.filter((m) => m.caps[capabilityFilter]);
    }

    filtered = [...filtered].sort((a, b) => {
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

    setFilteredModels(filtered);
  }, [searchQuery, providerFilter, capabilityFilter, models, sortField, sortDir]);

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

  const bulkDisable = async () => {
    setBulkActionLoading(true);
    try {
      // Group by providerAlias
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

      // Refresh models
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

  if (loading) return <div>Loading models...</div>;
  if (error === "Failed to fetch models") {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-bold mb-4">Model Finder</h1>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">Authentication required. Please log in to view models.</p>
          <a href="/login" className="text-blue-600 hover:underline mt-2 inline-block">Go to Login</a>
        </div>
      </div>
    );
  }
  if (error) return <div>Error: {error}</div>;

  const providers = [...new Set(models.map((m) => m.provider))];

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Model Finder</h1>

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
          value={sortField}
          onChange={(e) => setSortField(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="name">Sort: Name</option>
          <option value="provider">Sort: Provider</option>
          <option value="contextWindow">Sort: Context Window</option>
          <option value="maxOutput">Sort: Max Output</option>
          <option value="inputPrice">Sort: Input Price</option>
          <option value="outputPrice">Sort: Output Price</option>
          <option value="fullModel">Sort: Full Model ID</option>
        </select>

        <button
          onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          className="px-3 py-2 border rounded text-sm hover:bg-gray-50"
        >
          {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
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
        {filteredModels.map((model) => {
          const isSelected = selectedModels.includes(model.fullModel);
          const isFav = favorites.includes(model.fullModel);
          return (
            <div
              key={model.fullModel}
              className={`border p-4 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer relative ${
                isSelected ? "ring-2 ring-blue-500" : ""
              }`}
              onClick={() => copyToClipboard(`model: "${model.routedModel}"`)}
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
                  <div className="flex items-center gap-2">
                    <h2 className="font-bold text-lg">{model.name}</h2>
                    <button
                      onClick={(e) => toggleFavorite(e, model)}
                      className="text-xl leading-none"
                      title={isFav ? "Remove from favorites" : "Add to favorites"}
                    >
                      {isFav ? "⭐" : "☆"}
                    </button>
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
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredModels.length === 0 && (
        <div className="text-center text-gray-500 mt-8">No models match your filters.</div>
      )}
    </div>
  );
};

export default ModelFinderClient;