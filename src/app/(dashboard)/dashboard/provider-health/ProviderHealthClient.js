"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
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
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Avg Latency (ms)</TableHead>
              <TableHead>Error Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan="4" className="text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : healthData.length > 0 ? (
              healthData.map((provider) => (
                <TableRow key={provider.name}>
                  <TableCell className="font-medium">{provider.name}</TableCell>
                  <TableCell>{getStatusIcon(provider.status)} {provider.status}</TableCell>
                  <TableCell>{provider.latency}</TableCell>
                  <TableCell>{provider.errorRate}%</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan="4" className="text-center">
                  No health data available.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}