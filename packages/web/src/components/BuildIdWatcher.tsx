'use client';

import { useEffect } from 'react';
import { openReconnectingSse } from '../lib/reconnecting-sse';
import { attemptStaleBuildReload } from '../lib/stale-build-error';

/**
 * Should a page built as `own` reload because the server reported `serverRaw`?
 *
 * Extracted and exported so the decision is testable without React: a wrong
 * answer here means an unattended display reload-loops, which is worse than the
 * staleness it is meant to fix. Every uncertain case must answer false.
 */
const BUDGET_KEY = 'g5000:build-reload-budget';
/**
 * How many times we will reload for a build-id mismatch WITHOUT ever seeing the
 * ids converge. The 30s window in attemptStaleBuildReload bounds the rate but
 * not the total: a page that reloads twice a minute forever is still broken,
 * just slowly, and on an unattended masthead display that is worse than being
 * stale. The counter is cleared every time the ids DO match, so a boat that
 * deploys ten times a week never runs out — only a genuinely non-converging
 * loop does.
 */
const MAX_UNCONVERGED_RELOADS = 3;

const TOTAL_KEY = 'g5000:build-reload-total';
/**
 * Absolute ceiling that is NEVER reset. The converging reset above is what
 * keeps frequent legitimate deploys working, but it reopens one case: a
 * FLAPPING served id (A, B, A, B…) converges after every reload, so the
 * unconverged counter is cleared each time and never accumulates — leaving
 * only the 30s rate limit, i.e. exactly the "slowly broken" state this is
 * meant to prevent. Reaching it needs a redeploy fight (a rollback loop, or
 * the Actions runner cycling between commits), which became marginally more
 * reachable when that runner gained Restart=always.
 *
 * Ten is far above any plausible number of real deploys within one browser
 * session on a panel that stays open for weeks, and far below "forever".
 */
const MAX_TOTAL_RELOADS = 10;

/** Called whenever the server's id matches ours: we are current, so forget any
 *  failed attempts. */
export function markConverged(): void {
  try {
    window.sessionStorage.removeItem(BUDGET_KEY);
  } catch {
    /* storage unavailable — nothing to reset */
  }
}

/**
 * Consume one reload from both budgets. False when either is exhausted.
 *
 * Fails CLOSED when storage is unavailable: without it nothing survives the
 * reload, so no counter can bound a loop and the only honest options are
 * "unbounded" or "don't". An unattended display reloading forever is worse
 * than a stale one, and staleness is still covered reactively by
 * app/error.tsx on the next navigation — so we decline rather than guess.
 */
export function takeReloadBudget(): boolean {
  try {
    const total = Number(window.sessionStorage.getItem(TOTAL_KEY) ?? 0);
    if (total >= MAX_TOTAL_RELOADS) return false;
    const used = Number(window.sessionStorage.getItem(BUDGET_KEY) ?? 0);
    if (used >= MAX_UNCONVERGED_RELOADS) return false;
    window.sessionStorage.setItem(BUDGET_KEY, String(used + 1));
    window.sessionStorage.setItem(TOTAL_KEY, String(total + 1));
    return true;
  } catch {
    return false;
  }
}

export function shouldReloadForBuildId(own: string | undefined, serverRaw: string): boolean {
  if (!own) return false;
  let server: unknown;
  try {
    server = JSON.parse(serverRaw);
  } catch {
    return false;
  }
  if (typeof server !== 'string') return false;
  return server !== own;
}

/**
 * Reload a page whose bundle the server has moved past.
 *
 * The existing stale-build recovery in app/error.tsx is REACTIVE: it waits for
 * a chunk to 404 and repairs the resulting error card. That works for a browser
 * someone is clicking around in, but not for a display nobody touches. The mast
 * panel proved the gap on 2026-09-06 — after a deploy its SSE stream reconnected
 * and it went on rendering live, correct numbers from a bundle loaded hours
 * earlier, with sockets, process counts and service state all green. Nothing
 * ever navigated, so nothing ever 404'd, so nothing ever recovered.
 *
 * This is the proactive half: the server reports its build id on every SSE
 * connection, and a page whose own id differs has been left behind. Because the
 * stream reconnects by itself after a deploy, the comparison happens without
 * anyone being present.
 *
 * Deliberately reuses attemptStaleBuildReload() rather than reloading directly —
 * its 30s window is what stops a reload loop if the server is genuinely broken
 * rather than merely redeployed.
 */
export function BuildIdWatcher(): null {
  useEffect(() => {
    const own = process.env.NEXT_PUBLIC_BUILD_ID;
    // No id to compare against (dev without a git checkout) — do nothing rather
    // than guess. A spurious reload on a masthead display is worse than a stale
    // one we already know how to detect by other means.
    if (!own) return;

    return openReconnectingSse('/api/mast/stream', {
      listeners: {
        buildid: (ev) => {
          if (!shouldReloadForBuildId(own, ev.data)) {
            // Either we are current, or the payload was unusable. Only the
            // former should clear the budget, so check explicitly.
            try {
              if (JSON.parse(ev.data) === own) markConverged();
            } catch {
              /* unusable payload — leave the budget alone */
            }
            return;
          }
          if (takeReloadBudget()) attemptStaleBuildReload();
        },
      },
    });
  }, []);

  return null;
}
