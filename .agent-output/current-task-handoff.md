# Current Task Handoff

## User task
Use `ssh p106-platform` to host 9router on UAT server.

## Deployment result
- SSH host: `p106-platform`
- Remote host: `dockerserver`
- Remote path: `/opt/9router`
- Compose project: `9router`
- Container: `9router-source`
- UAT port: `20130`
- Image: `9router:local`
- Image digest: `sha256:688877b00c66046a30e6805c14080bf2b6dee672b0c6bec3d907f4c440f9d4be`
- Source deployed: committed local `HEAD` `52761696`
- Persistent volume preserved: `9router-data`
- Secret file `.env` preserved on UAT, not copied from local.
- Headroom container remained running.

## Verification
- `docker compose ps`: `9router-source` Up, `headroom` healthy.
- `GET http://127.0.0.1:20130/api/health`: `200 OK`, `{"ok":true}`.
- `GET http://127.0.0.1:20130/api/v1/models`: `401 Unauthorized`, expected because request had no API key.
- Container logs show normal provider traffic and fallback behavior.

## Local workspace note
Local workspace still has unrelated uncommitted/untracked files from prior wrong-workspace work:
- `.agent-output/current-task-handoff.md`
- `9router-automation/`
- malformed untracked filenames shown by `git status`
These were not deployed. Do not commit or remove without explicit instruction.

## Current local changes
- Added `POST /api/skills/prompt-designer`.
- Returns generated prompt text from Gemini Flash by default (`gemini/gemini-flash`).
- Reuses existing `handleChat` routing, provider credentials, auth, and fallback behavior.
- Added `tests/unit/prompt-designer.test.js`.
- Verification passed:
  - `npm exec -- vitest run tests/unit/prompt-designer.test.js --config tests/vitest.config.js`
  - `npm exec -- eslint src/app/api/skills/prompt-designer/route.js tests/unit/prompt-designer.test.js`
  - `git diff --check`
- New route is not deployed to UAT yet.
- UAT `9router-data` volume confirmed at `/app/data`; SQLite DB at `/app/data/db/data.sqlite`.
- Created persistent UAT combo `review-fast` in `combos` table with models:
  - `cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast`
  - `cf/@cf/meta/llama-3.1-70b-instruct-fp8-fast`
  - `oc/deepseek-v4-flash-free`
- Created DB backup before insert: `/data/db/data.sqlite.pre-review-fast.bak`.
- Review agent reached UAT using `review-fast` and returned HTTP success.
- Review result was not trustworthy: model returned nested malformed JSON containing a hallucinated token-expiry finding; CLI parsed outer empty arrays and exited `0`. Do not treat that run as a clean code review.
- Existing unrelated untracked files remain untouched: `9router-automation/`, malformed filenames shown by `git status`.

## Current review pipeline state
- Hardened `9router-automation/review-code.cjs`:
  - `parseResponse` now unwraps nested JSON (LLM returned review object nested inside `summary`).
  - Recovers JSON from trailing explanation text after closing brace.
  - Validates required schema: `summary` string, `blocking/warnings/nits/security` arrays.
  - Malformed/missing schema now throws → exit code `2`, never silent clean `0`.
- Self-check extended and passed:
  - `node 9router-automation/review-code.cjs --self-check` → `review-code self-check: ok`
  - Cases: plain JSON, nested JSON, JSON + trailing text, malformed (`not json`, `[]`, `{"summary":"s"}`) all throw.

## Bootstrap on UAT (done)
- `ensure-combo.cjs` idempotent: rerun against existing DB printed `{"combo":"review-fast","status":"exists",...}`. No overwrite.
- Copy path on UAT: `scp` to `/tmp/` on host, then `docker cp` into container `/tmp/`.
- `better-sqlite3` resolution: run inside container with `NODE_ENV`/`NODE_PATH=/app/node_modules` because app deps live at `/app/node_modules`. Command that works:
  ```cmd
  ssh p106-platform "docker exec -e NODE_PATH=/app/node_modules 9router-source node /tmp/ensure-combo.cjs --db /app/data/db/data.sqlite"
  ```

## Rerun status (parser fixed, model unreliable)
- `parseJson` now scans from first `{`/`[` anywhere → handles prefix prose. Self-check green (`review-code self-check: ok`), includes prefix-prose case.
- Deployed to UAT and reran review. Parser + exit-code pipeline works:
  - Valid JSON parsed correctly.
  - `exit 2` returned because `blocking` non-empty. Correct behavior.
- BUT finding is hallucinated again: `"Token expiry check use < not <=", line 43`. route.js line 43 is `Audience: ${value(audience)}` — no token expiry anywhere in the supplied route. Model violated its instruction to review only supplied code.
- Conclusion: parser/CLI trustworthy; `review-fast` combo (free models) not trustworthy for review. Third strike (nested JSON, non-JSON, hallucinated finding).

## Committed + pushed
- Commit `0250edac` on branch `david-dev`: `feat: add prompt-designer route and test`
  - `src/app/api/skills/prompt-designer/route.js`
  - `tests/unit/prompt-designer.test.js`
- Pushed to `origin/david-dev` (`52761696..0250edac`), upstream set.
- Deliberately NOT committed: `.env`, `.agent-output/`, `9router-automation/`, malformed untracked files. Leave untouched unless user says otherwise.

## Quota-jump feature (local, NOT deployed to UAT yet)
- Goal: combo quota-hit model should sink to combo tail until cooldown ends; next request starts from first working model, skips blocked one. Also per-request: quota on model[i] jumps straight to last model, skipping middle.
- Files changed:
  - `open-sse/config/errorConfig.js` — quota rules marked `quota: true` (text: rate limit / too many requests / quota exceeded / capacity / overloaded; status 429).
  - `open-sse/services/accountFallback.js` — `checkFallbackError` returns `reason: "quota" | "other"`.
  - `open-sse/services/combo.js`:
    - `comboQuotaBlocked` Map state + `getQuotaJumpedModels` (blocked → tail, evict expired) + `markComboModelQuotaBlocked`.
    - `handleComboChat`: apply `getQuotaJumpedModels` after rotation/auto-switch; on quota reason block model + jump `i = len-2` unless already on last (fallthrough prevents infinite loop).
    - `resetComboRotation` clears quota state too.
  - `tests/unit/combo-quota-jump.test.js` — 7 tests, all pass:
    - `cd tests && npx vitest run --reporter=verbose unit/combo-quota-jump.test.js` → 7 passed.
- Full suite has 86 pre-existing failures (module alias resolution `@/`, missing packages `open-sse/executors/default.js`, live GH API 401, stale snapshots). Not caused by this change.
- Not committed / not pushed / not deployed.
- Caveat: quota-block memory is in-process only; clears on restart. Round-robin + auto-switch interplay: quota-jump reorder applied after both, so blocked models stay tail even in round-robin.

## Next Single Action
1. Switch combo to a reliable model. `review-fast` keeps hallucinating:
   - Options: (a) create a `review` combo with a strong paid model already in UAT DB, (b) per-run `--combo <model>` flag instead of combo. Check `apiKeys`/`providers` and router `/api/v1/models` for a reliable model.
2. Rerun with strong model: expect trustworthy JSON + accurate findings (or clean exit 0).
3. Then deploy `prompt-designer` route to UAT (not yet deployed):
   - `scp` route + test to `/opt/9router` source, rebuild image, `docker compose up -d`.
   - Or confirm in-container copy path if hot-swap preferred.
4. Deploy quota-jump change to UAT when user confirms: rebuild image from current local source, `docker compose up -d`.
5. Update this handoff after each step. Do not commit/remove local untracked workspace files without explicit instruction.

Current mode: ACT. Context: 253% (over 85% limit → handoff only).

## Rollback
Previous image/container state was replaced during Compose recreate. Current source can be restored by rebuilding from a known prior source snapshot and running:
```bash
cd /opt/9router
docker compose build 9router
docker compose up -d 9router