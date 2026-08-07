"use client";

import { useState, useEffect } from "react";
import Input from "@/shared/components/Input";
import Badge from "@/shared/components/Badge";
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
      <div className="border rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model Name</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Provider</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Capabilities</th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Model ID</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredModels.map((model) => (
              <tr key={model.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{model.model_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{model.provider_name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex gap-1">
                    {model.capabilities?.vision && <Badge variant="outline">Vision</Badge>}
                    {model.capabilities?.json && <Badge variant="outline">JSON</Badge>}
                    {model.capabilities?.tools && <Badge variant="outline">Tools</Badge>}
                    {model.capabilities?.image && <Badge variant="outline">Image</Badge>}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  <div className="flex items-center gap-2">
                    <span>{model.id}</span>
                    <button onClick={() => handleCopy(model.id)} className="p-1">
                      {isCopied ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}