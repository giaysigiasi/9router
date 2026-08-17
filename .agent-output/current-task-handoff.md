# Current Task Handoff

## Task
Add health status for every combo at `/dashboard/combos`.

## Strategy Selected
Strategy 1: configuration health. Local aggregate. No provider probes, quota use, or cost.

Status rules:
- `healthy`: every combo model has active routable provider connection.
- `degraded`: some models routable.
- `unavailable`: no models routable.
- `no-models`: combo has zero models.

## Completed
- Added `src/lib/comboHealth.js`.
  - `getComboHealth(combo, connections)`
  - `getCombosHealth(combos, connections)`
- Added `src/app/api/combos/health/route.js`.
  - `GET /api/combos/health`
  - Reads `getCombos()` and `getProviderConnections()` in parallel.
  - Returns `{ health: [...] }`.
- Updated `src/app/(dashboard)/dashboard/combos/page.js`.
  - Fetches `/api/combos/health`.
  - Maps records by combo ID.
  - Renders health badge next to combo name.
- Added `tests/unit/combo-health.test.js`.
- Added client-only combo sorter in `src/app/(dashboard)/dashboard/combos/page.js`.
  - Default preserves API order.
  - Name sorts A–Z.
  - Health orders unavailable, degraded, no-models, then healthy.
  - Model count orders high to low.
  - Name resolves sort ties.
- Confirmed routability supports active API-key and OAuth-token connections.
- Direct Node assert check passed for `no-models`, `unavailable`, `degraded`, `healthy`, and aggregate combo identity.

## Validation
- `git diff --check` passed.
- `npx eslint "src/app/(dashboard)/dashboard/combos/page.js"` still reports pre-existing file errors: `fetchData` declared after its `useEffect` caller, plus modal `setState` inside effect. No sorter-specific lint finding.
- `npm --prefix tests test -- combo-health.test.js` cannot collect tests. Existing `cheapkey-provider.test.js` fails identically with `TypeError: Cannot read properties of undefined (reading 'config')` at `describe`, before test bodies run. Baseline test runner issue.
- `npm run build` failed outside combo-health code: `EPERM: operation not permitted, readlink 'C:\Users\D30PC\AppData\Local\Temp\GPU-Z-v8.sys'`, then Next's `FlightClientEntryPlugin` threw while handling that filesystem error.

## Modified Files
- `src/lib/comboHealth.js` — new.
- `src/app/api/combos/health/route.js` — new.
- `src/app/(dashboard)/dashboard/combos/page.js` — modified.
- `tests/unit/combo-health.test.js` — new.

## Docker Validation
- `docker compose build 9router` completed successfully. Image: `9router:local`.
- `docker compose up -d 9router` recreated and started `9router-source`; port `20130` bound.
- Container log: Next.js ready, SQLite DB opened without startup errors.
- Compiled Docker bundle contains `/api/combos/health` route and dashboard combo chunk references `/api/combos/health`.
- Unauthenticated `GET http://127.0.0.1:20130/api/combos/health` correctly returns `401`, because dashboard API routes require session or CLI auth.
- `GET /dashboard/combos` returns `200`, but static HTML cannot prove client-rendered badge. Authenticated browser smoke check remains optional.

## Next Single Action
Open authenticated `http://192.168.1.33:20130/dashboard/combos`; confirm health badges and each sorter option reorder cards as labeled.
