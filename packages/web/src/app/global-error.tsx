'use client';

import { useEffect, useState } from 'react';
import { attemptStaleBuildReload, isStaleBuildError } from '../lib/stale-build-error';

/**
 * Last-resort boundary (replaces Next's built-in "This page couldn't load"
 * card). Renders its own <html>/<body> because the root layout itself may
 * have failed — inline styles only, the app CSS may not be loaded. Same
 * stale-build auto-reload as error.tsx.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [autoReloading, setAutoReloading] = useState(false);

  useEffect(() => {
    if (isStaleBuildError(error) && attemptStaleBuildReload()) {
      setAutoReloading(true);
    }
  }, [error]);

  const wrap: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    height: '100vh',
    margin: 0,
    background: '#020617',
    color: '#94a3b8',
    fontFamily: 'ui-monospace, monospace',
    textAlign: 'center',
  };
  const btn: React.CSSProperties = {
    padding: '8px 16px',
    border: '1px solid #64748b',
    borderRadius: 4,
    background: '#1e293b',
    color: '#f1f5f9',
    font: 'inherit',
    cursor: 'pointer',
  };

  return (
    <html lang="en">
      <body style={wrap}>
        {autoReloading ? (
          <span>updating…</span>
        ) : (
          <>
            <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 18 }}>
              page failed to load
            </div>
            <div style={{ maxWidth: 360, fontSize: 13 }}>
              {error.digest ? `server error ${error.digest}` : (error.message ?? 'unknown error')}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" style={btn} onClick={() => window.location.reload()}>
                Reload
              </button>
              <button type="button" style={btn} onClick={() => window.history.back()}>
                Back
              </button>
            </div>
          </>
        )}
      </body>
    </html>
  );
}
