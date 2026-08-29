import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleComboChat,
  getQuotaJumpedModels,
  markComboModelQuotaBlocked,
  getEarliestComboBlockExpiry,
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

  it("markComboModelQuotaBlocked stores expiry correctly", () => {
    resetComboRotation();
    const now = Date.now();
    markComboModelQuotaBlocked("combo-a", "model-x", 1000);
    // Model should be at tail (blocked)
    const out = getQuotaJumpedModels(["model-x", "model-y"], "combo-a");
    expect(out).toEqual(["model-y", "model-x"]);
  });

  it("quota block uses fixed 30min cooldown by default", async () => {
    const MAX_CAP = 30 * 60 * 1000;
    const models = ["a/b", "c/d"];
    const log = createLog();

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        if (model === "a/b") return makeResponse(429, { error: { message: "rate limit exceeded" } });
        if (model === "c/d") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "cap-test",
      comboStrategy: "fallback",
    });

    const warnCalls = log.warn.mock.calls.filter((c) => c[0] === "COMBO");
    const quotaLog = warnCalls.find((c) => c[1]?.includes("quota-limited"));
    expect(quotaLog).toBeTruthy();
    const blockMatch = quotaLog[1].match(/blocking (\d+)ms/);
    expect(blockMatch).toBeTruthy();
    const blockedMs = parseInt(blockMatch[1], 10);
    expect(blockedMs).toBe(MAX_CAP);
  });

  it("quota block with provider resetsAtMs uses precise cooldown (no cap)", async () => {
    const models = ["a/b", "c/d"];
    const log = createLog();
    // Provider reports precise reset time = 45min from now (longer than 30min default)
    const resetsAtMs = Date.now() + 45 * 60_000;

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        if (model === "a/b") {
          return makeResponse(429, { error: { message: "rate limit exceeded" }, resetsAtMs });
        }
        if (model === "c/d") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "retry-test",
      comboStrategy: "fallback",
    });

    const warnCalls = log.warn.mock.calls.filter((c) => c[0] === "COMBO");
    const quotaLog = warnCalls.find((c) => c[1]?.includes("quota-limited"));
    expect(quotaLog).toBeTruthy();
    const blockMatch = quotaLog[1].match(/blocking (\d+)ms/);
    expect(blockMatch).toBeTruthy();
    const blockedMs = parseInt(blockMatch[1], 10);
    // resetsAtMs = 45min from now → authoritative, NOT capped at 30min
    expect(blockedMs).toBeGreaterThanOrEqual(44 * 60_000); // ~45min minus test jitter
    expect(blockedMs).toBeLessThanOrEqual(46 * 60_000);
  });

  it("quota block with short resetsAtMs uses provider time (not default)", async () => {
    const models = ["a/b", "c/d"];
    const log = createLog();
    // Provider reports precise reset time = 60s from now (shorter than 30min default)
    const resetsAtMs = Date.now() + 60_000;

    await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        if (model === "a/b") {
          return makeResponse(429, { error: { message: "rate limit exceeded" }, resetsAtMs });
        }
        if (model === "c/d") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(500);
      },
      log,
      comboName: "retry-short-test",
      comboStrategy: "fallback",
    });

    const warnCalls = log.warn.mock.calls.filter((c) => c[0] === "COMBO");
    const quotaLog = warnCalls.find((c) => c[1]?.includes("quota-limited"));
    expect(quotaLog).toBeTruthy();
    const blockMatch = quotaLog[1].match(/blocking (\d+)ms/);
    expect(blockMatch).toBeTruthy();
    const blockedMs = parseInt(blockMatch[1], 10);
    // resetsAtMs = 60s from now → authoritative (even though < 30min default)
    expect(blockedMs).toBeGreaterThanOrEqual(58_000); // ~60s minus jitter
    expect(blockedMs).toBeLessThanOrEqual(65_000);
  });

  it("quota cooldown does not exceed MAX_RATE_LIMIT_COOLDOWN_MS across repeated hits", async () => {
    const MAX_CAP = 30 * 60 * 1000;
    const models = ["a/b", "c/d", "e/f", "g/h"];
    const log = createLog();

    // 5 requests: each hits a/b quota, jumps to last model.
    // All should use fixed MAX_CAP cooldown, never exceeding it.
    for (let iter = 0; iter < 5; iter++) {
      await handleComboChat({
        body: { messages: [{ role: "user", content: "hi" }] },
        models,
        handleSingleModel: async (_body, model) => {
          if (model === "a/b") return makeResponse(429, { error: { message: "rate limit exceeded" } });
          if (model === "g/h") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
          return makeResponse(500);
        },
        log,
        comboName: "multi-hit",
        comboStrategy: "fallback",
      });
    }

    const quotaLogs = log.warn.mock.calls
      .filter((c) => c[0] === "COMBO")
      .filter((c) => c[1]?.includes("quota-limited"));
    expect(quotaLogs.length).toBeGreaterThanOrEqual(1);
    for (const ql of quotaLogs) {
      const blockMatch = ql[1].match(/blocking (\d+)ms/);
      if (blockMatch) {
        const blockedMs = parseInt(blockMatch[1], 10);
        expect(blockedMs).toBeLessThanOrEqual(MAX_CAP);
        expect(blockedMs).toBeGreaterThanOrEqual(MAX_CAP); // exactly MAX_CAP
      }
    }
  });

  it("all models blocked → immediate 503 + Retry-After, zero upstream calls", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();

    // Block all three models
    markComboModelQuotaBlocked("exhausted-combo", "a/b", 60_000);
    markComboModelQuotaBlocked("exhausted-combo", "c/d", 60_000);
    markComboModelQuotaBlocked("exhausted-combo", "e/f", 60_000);

    const calls = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
      },
      log,
      comboName: "exhausted-combo",
      comboStrategy: "fallback",
    });

    // Zero upstream calls — early-exit bailed immediately
    expect(calls).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    // Must carry Retry-After header so agent loop knows when to retry
    const retryAfter = result.headers?.get?.("Retry-After");
    expect(retryAfter).toBeTruthy();
    // Body should indicate quota-limited
    const body = await result.json();
    expect(body.error?.message).toContain("quota-limited");
    // Warn log should mention all-combo-blocked
    const warnCalls = log.warn.mock.calls.filter((c) => c[0] === "COMBO");
    expect(warnCalls.some((c) => c[1]?.includes("All") && c[1]?.includes("quota-limited"))).toBe(true);
  });

  it("only first model blocked → combo proceeds, no halt", async () => {
    const models = ["a/b", "c/d", "e/f"];
    const log = createLog();

    // Only the first model is blocked
    markComboModelQuotaBlocked("partial-combo", "a/b", 60_000);

    const calls = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "c/d") return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
        return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
      },
      log,
      comboName: "partial-combo",
      comboStrategy: "fallback",
    });

    // Combo should NOT halt — front models are unblocked
    expect(calls).toContain("c/d");
    expect(result.ok).toBe(true);
  });

  it("expired block does not trigger all-blocked halt", async () => {
    const models = ["a/b", "c/d"];
    const log = createLog();

    // Block all models but with a very short expiry
    markComboModelQuotaBlocked("expired-combo", "a/b", 50);
    markComboModelQuotaBlocked("expired-combo", "c/d", 50);

    // Wait for blocks to expire
    await new Promise((r) => setTimeout(r, 60));

    const calls = [];
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models,
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return makeResponse(200, { choices: [{ message: { content: "ok" } }] });
      },
      log,
      comboName: "expired-combo",
      comboStrategy: "fallback",
    });

    // Blocks expired — combo should proceed normally
    expect(calls.length).toBeGreaterThan(0);
    expect(result.ok).toBe(true);
  });
});