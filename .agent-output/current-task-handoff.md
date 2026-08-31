# Current Task Handoff

## Goal
Fix "Check Health" button on /dashboard/combos — POST /api/combos/health returned 500 "Failed to probe combo health" because `pingModelByKind` had no try-catch.

## What Was Done (COMPLETE ✅)

### Fix: try-catch around combo-level probe
**File**: `src/app/api/combos/health/route.js` POST handler

**Problem**: `pingModelByKind(combo.name, "chat")` on line 71 had no try-catch. If the internal fetch to `http://127.0.0.1:{PORT}/api/v1/chat/completions` threw a network error (connection refused, AbortSignal timeout, DNS failure), the error propagated through `Promise.all` into the outer catch block, returning a generic 500 "Failed to probe combo health" — killing the health check for ALL combos.

**Fix**: Wrapped the entire combo map callback body in `try { ... } catch (err) { ... }`, returning a graceful `{ id, name, status: "unavailable", error: err.message, checkedAt }` per combo. This matches the pattern already used in `src/lib/backgroundComboHealthPoll.js` (lines 70-101).

**Note**: The inner model-level probes (line 76-80) already had try-catch — only the top-level combo probe was missing it.

### Verification (2026-08-30)
- Tested `POST /api/combos/health` from inside container with CLI token auth → **200 OK**
- Combos with timeouts gracefully return `"status": "unavailable"` with error message
- Healthy combos return `"status": "healthy"` with latencyMs
- No "Error probing combo health" errors in server logs
- Fix is confirmed working end-to-end

### Tests
- 15/15 combo-quota-jump tests passing
- 4/4 ping-reasoning-models tests passing

---

## Previous Goal (D1 — COMPLETE ✅)
Fix free-model quota exhaustion in agent loops — combo fallback cooldown was too short (2s) causing repeated retries against exhausted free-tier models.

## What Was Done (D1 — COMPLETE ✅)

### Phase 1: Fixed 30min cooldown
1. Changed quota cooldown from ~2s to fixed `MAX_RATE_LIMIT_COOLDOWN_MS` (30min)
2. Removed backoffLevel tracking (fundamentally broken in combo context)

### Phase 2: Data flow fix (resetsAtMs threading)
The `retryAfter` ISO string branch was dead code — combo.js read `errorBody?.retryAfter` but the response body never contained it. Fixed by threading `resetsAtMs` (precise ms epoch) through the error response chain:

1. **`open-sse/utils/error.js`**:
   - `buildErrorBody(statusCode, message, resetsAtMs)` — adds `resetsAtMs` to response body JSON
   - `errorResponse(statusCode, message, resetsAtMs)` — passes through
   - `createErrorResult(statusCode, message, resetsAtMs)` — now puts `resetsAtMs` in response body (previously was only on result object, not in body)

2. **`open-sse/services/combo.js`**:
   - Reads `errorBody?.resetsAtMs` from response body (replaces dead `retryAfter` ISO path)
   - If `resetsAtMs` available → use `resetsAtMs - now` as precise cooldown (provider-authoritative, NO cap)
   - Else → `MAX_RATE_LIMIT_COOLDOWN_MS` (30min) default
   - Removed `Math.min(effectiveCooldown, MAX_CAP)` cap that was incorrectly capping provider-reported longer windows

3. **`tests/unit/combo-quota-jump.test.js`** (12 tests, all passing):
   - "quota block with provider resetsAtMs uses precise cooldown (no cap)" — 45min → ~45min (not capped)
   - "quota block with short resetsAtMs uses provider time" — 60s → ~60s (respects provider)

### Phase 3: All-models-blocked early-exit (COMPLETE ✅)

**Problem**: When all combo models exhausted, the loop burned N upstream 429 calls then returned a bare 503 with no Retry-After → agent loop stalled.

**Fix**: Early-exit check after quota-jump reorder — when `blockedCount >= rotatedModels.length`, return `503` + `Retry-After` immediately with zero upstream calls.

**Implementation**:
- **`open-sse/services/combo.js`**:
  - `getEarliestComboBlockExpiry(comboName)` — returns the soonest active block expiry Date (lazy-evicts expired entries)
  - Early-exit in `handleComboChat` after `getQuotaJumpedModels`: checks `blocked.size >= models.length` → returns `unavailableResponse(503, "All combo models are quota-limited", retryIso, retryHuman)`
  - `unavailableResponse` already builds the `Retry-After` header

- **Tests** (15 total, all passing):
  - "all models blocked → immediate 503 + Retry-After, zero upstream calls" — verifies no `handleSingleModel` calls, 503 status, Retry-After header, quota-limited message
  - "only first model blocked → combo proceeds, no halt" — verifies combo doesn't halt when only some models blocked
  - "expired block does not trigger all-blocked halt" — blocks expire → combo proceeds normally

## Key Design Decisions
- `resetsAtMs` is authoritative when provider reports it (codex `resets_at`, gemini `RetryInfo`)
- No upper cap on provider-reported reset time — trust the provider
-30min default only when no `resetsAtMs` available (most providers)
- For daily quotas without resetsAtMs: still churns ~48 retries/day (addressed by D2 round-robin)

## Data Flow (now complete)
```
codex:parseUpstreamError → chatCore → createErrorResult(status, msg, resetsAtMs)
  → errorResponse(status, msg, resetsAtMs) → buildErrorBody → {resetsAtMs in body}
  → combo reads errorBody.resetsAtMs → precise cooldown
```

## State
- **Done**: D1 complete — fixed cooldown + resetsAtMs data flow + all-blocked early-exit
- **Container**: Running on port 20130
- **Tests**: 15/15 passing (vitest)

## Next Tasks
1. **D2**: Configure round-robin rotation for agent combos to spread load across 18 models
2. **D3**: Persist `comboQuotaBlocked` to KV for redeploy survival
3. **D4** (optional): Absolute max cap (24h) on resetsAtMs-derived cooldown as defense against provider clock skew

## Role Thresholds
| Role | minCtx | requireReasoning | minStrength | Use case |
|---|---|---|---|---|
| pm | 64k | no | any | planning, docs, fast/cheap |
| ba | 128k | no | any | requirements analysis |
| dev | 200k | yes | any | heavy coding |
| qa | 128k | yes | any | testing, bug hunting |
| supervisor | 200k | yes | ≥3 | orchestration, top models only |

## Usage
```bash
# Inspect which models each role would get per CLI
node scripts/build-cli-combos.mjs --list --roles pm,ba,dev,qa,supervisor

# Dry-run combo creation
node scripts/build-cli-combos.mjs --check --roles pm,ba,dev,qa,supervisor

# Apply combos
node scripts/build-cli-combos.mjs --apply --roles pm,ba,dev,qa,supervisor
```

## Output combos (example for codex, non-account)
- `codex-pm` — broad cheap models, no reasoning required
- `codex-ba` — big ctx models, no reasoning required
- `codex-dev` — reasoning models, big ctx
- `codex-qa` — reasoning models
- `codex-supervisor` — top-tier reasoning models only (strengthScore ≥ 3)

## Next
1. Run `--list --roles pm,ba,dev,qa,supervisor` on host to see per-role candidate pools
2. Tune ROLE_PROFILES thresholds if needed
3. Run `--check` then `--apply`

## Files
- **Read**: `open-sse/providers/capabilities.js`, registry files, `capacityAdapter.js`, `combo.js`, `providers.js`
- **Edited**: `scripts/build-cli-combos.mjs` — added `--roles` flag, `ROLE_PROFILES`, `ROLE_MODE`, `EFFECTIVE_CROSS_PROVIDER`, `passesRoleFilter()`, `getRoleModels()`, role-mode branches in `listModels()` and `runOnce()`, 10 new self-check tests