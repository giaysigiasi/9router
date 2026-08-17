# Current Task Handoff

## Task
Deploy commit `83065549f0a1501b0740f75ece76405cb547533b` to UAT server `192.168.1.33` via `ssh p106-platform`.

## Done
- Checkout detached HEAD at 83065549 (local docker daemon down, so remote build).
- Tar source `9router-deploy-83065549.tar.gz` (excluded node_modules/.next/.git).
- scp to `/opt/9router/` on UAT.
- Remote: extract to tmp, copy to `/opt/9router/` (UAT `.env` preserved — dotfile glob skipped by `cp -r`).
- Remote: `docker build -t 9router:local .` → image `e658a846901e5889701b9025398be1854bfb2bab83f08ed7627841e4ffe42913`.
- Remote: `docker compose -f docker-compose.yml up -d --force-recreate` → `9router:local Up Less than a second`.
- UAT verify:
  - `GET /api/health` → `{"ok":true}`
  - `GET /v1/models` → list combos (`free-coding-max`, `free-reasoning`, `plan-plus-max`, ...)
- Cleanup: removed local + remote tar, restored `david-dev` branch, `git stash pop`.

## Refs
- Commit: `83065549 quota-jump feature`
- Remote path: `/opt/9router`
- Compose project: `9router`
- Container: `9router-source`
- Runs: `agent-ai/orchestrator/runs/1786890385159/result.json`
- Target repo: `D:\R&D lab\crazy-games-demo` (main) / `D:\R&D lab\crazy-games-demo-wt` (worktree)