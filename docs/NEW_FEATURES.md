# New UI Features for 9router

This document describes five UI features that are planned for 9router, their intended routes, required API endpoints, and example usage. It serves as a quick reference for developers and contributors.

---

## 1. Model Finder

- **Route:** `/dashboard/model-finder`
- **Component:** `ModelFinderClient` (created under `src/app/(dashboard)/dashboard/model-finder/`)
- **API:** `GET /api/models` – returns list of available models with aliases, capabilities, and provider info.
- **Usage:**  
  1. User selects a provider dropdown.  
  2. Model list filters based on provider and capabilities (vision, search, etc.).  
  3. Clicking a model copies a ready‑to‑use import snippet (e.g., `model: "anthropic/claude-2"`).

**Implementation notes**
- Re‑use `CliSetupCard` styling for consistency.  
- Add navigation entry in `src/shared/components/Sidebar.js`:
  ```js
  { href: "/dashboard/model-finder", label: "Model Finder", icon: "search" }
  ```

---

## 2. Provider Health Matrix

- **Route:** `/dashboard/provider-health`
- **Component:** `ProviderHealthClient` (`src/app/(dashboard)/dashboard/provider-health/`)
- **API:** `GET /api/providers/health` (custom endpoint to be added; returns JSON with status, latency, error count per provider).
- **Usage:**  
  - Table view showing each provider, current health status (✅/⚠️/❌), recent error rate, and a “Refresh” button.  
  - Clicking a provider opens a modal with detailed logs.

**Implementation notes**
- Add a new sidebar entry:
  ```js
  { href: "/dashboard/provider-health", label: "Provider Health", icon: "health_and_safety" }
  ```

---

## 3. Token Saver Preview (enhancement)

- **Existing route:** `/dashboard/token-saver`
- **Enhancement:** Add a preview pane that shows the current saved token config in JSON/YAML format and a “Copy Preview” button.
- **API:** Re‑use existing `/api/token-saver` endpoints; add a `GET /api/token-saver/preview` that returns the current token configuration object.
- **Usage:**  
  - After saving a token, the preview updates automatically.  
  - Users can copy the formatted config to reuse in scripts.

**Implementation notes**
- Update `TokenSaverClient` to fetch `/api/token-saver/preview` and render the preview.

---

## 4. Provider Onboarding Wizard (lite)

- **Route:** `/dashboard/provider-onboard`
- **Component:** `ProviderOnboardClient` (`src/app/(dashboard)/dashboard/provider-onboard/`)
- **API:**  
  - `GET /api/providers/available` – list of providers that can be added.  
  - `POST /api/providers/add` – add a new provider with required credentials.  
- **Usage:**  
  1. Wizard steps: Select provider → Enter API key/secret → Validate → Save.  
  2. Progress bar guides the user.  
  3. On success, the provider appears in the “Providers” page.

**Implementation notes**
- Sidebar entry:
  ```js
  { href: "/dashboard/provider-onboard", label: "Onboard Provider", icon: "add_business" }
  ```

---

## 5. Route Simulator

- **Route:** `/dashboard/route-simulator`
- **Component:** `RouteSimulatorClient` (`src/app/(dashboard)/dashboard/route-simulator/`)
- **API:** `POST /api/routes/simulate` (new endpoint). The endpoint should accept a mock request (model, messages, etc.) and return the provider that the router would choose based on current logic.
- **Usage:**
  - A form where users can input a model name and a sample prompt.
  - The simulator shows which provider would be selected, the reason (e.g., "lowest cost," "active combo"), and the final cost.

**Implementation notes**
- The backend must use the actual routing logic for the simulation. Do not re-implement routing logic on the frontend.
- Sidebar entry:
  ```js
  { href: "/dashboard/route-simulator", label: "Route Simulator", icon: "fork_right" }
  ```

---

## Updating the AI‑Book

Whenever a new feature is implemented:

1. Add the route under **## UI Roadmap** in `README.md`.  
2. Document the implementation steps under **## Implementation Log**.  
3. List any new scripts under **## Scripts**.  
4. Run `node scripts/guard-9router-ai-book.mjs` to ensure the guard passes.

---

### Quick checklist for developers

- [x] Create page folder and client component.  
- [x] Implement or reuse backend API.  
- [x] Add navigation entry in `Sidebar.js`.  
- [x] Update AI‑book sections.  
- [x] Run guard script (`node scripts/guard-9router-ai-book.mjs`).  

Happy coding!