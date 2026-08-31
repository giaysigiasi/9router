# Combos Dashboard UI Improvements

Five operator-facing improvements to `/dashboard/combos` that make degraded combos self-healing and faster to configure.

All five features are live in the combos page and verified to compile and render (HTTP 200, no compile errors).

---

## 1. Auto-Fix Button (per combo)

Amber **Fix** button on each `ComboCard` that appears only when the combo health is `degraded` or `unavailable`.

**What it does**
- Calls `POST /api/combos/[id]/fix`
- Server removes every model whose provider has no active connection, keeps only routable models, resets rotation, returns before/after health.
- On success shows a green banner: `Fixed: removed N model(s), M remaining`.
- If all models are unavailable (nothing routable left), returns a 400 with guidance to add models from active providers — no destructive change.

**Files**
- `src/app/api/combos/[id]/fix/route.js` (new) — health check → filter → `updateCombo` → `resetComboRotation` → re-check.
- `src/app/(dashboard)/dashboard/combos/page.js` — `handleFixCombo`, `fixingComboId`, `fixResults`, `ComboCard` `onFix`/`fixing`/`fixResult` props.

---

## 2. Model-Level Health Indicators

Each model chip in a `ComboCard` shows a small status dot once probe data is available:

- 🟢 green — model probed OK (`probe.modelProbes[].ok === true`)
- 🔴 red — model reported unavailable (`health.unavailableModels` contains it)
- no dot — no probe data yet (e.g. combo never probed)

Dots derive from the live health probe response (`/api/combos/health`), so they reflect real routability, not just config.

**File**
- `src/app/(dashboard)/dashboard/combos/page.js` — `modelHealthMap` memo built from `probe.modelProbes` + `health.unavailableModels`; passed to `ComboCard`.

---

## 3. Combo Templates / Presets

Create-combo modal (not edit) shows a **Templates** row above the model picker. Four presets, each pre-filling models and suggesting a slug name:

| Template | Description | Models |
|---|---|---|
| Free Coding | Free-tier coding models, multi-provider | `kilo-gateway/gemini-2.5-flash`, `kilo-gateway/gemini-2.5-pro`, `kilocode/qwen3-coder-480b`, `kilocode/glm-4.5`, `openrouter/google/gemini-2.5-flash-preview` |
| Free Reasoning | Free-tier reasoning models | `kilo-gateway/gemini-2.5-pro`, `kilo-gateway/gemini-2.5-flash`, `kilocode/qwen3-coder-480b`, `kilocode/deepseek-r1`, `openrouter/google/gemini-2.5-pro-preview` |
| Free Vision | Free-tier models with vision | `kilo-gateway/gemini-2.5-flash`, `kilo-gateway/gemini-2.5-pro`, `openrouter/google/gemini-2.5-flash-preview`, `openrouter/meta-llama/llama-4-maverick`, `openrouter/microsoft/phi-4-vision` |
| Multi-Provider Fallback | Spread load across providers | `kilo-gateway/gemini-2.5-flash`, `kilocode/qwen3-coder-480b`, `openrouter/google/gemini-2.5-flash-preview`, `moonshotai/kimi-k2`, `grok/x-ai/grok-3-mini` |

Templates are defined as `COMBO_TEMPLATES` in `page.js` and passed to `ComboFormModal` via the `templates` prop. Clicking a template populates the model list and suggests a name (e.g. `free-coding`).

**Files**
- `src/app/(dashboard)/dashboard/combos/page.js` — `COMBO_TEMPLATES` constant.
- `src/shared/components/ComboFormModal.js` — `templates` prop, template selector rendered only when `!isEdit`.

---

## 4. Bulk "Fix All Degraded"

Header button **Fix All (N)** (amber) appears when `degradedCount > 0`.

- `degradedCount` = combos whose health is `degraded` or `unavailable` (computed from the health probe).
- Clicking runs `handleFixAll`: iterates every degraded combo, calls the fix endpoint for each, stores per-combo results, then refreshes the list.
- Disabled + shows `Fixing...` while in flight.

**File**
- `src/app/(dashboard)/dashboard/combos/page.js` — `degradedCount` memo, `handleFixAll`, `fixingAll`, header button.

---

## 5. Provider Status Indicators in ModelSelectModal

The model picker (`ModelSelectModal`) now renders a green/red dot next to each provider group header:

- 🟢 green — provider has an active connection (`activeProviders` includes its id/alias), or it is a free `NO_AUTH_PROVIDER_IDS` provider (always considered active).
- 🔴 red — provider not connected.

Lets operators see at a glance which providers they can actually route to before picking models.

**File**
- `src/shared/components/ModelSelectModal.js` — `activeProviderIds` memo (from `activeProviders` + `NO_AUTH_PROVIDER_IDS`), `isProviderActive` check, status dot + tooltip per provider group.

---

## API Reference

### `POST /api/combos/[id]/fix`

Auto-fix a degraded combo by removing unroutable models.

**Responses**

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ fixed: true, removedModels, remainingModels, previousHealth, health }` | Models removed, combo now healthier |
| 200 | `{ fixed: false, message: "Combo is already healthy", health }` | Nothing to do |
| 400 | `{ error: "Combo has no models to fix" }` | Empty combo |
| 400 | `{ fixed: false, message: "All models are unavailable…" }` | No routable models remain |
| 404 | `{ error: "Combo not found" }` | Bad id |
| 500 | `{ error: "Failed to auto-fix combo" }` | Server error |

**Logic**
1. Load combo; build provider-node map (same as `/api/combos/health`).
2. `getComboHealth(combo, connections, providerNodeMap)`.
3. If `healthy` → no-op.
4. Filter out `health.unavailableModels`.
5. If nothing left → 400 (don't empty the combo).
6. `updateCombo(id, { models: fixedModels })` + `resetComboRotation(combo.name)`.
7. Re-check health, return before/after.

---

## Verification

- Dev server (`next dev`) starts clean; combos page returns HTTP 200 (17 KB) with no compile errors.
- Only pre-existing token-refresh warnings appear in logs (unrelated to these changes).
- API endpoints compile; auth-gated (401 without token) as designed.

## Deploy

```bash
docker build -t 9router:local .   # ~5–10 min
# restart container / push to p106
```
