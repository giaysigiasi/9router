"use client";

import { useState, useCallback } from "react";
import Button from "@/shared/components/Button";
import Card from "@/shared/components/Card";
import Input from "@/shared/components/Input";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { RefreshCw, Play, BookOpen, AlertCircle, CheckCircle, Clock } from "lucide-react";

const EXAMPLES = [
  {
    label: "Simple Chat",
    value: JSON.stringify({
      model: "gpt-4",
      messages: [{ role: "user", content: "Hello, world!" }]
    }, null, 2)
  },
  {
    label: "Vision Request",
    value: JSON.stringify({
      model: "gpt-4-vision",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "What's in this image?" },
          { type: "image_url", image_url: { url: "https://example.com/image.png" } }
        ]
      }]
    }, null, 2)
  },
  {
    label: "Tool Use",
    value: JSON.stringify({
      model: "claude-3-opus",
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [{
        type: "function",
        function: {
          name: "get_weather",
          parameters: { type: "object", properties: { location: { type: "string" } } }
        }
      }]
    }, null, 2)
  }
];

export default function RouteSimulatorClient() {
  const [requestBody, setRequestBody] = useState(EXAMPLES[0].value);
  const [simulationResult, setSimulationResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedExample, setSelectedExample] = useState(EXAMPLES[0].label);

  const handleSimulate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSimulationResult(null);

    try {
      const parsed = JSON.parse(requestBody);
      
      const res = await fetch("/api/routes/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Simulation failed");
      }

      setSimulationResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [requestBody]);

  const loadExample = (example) => {
    setSelectedExample(example.label);
    setRequestBody(example.value);
    setSimulationResult(null);
    setError(null);
  };

  const getStrategyColor = (strategy) => {
    if (strategy === "streaming") return "bg-success/15 text-success";
    if (strategy === "standard") return "bg-primary/15 text-primary";
    return "bg-surface-2 text-text";
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Play className="w-6 h-6 text-primary" />
          Route Simulator
        </h1>
        <p className="text-text-muted mt-1">
          Test how 9Router will route a given OpenAI-compatible request body.
        </p>
      </div>

      <Card>
        <div className="p-6 space-y-4">
          {/* Example Templates */}
          <div>
            <label className="block text-sm font-medium mb-2">Example Templates</label>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button
                  key={example.label}
                  onClick={() => loadExample(example)}
                  className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                    selectedExample === example.label
                      ? "bg-primary text-white border-primary"
                      : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 inline mr-1.5" />
                  {example.label}
                </button>
              ))}
            </div>
          </div>

          {/* Request Editor */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Request Body</label>
              <span className="text-xs text-text-muted">OpenAI-compatible format</span>
            </div>
            <textarea
              value={requestBody}
              onChange={(e) => setRequestBody(e.target.value)}
              rows={15}
              className="w-full p-3 border rounded-lg font-mono text-sm bg-gray-900 text-white focus:ring-2 focus:ring-primary focus:border-transparent"
              placeholder='{ "model": "gpt-4", "messages": [...] }'
            />
          </div>

          {/* Error Display */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-error/10 border border-error/20 rounded-lg">
              <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-error">Simulation Error</p>
                <p className="text-sm text-error mt-1">{error}</p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button 
              onClick={handleSimulate} 
              disabled={isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  Simulating...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Simulate Route
                </>
              )}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => {
                setRequestBody(EXAMPLES[0].value);
                setSelectedExample(EXAMPLES[0].label);
                setSimulationResult(null);
                setError(null);
              }}
            >
              Reset
            </Button>
          </div>
        </div>
      </Card>

      {/* Simulation Result */}
      {simulationResult && (
        <Card>
          <div className="p-6 space-y-4">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-success" />
              Simulation Result
            </h3>

            {/* Result Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-surface-2 rounded-lg p-4">
                <p className="text-xs text-text-muted mb-1">Strategy</p>
                <span className={`inline-block px-2.5 py-1 rounded text-sm font-medium ${getStrategyColor(simulationResult.strategy)}`}>
                  {simulationResult.strategy}
                </span>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <p className="text-xs text-text-muted mb-1">Provider</p>
                <p className="text-sm font-medium">{simulationResult.provider}</p>
              </div>
              <div className="bg-surface-2 rounded-lg p-4">
                <p className="text-xs text-text-muted mb-1">Model</p>
                <p className="text-sm font-medium font-mono">{simulationResult.routedModel}</p>
              </div>
            </div>

            {/* Capabilities */}
            {simulationResult.capabilities && (
              <div>
                <p className="text-sm font-medium mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(simulationResult.capabilities).map(([key, value]) => (
                    <span
                      key={key}
                      className={`px-2.5 py-1 rounded text-xs font-medium ${
                        value
                          ? "bg-success/15 text-success"
                          : "bg-surface-2 text-text-muted"
                      }`}
                    >
                      {key}: {value ? "✓" : "✗"}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="flex items-center gap-4 text-xs text-text-muted">
              {simulationResult.estimatedLatency && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  ~{simulationResult.estimatedLatency}ms
                </span>
              )}
              {simulationResult.timestamp && (
                <span>{new Date(simulationResult.timestamp).toLocaleString()}</span>
              )}
            </div>

            {/* Full Result JSON */}
            <div>
              <p className="text-sm font-medium mb-2">Full Response</p>
              <div className="rounded-lg bg-gray-900 p-4">
                <SyntaxHighlighter 
                  language="json" 
                  style={vscDarkPlus} 
                  customStyle={{ background: 'transparent', padding: 0, margin: 0 }}
                >
                  {JSON.stringify(simulationResult, null, 2)}
                </SyntaxHighlighter>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!simulationResult && !error && (
        <Card>
          <div className="p-8 text-center">
            <Play className="w-12 h-12 text-text-muted mx-auto mb-3 opacity-50" />
            <p className="text-text-muted">Enter a request body and click "Simulate Route" to see routing results.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
