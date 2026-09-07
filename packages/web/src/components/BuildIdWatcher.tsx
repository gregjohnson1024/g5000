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
          if (shouldReloadForBuildId(own, ev.data)) attemptStaleBuildReload();
        },
      },
    });
  }, []);

  return null;
}
