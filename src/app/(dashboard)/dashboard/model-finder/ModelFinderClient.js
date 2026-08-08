"use client";

import { useState, useEffect } from "react";

const ModelFinderClient = () => {
  const [models, setModels] = useState([]);
  const [filteredModels, setFilteredModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [providerFilter, setProviderFilter] = useState("");
  const [capabilityFilter, setCapabilityFilter] = useState("");

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
    let filtered = models;

    if (providerFilter) {
      filtered = filtered.filter((m) => m.provider === providerFilter);
    }

    if (capabilityFilter) {
      filtered = filtered.filter((m) => m.caps[capabilityFilter]);
    }

    setFilteredModels(filtered);
  }, [providerFilter, capabilityFilter, models]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    // Add a toast notification here in a real app
    alert(`Copied: ${text}`);
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

      <div className="flex gap-4 mb-6">
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
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredModels.map((model) => (
          <div
            key={model.fullModel}
            className="border p-4 rounded-lg shadow hover:shadow-md transition-shadow cursor-pointer"
            onClick={() => copyToClipboard(`model: "${model.routedModel}"`)}
          >
            <h2 className="font-bold text-lg">{model.name}</h2>
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
            <div className="flex gap-2 mt-2">
              {model.caps.vision && <span className="bg-blue-200 px-2 py-1 rounded-full text-xs">Vision</span>}
              {model.caps.search && <span className="bg-green-200 px-2 py-1 rounded-full text-xs">Search</span>}
              {model.caps.reasoning && <span className="bg-purple-200 px-2 py-1 rounded-full text-xs">Reasoning</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModelFinderClient;