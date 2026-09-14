// Local re-implementation of the 3-tier probe cooldown used by
// src/lib/backgroundComboHealthPoll.js + src/app/api/combos/health/route.js.
// Reused by scripts/test-combo-local.mjs so the cooldown logic can be verified
// without a running container. Keep this in sync with the source files.

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

/**
 * Probe cooldown tiers — maps error classification to auto-push-to-tail duration.
 *   quota     -> 15 min (rate-limit / quota)
 *   other     ->  5 min (auth / hard failure)
 *   transient ->  2 min (unknown / connection)
 */
export const PROBE_COOLDOWN = {
  quota: 15 * 60 * 1000,
  other: 5 * 60 * 1000,
  transient: 2 * 60 * 1000,
};

/**
 * Classify a probe result and return the cooldown duration (ms) to apply,
 * or 0 if the probe should NOT block the model (e.g. soft/probe-only errors).
 * Mirrors classifyProbeCooldown in the runtime modules.
 */
export function classifyProbeCooldown(status, errorText) {
  if (status == null) {
    return PROBE_COOLDOWN.transient; // connection-level failure
  }
  const { cooldownMs, reason } = checkFallbackError(status, errorText || "");
  if (!cooldownMs || cooldownMs <= 0) return 0;
  return PROBE_COOLDOWN[reason] ?? PROBE_COOLDOWN.transient;
}

// end of file