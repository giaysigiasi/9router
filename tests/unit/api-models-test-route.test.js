import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for POST /api/models/test.
//
// The "check" button next to every model (e.g. gpt-5.6-luna) calls this route.
// Frontend consumers (page.js, CompatibleModelsSection.js, AddCustomModelModal.js)
// all read `data.ok` to decide green/red. A regression that replaced the real
// ping with a mock returning `success: true` (no `ok` field) silently broke
// every model check on the UAT server while local (master) kept working.
//
// This test pins the contract: the route must delegate to pingModelByKind and
// forward its `{ ok, latencyMs, error, status }` shape verbatim.

vi.mock("@/app/api/models/test/ping", () => ({
  pingModelByKind: vi.fn(),
}));

import { pingModelByKind } from "@/app/api/models/test/ping";
const pingMock = pingModelByKind;
const okResult = { ok: true, latencyMs: 42, error: null, status: 200 };

import { POST } from "@/app/api/models/test/route";

describe("POST /api/models/test", () => {
  beforeEach(() => {
    pingMock.mockClear();
    pingMock.mockResolvedValue(okResult);
  });

  it("delegates to pingModelByKind with the model and default kind", async () => {
    const req = { json: async () => ({ model: "gpt-5.6-luna" }) };
    const res = await POST(req);
    const data = await res.json();

    expect(pingMock).toHaveBeenCalledTimes(1);
    expect(pingMock).toHaveBeenCalledWith("gpt-5.6-luna", "llm");
    expect(res.status).toBe(200);
    expect(data.ok).toBe(true);
    expect(data).toHaveProperty("latencyMs");
    expect(data).toHaveProperty("status");
  });

  it("forwards the kind argument when provided", async () => {
    const req = { json: async () => ({ model: "text-embedding-3", kind: "embedding" }) };
    await POST(req);

    expect(pingMock).toHaveBeenCalledWith("text-embedding-3", "embedding");
  });

  it("returns 400 when model is missing", async () => {
    const req = { json: async () => ({}) };
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(pingMock).not.toHaveBeenCalled();
    expect(data).toHaveProperty("error");
  });

  it("propagates a failed ping as ok:false (not a mock success)", async () => {
    pingMock.mockResolvedValueOnce({ ok: false, latencyMs: 5, error: "HTTP 500", status: 500 });
    const req = { json: async () => ({ model: "gpt-5.6-luna" }) };
    const res = await POST(req);
    const data = await res.json();

    expect(data.ok).toBe(false);
    expect(data.error).toBe("HTTP 500");
  });

  it("does NOT return a mock success shape (guards against the regression)", async () => {
    const req = { json: async () => ({ model: "gpt-5.6-luna" }) };
    const res = await POST(req);
    const data = await res.json();

    // The broken mock returned { success: true, status: "ok", ... } with no `ok`.
    // Consumers check `data.ok`, so a truthy `ok` is the real contract.
    expect(data.ok).toBe(true);
    expect(data).not.toHaveProperty("success");
  });
});