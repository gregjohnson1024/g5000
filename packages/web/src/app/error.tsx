'use client';

import { useEffect, useState } from 'react';
import { attemptStaleBuildReload, isStaleBuildError } from '../lib/stale-build-error';

/**
 * Root segment error boundary. Its main job is recovering from post-deploy
 * version skew: a stale prefetched navigation 404s on an old chunk, which
 * used to surface Next's built-in "This page couldn't load" card on the
 * first tap of a tab. For those errors we hard-reload once, transparently;
 * everything else gets a themed card with manual Reload / Back.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [autoReloading, setAutoReloading] = useState(false);

  useEffect(() => {
    if (isStaleBuildError(error) && attemptStaleBuildReload()) {
      setAutoReloading(true);
    }
  }, [error]);

  if (autoReloading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-slate-400">
        <span className="font-mono text-sm">updating…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center">
      <div className="font-mono text-lg font-bold text-slate-200">page failed to load</div>
      <div className="max-w-sm font-mono text-sm text-slate-400">
        {error.digest ? `server error ${error.digest}` : (error.message ?? 'unknown error')}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded border border-slate-500 bg-slate-800 px-4 py-2 font-mono text-sm text-slate-100 hover:bg-slate-700"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={() => reset()}
          className="rounded border border-slate-600 px-4 py-2 font-mono text-sm text-slate-300 hover:bg-slate-800"
        >
          Retry
        </button>
        <button
          type="button"
          onClick={() => window.history.back()}
          className="rounded border border-slate-600 px-4 py-2 font-mono text-sm text-slate-300 hover:bg-slate-800"
        >
          Back
        </button>
      </div>
    </div>
  );
}
