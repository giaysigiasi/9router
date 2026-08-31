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

| Failure | Example | Action | Cooldown | Skip? |
|---------|---------|--------|----------|-------|
| Quota (429) | `rate limit exceeded` | `markComboModelQuotaBlocked` | 30min | Jump to last |
| Transient (502/503/504) | `bad gateway` | Wait `cooldownMs` | 5s | Fall through |
| Hard (401/403/404/500) | `invalid API key` | `markComboModelQuotaBlocked` | 5min | Jump to last |
| Client error (400) | `bad request` | Return immediately | None | N/A |
| Exception | Network error | `markComboModelQuotaBlocked` | 5min | Jump to last |

---

## Background Probe Agent

```
Server boot → 30s delay → start polling
  healthy combo  → poll every 5 min (skip, save quota)
  degraded combo → poll every 30s
  probe each model via pingModelByKind
  dead models → markComboModelQuotaBlocked
  results → comboHealth KV (for GET /combos/health)
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
comboQuotaBlocked (KV-backed)
  key:   comboName
  value: Map<model, cooldownExpiryMs>

  Writers:
    handleComboChat (on model failure)
    backgroundComboHealthPoll (on probe failure)

  Readers:
    getQuotaJumpedModels      (tail-sink reorder)
    getEarliestComboBlockExpiry (Retry-After)
    GET /api/combos/health    (UI)

  Restart: KV survives, in-memory Map reloads on boot
```

---

## Client-Side Agent Integration

```
Client reads:  Retry-After header from 503
Client reads:  GET /api/combos/health (model status)
Client does NOT: independent retry loop (no duplication)
Client does: respects Retry-After, waits, re-sends once
```
