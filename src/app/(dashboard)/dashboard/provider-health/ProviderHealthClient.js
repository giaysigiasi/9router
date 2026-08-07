"use client";

import { useState, useEffect, useCallback } from "react";
import Button from "@/shared/components/Button";
import { RefreshCw } from "lucide-react";

export default function ProviderHealthClient() {
  const [healthData, setHealthData] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHealthData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/providers/health");
      const data = await response.json();
      setHealthData(data.data);
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

  const getStatusIcon = (status) => {
    if (status === "healthy") return "✅";
    if (status === "degraded") return "⚠️";
    return "❌";
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Provider Health Matrix</h1>
        <Button onClick={fetchHealthData} disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          <span className="ml-2">Refresh</span>
        </Button>
      </div>
      <div className="border rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Latency (ms)</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Error Rate</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {loading ? (
              <tr>
                <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">
                  Loading...
                </td>
              </tr>
            ) : healthData.length > 0 ? (
              healthData.map((provider) => (
                <tr key={provider.name}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{provider.name}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getStatusIcon(provider.status)} {provider.status}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.latency}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{provider.errorRate}%</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">
                  No health data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}