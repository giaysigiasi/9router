import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleComboChat,
  getQuotaJumpedModels,
  markComboModelQuotaBlocked,
  resetComboRotation,
} from "../../open-sse/services/combo.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

function makeResponse(status, body = {}) {
  return {
    ok: status < 400,
    status,
    statusText: body.error?.message || String(status),
    clone: () => makeResponse(status, body),
    json: async () => body,
  };
}

function createLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("combo quota-jump", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("checkFallbackError returns reason=quota for 429/rate-limit text", () => {
    const r1 = checkFallbackError(429, "rate limit exceeded");
    expect(r1.shouldFallback).toBe(true);
    expect(r1.reason).toBe("quota");

    const r2 = checkFallbackError(429, "quota exceeded");
    expect(r2.reason).toBe("quota");

    const r3 = checkFallbackError(401, "invalid api key");
    expect(r3.shouldFallback).toBe(true);
    expect(r3.reason).toBe("other");
  });

  it("getQuotaJumpedModels sinks blocked model to tail", () => {
    const models = ["a/b", "c/d", "e/f"];
    markComboModelQuotaBlocked("mycombo", "a/b", 60_000);
    const out = getQuotaJumpedModels(models, "mycombo");
    expect(out).toEqual(["c/d", "e/f", "a/b"]);
  });

  it("getQuotaJumpedModels evicts expired blocks", async () => {
    const models = ["a/b", "c/d"];
    markComboModelQuotaBlocked("mycombo", "a/b", 50);
    await new Promise((r) => setTimeout(r, 60));
    const out = getQuotaJumpedModels(models, "mycombo");
    expect(out).toEqual(["a/b", "c/d"]);
  });

  it("quota on first model jumps to last, skipping middle", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();
    const calls = [];

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "a/b") return makeResponse(429, { error: { message: "rate limit exceeded" } });
        if (model === "e/f") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500, { error: { message: "fail" } });
      },
      log,
      comboName: "mycombo",
      comboStrategy: "fallback",
    });

    expect(calls).toEqual(["a/b", "e/f"]);
    expect(result.ok).toBe(true);
  });

  it("blocked model stays at tail on subsequent request", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();

    // First request: quota on a/b
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        if (model === "a/b") return makeResponse(429, { error: { message: "rate limit exceeded" } });
        if (model === "e/f") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "mycombo",
      comboStrategy: "fallback",
    });

    // Second request: should start from c/d (a/b blocked)
    const calls = [];
    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "e/f") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "mycombo",
      comboStrategy: "fallback",
    });

    expect(calls[0]).toBe("c/d");
  });

  it("non-quota error keeps sequential fallback", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();
    const calls = [];

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "a/b") return makeResponse(401, { error: { message: "invalid api key" } });
        if (model === "c/d") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "mycombo",
      comboStrategy: "fallback",
    });

    expect(calls).toEqual(["a/b", "c/d"]);
    expect(result.ok).toBe(true);
  });

  it("quota on last model does not loop infinitely", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();
    const calls = [];

    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return makeResponse(429, { error: { message: "rate limit exceeded" } });
      },
      log,
      comboName: "mycombo",
      comboStrategy: "fallback",
    });

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
  });
});