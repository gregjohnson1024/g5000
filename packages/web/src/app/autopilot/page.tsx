import { ReadonlyView } from './readonly-view';
import { ControlPanel } from './control-panel';

// Read process.env on every request so the AP TX gate matches the live
// env, not a value baked at build time.
export const dynamic = 'force-dynamic';

export default function AutopilotPage() {
  const apTxEnabled = process.env.G5000_ENABLE_AP_TX === '1';

  return (
    <main className="p-6 space-y-6">
      <ReadonlyView apTxEnabled={apTxEnabled} />
      {apTxEnabled && <ControlPanel />}
    </main>
  );
}
