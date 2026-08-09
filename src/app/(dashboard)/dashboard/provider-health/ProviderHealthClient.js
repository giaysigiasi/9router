"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Button from "@/shared/components/Button";
import Input from "@/shared/components/Input";
import { RefreshCw, Search, AlertTriangle, CheckCircle, XCircle, Activity } from "lucide-react";

export default function ProviderHealthClient() {
  const [healthData, setHealthData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(null);

  const fetchHealthData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/providers/health");
      const data = await response.json();
      setHealthData(data.data || []);
    } catch (error) {
      console.error("Failed to fetch provider health:", error);
      setHealthData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealthData();
  }, [fetchHealthData]);

  // Auto-refresh every 30s when enabled
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHealthData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealthData]);

  const filteredAndSortedData = useMemo(() => {
    let result = [...healthData];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(p => 
        p.name?.toLowerCase().includes(query) ||
        p.status?.toLowerCase().includes(query)
      );
    }

    // Filter by status
    if (statusFilter !== "all") {
      result = result.filter(p => p.status === statusFilter);
    }

    // Sort
    result.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];
      
      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();
      
      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [healthData, searchQuery, statusFilter, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const getStatusIcon = (status) => {
    if (status === "healthy") return <CheckCircle className="w-5 h-5 text-success" />;
    if (status === "degraded") return <AlertTriangle className="w-5 h-5 text-warning" />;
    if (status === "no-key") return <AlertTriangle className="w-5 h-5 text-warning" />;
    return <XCircle className="w-5 h-5 text-error" />;
  };

  const getStatusColor = (status) => {
    if (status === "healthy") return "bg-success/15 text-success";
    if (status === "degraded") return "bg-warning/15 text-warning";
    if (status === "no-key") return "bg-warning/15 text-warning";
    return "bg-error/15 text-error";
  };

  const getStatusLabel = (status) => {
    switch (status) {
      case "healthy": return "Healthy";
      case "degraded": return "Degraded";
      case "no-key": return "No API Key";
      case "auth-error": return "Auth Error";
      case "unreachable": return "Unreachable";
      default: return status || "Unknown";
    }
  };

  const stats = useMemo(() => {
    const total = healthData.length;
    const healthy = healthData.filter(p => p.status === "healthy").length;
    const degraded = healthData.filter(p => p.status === "degraded").length;
    const unhealthy = healthData.filter(p => p.status !== "healthy" && p.status !== "degraded").length;
    const avgLatency = healthData.length > 0 
      ? Math.round(healthData.reduce((sum, p) => sum + (Number(p.latency) || 0), 0) / healthData.length)
      : 0;
    return { total, healthy, degraded, unhealthy, avgLatency };
  }, [healthData]);

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="w-6 h-6 text-primary" />
          Provider Health Matrix
        </h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh (30s)
          </label>
          <Button onClick={fetchHealthData} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            <span className="ml-2">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-text-muted">Total</p>
          <p className="text-xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-success/10 rounded-lg p-3">
          <p className="text-xs text-text-muted">Healthy</p>
          <p className="text-xl font-bold text-success">{stats.healthy}</p>
        </div>
        <div className="bg-warning/10 rounded-lg p-3">
          <p className="text-xs text-text-muted">Degraded</p>
          <p className="text-xl font-bold text-warning">{stats.degraded}</p>
        </div>
        <div className="bg-error/10 rounded-lg p-3">
          <p className="text-xs text-text-muted">Unhealthy</p>
          <p className="text-xl font-bold text-error">{stats.unhealthy}</p>
        </div>
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-text-muted">Avg Latency</p>
          <p className="text-xl font-bold">{stats.avgLatency}ms</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search providers..."
            className="pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg bg-white text-sm"
        >
          <option value="all">All Status</option>
          <option value="healthy">Healthy</option>
          <option value="degraded">Degraded</option>
          <option value="unhealthy">Unhealthy</option>
        </select>
      </div>

      {/* Health Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-surface-2">
              <tr>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-3"
                  onClick={() => handleSort("name")}
                >
                  Provider <SortIcon field="name" />
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-3"
                  onClick={() => handleSort("status")}
                >
                  Status <SortIcon field="status" />
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-3"
                  onClick={() => handleSort("latency")}
                >
                  Avg Latency <SortIcon field="latency" />
                </th>
                <th 
                  scope="col" 
                  className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider cursor-pointer hover:bg-surface-3"
                  onClick={() => handleSort("errorRate")}
                >
                  Error Rate <SortIcon field="errorRate" />
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center">
                    <RefreshCw className="w-8 h-8 animate-spin mx-auto text-text-muted" />
                    <p className="text-sm text-text-muted mt-2">Loading health data...</p>
                  </td>
                </tr>
              ) : filteredAndSortedData.length > 0 ? (
                filteredAndSortedData.map((provider) => (
                  <tr key={provider.name} className="hover:bg-surface-2 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-text">{provider.name}</div>
                      {provider.lastCheck && (
                        <div className="text-xs text-text-muted">
                          Last check: {new Date(provider.lastCheck).toLocaleTimeString()}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(provider.status)}`}>
                        {getStatusIcon(provider.status)}
                        {getStatusLabel(provider.status)}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                      {provider.latency ? `${provider.latency}ms` : "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-text">
                      {provider.errorRate !== undefined ? `${provider.errorRate}%` : "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedProvider(provider)}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="px-6 py-8 text-center text-sm text-text-muted">
                    {searchQuery || statusFilter !== "all" 
                      ? "No providers match your filters." 
                      : "No health data available."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Provider Detail Modal */}
      {selectedProvider && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedProvider(null)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold">{selectedProvider.name}</h2>
                <button
                  onClick={() => setSelectedProvider(null)}
                  className="text-text-muted hover:text-text"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-text-muted">Status:</span>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(selectedProvider.status)}`}>
                    {getStatusIcon(selectedProvider.status)}
                    {getStatusLabel(selectedProvider.status)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Latency:</span>
                  <span className="font-medium">{selectedProvider.latency ? `${selectedProvider.latency}ms` : "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Error Rate:</span>
                  <span className="font-medium">{selectedProvider.errorRate !== undefined ? `${selectedProvider.errorRate}%` : "N/A"}</span>
                </div>
                {selectedProvider.lastCheck && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">Last Check:</span>
                    <span className="font-medium">{new Date(selectedProvider.lastCheck).toLocaleString()}</span>
                  </div>
                )}
                {selectedProvider.error && (
                  <div className="mt-4 p-3 bg-error/10 rounded border border-error/20">
                    <p className="text-sm text-error font-medium">Error:</p>
                    <p className="text-sm text-error mt-1">{selectedProvider.error}</p>
                  </div>
                )}
                {selectedProvider.metadata && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Additional Info:</p>
                    <pre className="bg-surface-2 p-3 rounded text-xs overflow-x-auto">
                      {JSON.stringify(selectedProvider.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
