'use client';
import './mast.css';
import type { JsonSafeSample } from '@g5000/core';
import { useSse } from '../../hooks/use-sse';
import { useMastControl } from '../../hooks/use-mast-control';
import { useEngineState } from '../../hooks/use-engine-state';
import { evaluateMode, selectActivePage } from '@g5000/mast';
import { formatTile } from './format';
import { Grid } from './Grid';
import { Tile } from './Tile';
import { MAST_BASE_COLOR_HEX } from './colors';

function scalar(s: JsonSafeSample | undefined): number | null {
  if (!s || s.value.kind !== 'scalar') return null;
  return s.value.value;
}

export default function MastPage() {
  const { channels, connected: dataConnected } = useSse();
  const { layout, override, nightMode, dayBaseColor } = useMastControl();
  const engineRunning = useEngineState();

  if (!layout) {
    return (
      <div className="mast-root flex items-center justify-center">
        <div className="text-[5vh]" style={{ color: 'var(--mast-muted)' }}>
          Connecting to g5000…
        </div>
      </div>
    );
  }

  const twaRad = scalar(channels.get('wind.true.angle'));
  const sogMs = scalar(channels.get('nav.gps.sog'));
  const mode = evaluateMode({ twaRad, sogMs, engineRunning });
  const activeId = selectActivePage(layout, mode, override);
  const page = layout.pages.find((p) => p.id === activeId) ?? layout.pages[0]!;
  const night = nightMode;
  const now = Date.now();

  return (
    <div
      className={`mast-root${night ? ' mast-night' : ''}`}
      style={
        night
          ? undefined
          : ({ ['--mast-fg']: MAST_BASE_COLOR_HEX[dayBaseColor] } as React.CSSProperties)
      }
    >
      {!dataConnected && (
        <div
          className="absolute top-0 inset-x-0 text-center text-[3vh] py-[1vh] font-bold"
          style={{ background: 'var(--mast-red)', color: '#fff' }}
        >
          NO DATA — g5000 disconnected
        </div>
      )}
      <Grid grid={page.grid}>
        {page.tiles.map((t, i) => (
          <Tile
            key={i}
            label={t.label}
            units={t.units}
            fmt={formatTile(t, channels.get(t.field), now)}
          />
        ))}
      </Grid>
    </div>
  );
}
