"use client";

import { useState } from "react";
import { Button, Card, Textarea } from "@/shared/components";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const mockSimulationResult = {
  "request": {
    "model": "gpt-4",
    "messages": [{ "role": "user", "content": "Hello, world!" }]
  },
  "result": {
    "strategy": "simple",
    "provider": "openai",
    "model": "gpt-4-1106-preview",
    "latency": 89
  }
};

export default function RouteSimulatorClient() {
  const [requestBody, setRequestBody] = useState(
    JSON.stringify(mockSimulationResult.request, null, 2)
  );
  const [simulationResult, setSimulationResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSimulate = async () => {
    setIsLoading(true);
    setSimulationResult(null);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      // In a real app, you'd POST the requestBody to an API endpoint
      // const res = await fetch('/api/routes/simulate', { method: 'POST', body: requestBody });
      // const data = await res.json();
      setSimulationResult(mockSimulationResult.result);
    } catch (error) {
      console.error("Simulation failed:", error);
      setSimulationResult({ error: "Simulation failed. Check console." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <Card>
        <div className="p-6 border-b border-border">
          <h1 className="text-2xl font-bold">Route Simulator</h1>
          <p className="text-text-muted">
            Test how 9Router will route a given OpenAI-compatible request body.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-6 p-6">
          <div>
            <h3 className="text-lg font-semibold mb-2">Request Body</h3>
            <Textarea
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              rows={15}
              className="font-mono text-sm"
              placeholder='{ "model": "gpt-4", "messages": [...] }'
            />
            <Button onClick={handleSimulate} disabled={isLoading} className="mt-4">
              {isLoading ? "Simulating..." : "Simulate Route"}
            </Button>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-2">Simulation Result</h3>
            <div className="rounded-lg bg-gray-900 p-4 h-full">
              {isLoading && <p className="text-text-muted">Running simulation...</p>}
              {simulationResult && (
                <SyntaxHighlighter language="json" style={vscDarkPlus} customStyle={{ background: 'transparent', padding: 0 }}>
                  {JSON.stringify(simulationResult, null, 2)}
                </SyntaxHighlighter>
              )}
              {!isLoading && !simulationResult && (
                <p className="text-text-muted">Result will appear here.</p>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}