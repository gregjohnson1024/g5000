'use client';

import { useState, useEffect } from 'react';

export function MobButton() {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() === 'm' && !confirming) {
        setConfirming(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirming]);

  async function fireMob() {
    await fetch('/api/alarms', {
      method: 'POST',
      body: JSON.stringify({ id: 'mob', action: 'fire', context: {} }),
    });
    setConfirming(false);
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="fixed bottom-4 right-4 bg-red-600 hover:bg-red-700 text-white font-bold text-xl px-6 py-4 rounded-full shadow-lg z-40"
      >
        MOB
      </button>
      {confirming && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
          <div className="bg-white p-6 rounded-lg max-w-sm w-full">
            <h2 className="text-xl font-bold mb-4">Confirm MOB?</h2>
            <p className="mb-4 text-sm text-gray-600">
              This will fire a CRITICAL alarm and drop a waypoint at the current position.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirming(false)}
                className="px-4 py-2 bg-gray-200 rounded"
              >
                Cancel
              </button>
              <button
                onClick={fireMob}
                className="px-4 py-2 bg-red-600 text-white rounded font-bold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
