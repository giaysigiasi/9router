# Combo Health - Registry Prefix Resolution Fix

## Status: DEPLOYED to UAT (192.168.1.33:20130)

## Problem
Built-in registry providers (e.g., `cmc` for `commandcode`, `ocg` for `opencode-go`) showed as "Unavailable" on the combos health page because:
- Models use **`uiAlias`** as prefix: `cmc/deepseek/deepseek-v4-pro`
- Connections store the canonical **`alias`**: `commandcode`
- The health API only mapped DB provider-node prefixes, not built-in registry ones

## Fix Applied (commit c65dd7d4)
**`src/app/api/combos/health/route.js`**: Import `registryProviders` from `open-sse/providers/registry` and build a complete mapping:
1. DB provider-nodes: `prefix → node ID`
2. Registry entries: `uiAlias → alias` and `aliases[] → alias`

**`src/lib/comboHealth.js`**: No changes needed — `resolveProviderForHealth()` logic was correct.

**`tests/unit/combo-health.test.js`**: Added 2 tests:
- `cmc → commandcode` (uiAlias resolution)
- `ch → chutes` (aliases resolution)

## Verify
Refresh http://192.168.1.33:20130/dashboard/combos and confirm combos like `commandcode-deepseek`, `commandcode-discount` now show correct health status.

## Next Single Action
User should verify the combos page shows healthy/degraded status instead of "Unavailable 0/N" for all combos with active connections.