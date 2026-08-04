# Cline Prompt: Add New OpenAI-Compatible Provider to 9Router

> Fill in the `<...>` placeholders below, then paste the whole thing into Cline
> with this repo open in VS Code (the source checkout running on port 20130,
> not the npm-installed instance on 20128).

---

## Context

I'm working in a local clone of the 9Router project (`decolua/9router`), a
Next.js app that acts as a local AI-provider gateway. I'm running this source
build on port 20130 (separate from my existing npm-installed instance on
20128), so it's safe to modify.

Architecture reference: `docs/ARCHITECTURE.md` in this repo — read it first if
you haven't already. Key facts:

- Provider definitions live in a single source-of-truth registry:
  `src/shared/constants/providers.js` (the `REGISTRY`).
- OAuth providers (Claude Code, Codex, GitHub Copilot, etc.) have extra
  handling in `src/lib/oauth/providers.js` and
  `src/lib/oauth/constants/oauth.js` — **I do not need this**, since my
  provider uses a static API key, not OAuth.
- Request execution / streaming / fallback logic lives in `open-sse/*` and
  `src/sse/*`.
- Format translation between provider APIs lives in the translator layer
  under `open-sse/` — **for a standard OpenAI-compatible `/chat/completions`
  endpoint, no new translator should be needed**, since 9Router's native
  format is already OpenAI-shaped.
- Provider connectivity checks ("probes") live in
  `src/app/api/providers/validate/route.js`.
- Provider CRUD/testing endpoints live under `src/app/api/providers/`.
- Dashboard UI for adding/configuring providers is under
  `src/app/(dashboard)/dashboard/` and `src/shared/components/`.

## Goal

Add a new **API-key-based, OpenAI-compatible** provider to 9Router with the
following details:

- **Provider display name:** `<PROVIDER_DISPLAY_NAME>` (e.g. "Together AI")
- **Provider id/slug (used in model prefixes, e.g. `glm/`):** `<PROVIDER_ID>`
- **Base URL:** `<BASE_URL>` (e.g. `https://api.together.xyz/v1`)
- **Auth header format:** `<AUTH_HEADER>` (e.g. `Authorization: Bearer <key>`
  — note if it deviates from standard Bearer auth)
- **Chat completions path:** `<CHAT_COMPLETIONS_PATH>` (usually
  `/chat/completions`, confirm against the provider's docs)
- **Models endpoint (if available, for auto-fetch):** `<MODELS_ENDPOINT_OR_NONE>`
- **Static model list (if no auto-fetch):**
  - `<MODEL_ID_1>`
  - `<MODEL_ID_2>`
  - `<MODEL_ID_3>` (add/remove as needed)
- **Pricing tier for dashboard categorization:** `<cheap | free | subscription>`
- **Any non-standard request/response quirks** (e.g. requires a specific
  `model` field format, doesn't support `stream: true`, custom headers,
  rate-limit headers to respect): `<NOTES_OR_NONE>`

## Tasks

1. **Registry entry** — Add `<PROVIDER_ID>` to the `REGISTRY` in
   `src/shared/constants/providers.js`, following the pattern of an existing
   API-key OpenAI-compatible provider already in that file (look at how
   `glm`, `minimax`, or `deepseek` are defined and mirror that shape:
   base URL, auth type, pricing tier, model prefix).

2. **Model list** — Wire up the model list for `<PROVIDER_ID>`:
   - If `<MODELS_ENDPOINT_OR_NONE>` is set, implement auto-fetch from that
     endpoint (look at how `OpenCode Free` auto-fetches from
     `opencode.ai/zen/v1/models` for the pattern).
   - Otherwise, hardcode the static model list from above.

3. **Provider validation probe** — Add a lightweight connectivity probe for
   `<PROVIDER_ID>` in `src/app/api/providers/validate/route.js` (a minimal
   request, e.g. hitting the models endpoint or a trivial chat completion)
   so the dashboard can verify the API key without burning quota. Follow the
   existing `probeWebProvider` pattern used for other API-key providers.

4. **Dashboard UI** — Make sure `<PROVIDER_ID>` shows up as a connectable
   provider in the dashboard's "Add API Key" flow (provider picker list,
   icon/logo placeholder if none exists, form fields for the API key).

5. **Request routing** — Confirm requests to `<PROVIDER_ID>/<model>` route
   correctly through the existing OpenAI-compatible execution path in
   `open-sse/` without needing a new translator (since this is a standard
   OpenAI-compatible API). If the provider's request/response shape deviates
   from OpenAI's spec in any way (see notes above), flag this to me before
   writing custom translation logic — don't silently assume.

6. **Docs** — Add `<PROVIDER_DISPLAY_NAME>` to the provider table in
   `README.md` (API Key Providers section) and to the "Available Models"
   section, matching the existing format.

7. **Tests** — If `tests/` has existing provider-config tests, add an
   equivalent test case for `<PROVIDER_ID>` (registry shape validation,
   model list shape, etc.).

## Constraints

- Don't touch OAuth-related files (`src/lib/oauth/*`) — this provider is
  API-key based only.
- Don't modify the npm-installed instance or anything outside this repo
  checkout.
- Keep the diff scoped to provider registration — no unrelated refactors.
- After implementing, tell me exactly which files changed and give me the
  `.env` / dashboard steps needed to test the new provider end-to-end on
  `http://localhost:20130`.

## Before you start

Ask me to fill in any `<...>` placeholder above that's still empty, and read
`docs/ARCHITECTURE.md` plus the existing `glm` or `minimax` entries in
`src/shared/constants/providers.js` first so your implementation matches the
existing patterns exactly.
