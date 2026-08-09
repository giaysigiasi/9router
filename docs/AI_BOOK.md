# 9router AI Book

## Project Summary

9router is a local AI router dashboard. It connects coding tools to many AI providers, tracks quota and usage, selects fallback providers, and reduces tool-result token use.

Repository: `D:\Github\9router`  
Dashboard: `http://localhost:20128/dashboard`  
API endpoint: `http://localhost:20128/v1`

## UI Roadmap

| # | Function | Existing UI base | Wave | Status |
| --- | --- | --- | --- | --- |
| 1 | One-click CLI Setup | `dashboard/endpoint/` | 1 | Implemented |
| 2 | Model Finder | `dashboard/providers/` | 1 | Planned |
| 3 | Token Saver Preview | `dashboard/token-saver/` | 1 | In Progress |
| 4 | Provider Onboarding Wizard lite | `dashboard/providers/new/` | 1 | Planned |
| 5 | Provider Health Matrix | `dashboard/providers/` | 2 | Implemented |
| 6 | Usage Heatmap | `dashboard/usage/` | 2 | Planned |
| 7 | Cost + Quota Alerts lite | `dashboard/quota/`, `dashboard/usage/` | 2 | Planned |
| 8 | Route Simulator | new route or `dashboard/combos/` | 3 | In Progress |
| 9 | Fallback Chain Builder | `dashboard/combos/` | 3 | Planned |
| 10 | Request Replay | `dashboard/console-log/` | 3 | Planned |

## Implementation Plan

### Wave 1: Reuse existing pages

1. **One-click CLI Setup**
   - Add copy-ready setup cards to `src/app/(dashboard)/dashboard/endpoint/`.
   - Support Claude Code, Cline, Cursor, Codex, and OpenCode.
   - Reuse existing endpoint, API key, selected model, and clipboard UI.
   - No backend changes.

2. **Model Finder**
   - Add client-side search and filters to existing provider/model data.
   - Do not add an API unless existing model data is insufficient.

3. **Token Saver Preview**
   - Reuse actual token-saver/compression code where accessible.
   - Show input, compressed output, original size, output size, and percentage saved.
   - Do not create frontend-only routing/compression behavior that differs from proxy behavior.

4. **Provider Onboarding Wizard lite**
   - Organize existing provider creation into choose, authenticate, validate, and save steps.
   - Reuse provider save/validation APIs.

### Wave 2: Observability

5. **Provider Health Matrix**
   - Combine existing health, validation, provider, and registry data.
   - Show configuration, auth status, latency, models, and latest error.
   - Add one aggregation API only if page would otherwise over-fetch.

6. **Usage Heatmap**
   - Extend existing usage page with chart/table/heatmap mode.
   - Display hourly/daily requests, tokens, failures, and fallback count when data exists.

7. **Cost + Quota Alerts lite**
   - Add local thresholds and in-dashboard warning badges first.
   - Use existing settings storage when available; otherwise localStorage.
   - Skip external notifications until user needs them.

### Wave 3: Routing and debug

8. **Route Simulator**
   - Build a backend dry-run endpoint using real route logic.
   - Frontend must not reimplement route selection.

9. **Fallback Chain Builder**
   - Extend combo configuration after confirming its current schema.
   - Offer named priority chains: free-first, cheap-first, quality-first.

10. **Request Replay**
   - Start from console logs.
   - Redact credentials, require confirmation, and protect users from accidental cost.

## Guard Rules

Run guard before and after a 9router change:

```cmd
node scripts\guard-9router-ai-book.mjs
```

Guard requires:
- this book exists;
- required sections remain present;
- changes under `src/`, `open-sse/`, or `scripts/` have a matching ai-book change;
- changed project scripts are named under `## Scripts`;
- changed dashboard route pages are named under `## UI Roadmap` or `## Implementation Log`.

Guard checks changed, tracked files. New untracked files are checked after `git add -N <file>` or once staged.

## Implementation Log

### 2026-08-07 â€” AI book baseline and guard

- Created this project book.
- Planned ten dashboard functions in three delivery waves.
- Added ai-book guard script at `scripts/guard-9router-ai-book.mjs`.
- Next: add One-click CLI Setup to existing Endpoint & Key page.

### 2026-08-07 â€” One-click CLI Setup

- Added `CliSetupCard` to `src/app/(dashboard)/dashboard/endpoint/EndpointPageClient.js`.
- Reuses browser-derived `/v1` endpoint, first active API key, and existing clipboard hook.
- Provides copy-ready snippets for Claude Code, Cline, Cursor, Codex, and OpenCode.
- No API, storage, dependency, or provider-routing changes.
- Empty state instructs user to create an active API key.

### 2026-08-07 â€” UI Build Fixes

- Fixed build errors in `Route Simulator` and `Token Saver` pages, enabling the UI to run.
- Replaced missing `Textarea` component with standard HTML textarea in `RouteSimulatorClient.js`.
- Corrected `ConfirmModal` import path in `TokenSaverClient.js`.
- These changes unblock further development on Wave 1 and Wave 3 UI features.

### 2026-08-08 â€” Provider Health Matrix status mapping

- Fixed `ProviderHealthClient.js` to map all backend statuses: `healthy`, `degraded`, `no-key`, `auth-error`, `unreachable`.
- Added `getStatusLabel()` for user-friendly display: "No API Key", "Auth Error", "Unreachable".
- Updated table rows and detail modal to use mapped labels instead of raw status strings.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/guard-9router-ai-book.mjs` | Requires this book to be updated with tracked 9router code, route, or script changes. |
| `scripts/injectDisplayToRegistry.mjs` | Existing 9router registry display helper. |
| `scripts/migrate-registry.mjs` | Existing 9router registry migration helper. |
| `scripts/test-combo-autoswitch.mjs` | Existing 9router combo autoswitch check. |
| `scripts/translate-readme.js` | Existing README translation helper. |

## Commands

```cmd
node scripts\guard-9router-ai-book.mjs
npm test
npm run lint
npm run build
```

## Checks

- Guard baseline: passed â€” `AI book guard passed: no governed 9router changes.`
- One-click CLI Setup: implementation pending lint/build verification.
