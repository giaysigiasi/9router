# Combo Agentic Loop — Architecture

## Overview

The combo system routes requests through a prioritized list of models
with automatic failover, liveness tracking, and retry budgeting.
One combo = one ordered model list. No chaining. No separate reasoning/act combos.

---

## Model Lifecycle States

```
                    ┌──────────────────────────────────┐
                    │         ALIVE (default)           │
                    │   Model in active pool            │
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────▼───────────────────────┐
            ┌──────│      DEAD (cooldown)              │
            │      │   markComboModelQuotaBlocked()    │
            │      │   Sinks to combo tail             │
            │      └──────────┬───────────────────────┘
            │                 │
            │      ┌──────────▼───────────────────────┐
            │      │   COOLDOWN EXPIRED                │
            │      │   getQuotaJumpedModels evicts     │
            │      └──────────┬───────────────────────┘
            │                 ▼
            │      Returns to ALIVE pool
            │
     restart
            │
            ▼
   comboQuotaBlocked cleared → all models reset to ALIVE
```

**State transitions:**
- `ALIVE → DEAD`: model fails during request or background probe
- `DEAD → ALIVE`: cooldown expires (lazy eviction in `getQuotaJumpedModels`)
- `DEAD → ALIVE`: server restart clears in-memory state
- `DEAD → DEAD`: repeated failure refreshes cooldown

**Tier view** (for `GET /api/combos/health.modelTiers`, sourced from
`getComboModelTiers`): `healthy` = ALIVE; `retryable` = DEAD with remaining cooldown
longer than 5 min (probe-set long cooldown); `exhausted` = DEAD, remaining within 5 min. Tiers are a
read-only projection — the runtime keeps a single ALIVE/DEAD Map.

---

## Request Flow: handleComboChat

```
Client request
      │
      ▼
┌─────────────────────────┐
│ 1. getRotatedModels     │  round-robin strategy
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 2. reorderByCapabilities│  hard caps (vision/pdf/audio)
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 3. getQuotaJumpedModels │  sink dead models to tail
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────┐
│ 4. All-blocked early    │  if every model quota-blocked:
│    exit check           │    return 503 + Retry-After
└──────────┬──────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────┐
│ 5. AGENTIC RETRY LOOP                               │
│                                                     │
│   while (Date.now() < deadline):                    │
│     ┌───────────────────────────────────────────┐   │
│     │ INNER PASS: for each model in order       │   │
│     │   skip if blocked → handleSingleModel     │   │
│     │   success → return 2xx                    │   │
│     │   failure → mark dead, jump/skip          │   │
│     │   allBlocked? → break                     │   │
│     │   sleep(1s) between passes                │   │
│     └───────────────────────────────────────────┘
└──────────┬──────────────────────────────────────────┘
           │ budget exhausted
           ▼
┌─────────────────────────┐
│ 6. Terminal 503         │
│    + Retry-After        │
└─────────────────────────┘
```

---

## Dead Model Handling (per failure type)

Cooldowns are classified via `checkFallbackError()` (from `errorConfig.js` ERROR_RULES),
decorated with per-path tiers. Two distinct paths:

**Request path** (`handleComboChat`):
- `reason === "quota"` → exponential backoff (`getQuotaCooldown`, cap 5 min) or provider-reported
  `resetsAtMs`, whichever is longer (`MAX_RATE_LIMIT_COOLDOWN_MS` floor).
- Hard 4xx (401/403/404/500, not 429) → `markComboModelQuotaBlocked` for
  `BROKEN_MODEL_COOLDOWN_MS` (5 min), jump to last model.
- Thrown exception (network/DNS/timeout) → `markComboModelQuotaBlocked` for
  `BROKEN_MODEL_COOLDOWN_MS` (5 min) in the catch branch, jump to last model.
- Transient 502/503/504 → wait `cooldownMs` (30 s `TRANSIENT_COOLDOWN_MS`), fall through, no block.
- Client error 400 → return immediately, no fallback.

**Probe path** (`classifyProbeCooldown`, background poll + health POST/GET):
- quota → 15 min, other/auth → 5 min, transient/connection → 2 min.
- Returns `0` when the probe should NOT block the model (fixes false-blocking).

| Failure | Request path | Probe path | Skip? |
|---------|--------------|------------|-------|
| Quota (429) | `markComboModelQuotaBlocked`, backoff / resetsAtMs (floor 5 min) | 15 min tier | Jump to last |
| Transient (502/503/504) | Wait 30 s, fall through (no block) | 2 min tier | Fall through |
| Hard (401/403/404/500) | `markComboModelQuotaBlocked`, 5 min (`BROKEN_MODEL_COOLDOWN_MS`) | 5 min tier | Jump to last |
| Client error (400) | Return immediately | N/A | N/A |
| Exception (thrown) | `markComboModelQuotaBlocked`, 5 min (catch branch) | 2 min tier (`status == null` → transient) | Jump to last |

---

## Background Probe Agent

```
Server boot → 30s delay → start polling
  poll every 2h (POLL_INTERVAL_MS, COMBO_HEALTH_POLL_MS env override)
  probe combo via pingModelByKind(chat)
  degraded combo → probe each model individually
  failed model → classifyProbeCooldown(status, errorText) → 3-tier cooldown:
    quota → 15min, other/auth → 5min, transient/connection → 2min, 0 → don't block
  blocked models → markComboModelQuotaBlocked (auto push to tail)
  merged results → comboHealth KV  (for GET /combos/health)
```

---

## Model Role Tagging

Each model in a combo can have an optional `role` field:

```
Combo: "my-project-llm"
models: [
  { model: "claude-3.5-sonnet", role: "reasoner" },
  { model: "gpt-4o",            role: "reasoner" },
  { model: "gpt-4o-mini",       role: "actor" },
  { model: "gemini-flash",      role: "actor" },
]
```

**Role = metadata only.** No pipeline, no chaining, no separate combos.
Role influences reorder priority but does not change the fallback loop.

---

## Retry Budget

```
REQUEST_BUDGET_MS = 10_000  (max 10s per request)
PASS_GAP_MS      =  1_000  (1s pause between passes)

Stop conditions:
  1. result.ok → success, return immediately
  2. !shouldFallback → client error (400), return immediately
  3. Budget exhausted → 503
  4. All models quota-blocked → break inner pass, wait, retry

Never stops:
  - A single dead model → sinks to tail, retries alive ones
  - Half dead → half alive, loop continues
```

---

## Liveness Store

```
comboQuotaBlocked (in-memory Map, process-local)
  key:   comboName
  value: Map<model, cooldownExpiryMs>

  Writers:
    handleComboChat (on model failure)
    backgroundComboHealthPoll (on probe failure)

  Readers:
    getQuotaJumpedModels      (tail-sink reorder)
    getEarliestComboBlockExpiry (Retry-After)
    getComboModelTiers        (runtime tier status → GET /api/combos/health)
    GET /api/combos/health    (UI)

  Restart: NOT persisted — Map rebuilt empty on boot. All models reset to ALIVE,
  re-blocked lazily by real request failures / next 2h probe tick.
  Earlier "KV survives restart" claim is wrong; KV stores only the probe snapshot
  (comboHealth) + poll metadata (comboHealthMeta).
```

## Runtime Tier Status

`getComboModelTiers(comboName, models)` reads the same `comboQuotaBlocked` Map and
returns per-model status for the health endpoint:

```
[{ model, tier, blockedUntilMs }]

tier:
  "healthy"    → not blocked, in active pool
  "retryable"  → blocked with remaining cooldown > 5 min (probe-set long cooldown)
  "exhausted"  → blocked, remaining ≤ 5 min (request-path hard-failure/exception cooldown)

Exposed per combo as `modelTiers` in GET /api/combos/health.
Lazy-evicts expired entries on read. Models absent from the combo list are excluded.
```

## All-Blocked Early Exit

`handleComboChat` computes the blocked set from `getQuotaJumpedModels` and, if every
model is quota-blocked, returns 503 + `Retry-After` immediately with zero upstream
calls (`unavailableResponse`, earliest block expiry). Prevents churning a suite of
cooldown-exhausted providers on every request.

---

## Client-Side Agent Integration

```
Client reads:  Retry-After header from 503
Client reads:  GET /api/combos/health (model status)
Client does NOT: independent retry loop (no duplication)
Client does: respects Retry-After, waits, re-sends once
```
