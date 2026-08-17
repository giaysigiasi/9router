# Current Task Handoff

## Task
Add health checks for all LLM combos on `/dashboard/combos`.

## Delivered
- Passive health remains `GET /api/combos/health`.
  - Uses configured models and active provider credentials.
  - Statuses: `healthy`, `degraded`, `unavailable`, `no-models`.
- Active health added: `POST /api/combos/health`.
  - Reads all LLM combos.
  - Sends one internal chat probe to each combo name.
  - Router applies combo strategy/fallback.
  - Returns per-combo `id`, `name`, `status`, `latencyMs`, `error`, `checkedAt`.
- Dashboard `src/app/(dashboard)/dashboard/combos/page.js`.
  - Added `Check Health` button.
  - Shows pass latency or failure detail on each checked combo.
  - Probe evidence stays client-side; no DB schema/persistence added.

## Files Changed
- `src/app/api/combos/health/route.js`
- `src/app/(dashboard)/dashboard/combos/page.js`

## Verification
- `npx eslint "src/app/api/combos/health/route.js"` passed.
- `npm --prefix tests test -- combo-health` failed before test execution:
  `TypeError: Cannot read properties of undefined (reading 'config')` at `tests/unit/combo-health.test.js:4`.
- Combo page eslint reports existing errors:
  - `fetchData` accessed before declaration, line 71.
  - synchronous `setState` via `fetchModalData` effect, line 785.
  These predate health UI change.
- Rebuilt and replaced local Docker service with `docker compose up --build -d`.
- `http://127.0.0.1:20130/api/combos/health` returns expected `401 Unauthorized` without dashboard auth. Build output registers `GET` and `POST /api/combos/health`.

## Next Single Action
Sign in at `http://192.168.1.33:20130/dashboard/combos`, click `Check Health`, confirm every LLM combo gets pass/fail result plus latency/error evidence.
