# Current Task Handoff

## Goal
Role-based cross-provider combos for multi-agent orchestrator. Each CLI agent (codex, claude, cline, opencode, etc.) gets one combo per role (pm, ba, dev, qa, supervisor), with models selected across ALL providers based on role suitability thresholds.

## State
- **Done**: 
  - `--list` mode (single-suffix inspect)
  - `--cross-provider` flag with auth boundary enforcement
  - `--roles pm,ba,dev,qa,supervisor` mode implemented
  - `ROLE_PROFILES` with per-role thresholds (minCtx, requireReasoning, minStrength)
  - `passesRoleFilter()` and `getRoleModels()` functions
  - `listModels()` updated for role-mode sub-tables
  - `runOnce()` updated for role-mode combo creation
  - Self-check passes with 15+ role-specific tests
- **In Progress**: Ready for live testing
- **Blocked**: None

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