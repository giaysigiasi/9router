import { NextResponse } from "next/server";
import providers from "open-sse/providers/registry";
import { getProviderConnections } from "@/models";

export async function GET() {
  const startTime = Date.now();
  
  try {
    const connections = await getProviderConnections();

    const healthData = await Promise.all(
      providers.map(async (provider) => {
        const conn = connections.find(c => c.provider === provider.id && c.isActive);
        const apiKey = conn?.apiKey || conn?.accessToken;
        
        if (!apiKey) {
          return {
            id: provider.id,
            name: provider.name || provider.id,
            status: "no-key",
            latency: null,
            errorRate: null,
            lastChecked: new Date().toISOString(),
          };
        }

        const probeStart = Date.now();
        try {
          const ok = await probeProvider(provider.id, apiKey);
          const latency = Date.now() - probeStart;
          return {
            id: provider.id,
            name: provider.name || provider.id,
            status: ok ? "healthy" : "auth-error",
            latency,
            errorRate: ok ? 0 : 100,
            lastChecked: new Date().toISOString(),
          };
        } catch {
          const latency = Date.now() - probeStart;
          return {
            id: provider.id,
            name: provider.name || provider.id,
            status: "unreachable",
            latency,
            errorRate: 100,
            lastChecked: new Date().toISOString(),
          };
        }
      })
    );

    return NextResponse.json({ 
      data: healthData,
      meta: { total: healthData.length, healthy: healthData.filter(h => h.status === "healthy").length, duration: Date.now() - startTime }
    });
  } catch (error) {
    return NextResponse.json({ error: "Health check failed" }, { status: 500 });
  }
}

// Lightweight probe — check provider reachability with minimal request
async function probeProvider(providerId, apiKey) {
  const { PROVIDERS, resolveOllamaLocalHost, resolveXiaomiTokenplanBaseUrl } = await import("open-sse/config/providers.js");
  const { getDefaultModel } = await import("open-sse/config/providerModels.js");
  const { isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS } = await import("@/shared/constants/providers");
  const { getProviderNodeById } = await import("@/models");

  // OpenAI-compatible providers
  if (isOpenAICompatibleProvider(providerId)) {
    const node = await getProviderNodeById(providerId);
    if (!node) return false;
    const url = `${node.baseUrl?.replace(/\/$/, "")}/models`;
    const res = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
    return res.ok;
  }

  // Anthropic-compatible providers
  if (isAnthropicCompatibleProvider(providerId)) {
    const node = await getProviderNodeById(providerId);
    if (!node) return false;
    let base = node.baseUrl?.trim().replace(/\/$/, "") || "";
    if (base.endsWith("/messages")) base = base.slice(0, -9);
    const res = await fetch(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: node.defaultModel || "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
      signal: AbortSignal.timeout(5000),
    });
    return res.status !== 401 && res.status !== 403;
  }

  // Config-driven providers
  const cfg = PROVIDERS[providerId];
  if (cfg?.baseUrl) {
    if (providerId === "ollama-local") {
      const url = `${resolveOllamaLocalHost({})}/api/tags`;
      const res = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
      return res.ok;
    }
    if (providerId === "xiaomi-tokenplan") {
      const url = `${resolveXiaomiTokenplanBaseUrl({})}/models`;
      const res = await fetch(url, { headers: { "Authorization": `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) });
      return res.status !== 401;
    }
    const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
    if (cfg.authHeader === "x-api-key") headers["X-API-Key"] = apiKey;
    else headers["Authorization"] = `Bearer ${apiKey}`;
    
    // Try /models first
    const modelsUrl = cfg.baseUrl.replace(/\/chat\/completions$/, "/models").replace(/\/chatbot$/, "/models");
    try {
      const probeRes = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (probeRes.status === 401 || probeRes.status === 403) return false;
      if (probeRes.ok) return true;
    } catch { /* fallback */ }
    
    // Fallback: minimal chat probe
    const model = getDefaultModel(providerId) || "test";
    const chatRes = await fetch(cfg.baseUrl, {
      method: "POST", headers,
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(8000),
    });
    return chatRes.status !== 401 && chatRes.status !== 403;
  }

  // Default: cannot probe
  return false;
}
