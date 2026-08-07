"use client";

import { useState, useEffect } from "react";
import { Input } from "@/shared/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import { Badge } from "@/shared/components/ui/badge";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { Check, Copy } from "lucide-react";

export default function ModelFinderClient() {
  const [models, setModels] = useState([]);
  const [filteredModels, setFilteredModels] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const { isCopied, copyToClipboard } = useCopyToClipboard();

  useEffect(() => {
    async function fetchModels() {
      try {
        const response = await fetch("/api/models");
        const data = await response.json();
        setModels(data.data);
        setFilteredModels(data.data);
        const uniqueProviders = [...new Set(data.data.map((model) => model.provider_name))];
        setProviders(uniqueProviders);
      } catch (error) {
        console.error("Failed to fetch models:", error);
      }
    }
    fetchModels();
  }, []);

  useEffect(() => {
    let currentModels = models;

    if (selectedProvider) {
      currentModels = currentModels.filter(
        (model) => model.provider_name === selectedProvider
      );
    }

    if (searchTerm) {
      currentModels = currentModels.filter((model) =>
        model.model_name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredModels(currentModels);
  }, [searchTerm, selectedProvider, models]);

  const handleCopy = (text) => {
    copyToClipboard(text);
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-bold mb-4">Model Finder</h1>
      <div className="flex gap-4 mb-4">
        <Input
          placeholder="Search models..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
        <select
          value={selectedProvider}
          onChange={(e) => setSelectedProvider(e.target.value)}
          className="border rounded-md px-2 py-1"
        >
          <option value="">All Providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </div>
      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Model ID</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredModels.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="font-medium">{model.model_name}</TableCell>
                <TableCell>{model.provider_name}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {model.capabilities?.vision && <Badge variant="outline">Vision</Badge>}
                    {model.capabilities?.json && <Badge variant="outline">JSON</Badge>}
                    {model.capabilities?.tools && <Badge variant="outline">Tools</Badge>}
                    {model.capabilities?.image && <Badge variant="outline">Image</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>{model.id}</span>
                    <button onClick={() => handleCopy(model.id)} className="p-1">
                      {isCopied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}