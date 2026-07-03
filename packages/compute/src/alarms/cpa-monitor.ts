import {
  subscribeSelected,
  getSharedSourcePriority,
  getSharedAisTargets,
  Channels,
} from '@g5000/core';
import type { Bus, AlarmsRegistry, AlarmSeverity, AisTargetsRegistry } from '@g5000/core';
import type { AlarmsConfig, AisAlarmConfig } from '@g5000/db';
import { computeCpa } from '../ais/cpa.js';

const ID = 'ais-cpa';
const CHECK_INTERVAL_MS = 2000;
/** Ignore AIS targets (and our own fix) whose last update is older than this. */
const STALE_MS = 60_000;
/** TCPA below this escalates the alarm from WARN to CRITICAL. */
const CRITICAL_TCPA_S = 300;
const M_PER_NM = 1852;

/**
 * Thresholds come from AisAlarmConfig (the same ConfigStore kind the /ais and
 * /chart pages read) — single source of truth, deliberately NOT duplicated
 * into AlarmsConfig.thresholds. AlarmsConfig only carries the enabled gate.
 *
 * We can't `import { getSharedConfigStore } from '@g5000/db'` at runtime:
 * this module is re-exported from the @g5000/compute root, which client
 * components bundle, and a runtime db import would drag better-sqlite3 into
 * the client build (same trap the race subpath exists to avoid). Instead we
 * duck-type the documented globalThis singleton key the store publishes on.
 */
function defaultGetAisAlarmConfig(): AisAlarmConfig | undefined {
  const store = (globalThis as { __g5000_configStore__?: { getAisAlarmConfig(): AisAlarmConfig } })
    .__g5000_configStore__;
  return store?.getAisAlarmConfig();
}

export interface CpaMonitorDeps {
  /** AIS CPA/TCPA thresholds. Defaults to the shared ConfigStore singleton. */
  getAisAlarmConfig?: () => AisAlarmConfig | undefined;
  /** AIS targets registry. Defaults to the shared globalThis singleton. */
  getTargets?: () => AisTargetsRegistry | undefined;
  /** Check cadence, ms. */
  intervalMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

interface OwnVector {
  lat?: number;
  lon?: number;
  /** Radians. */
  cog?: number;
  /** m/s. */
  sog?: number;
  posAtMs?: number;
  cogAtMs?: number;
  sogAtMs?: number;
}

function formatLabel(cpaMeters: number, tcpaSeconds: number): string {
  const nm = (cpaMeters / M_PER_NM).toFixed(1);
  const when =
    tcpaSeconds < 60 ? `${Math.round(tcpaSeconds)} s` : `${Math.round(tcpaSeconds / 60)} min`;
  return `CPA ${nm} nm in ${when}`;
}

/**
 * Periodic CPA/TCPA collision monitor. Every ~2 s it projects every fresh AIS
 * target against our own GPS vector; any target with CPA below the configured
 * radius AND a positive TCPA inside the configured horizon is a threat. Fires
 * a single non-sticky 'ais-cpa' alarm for the most imminent threat (WARN, or
 * CRITICAL when TCPA < 5 min) and clears it when the threat set goes empty.
 */
export function startCpaMonitor(
  bus: Bus,
  registry: AlarmsRegistry,
  configRef: { current: AlarmsConfig },
  deps: CpaMonitorDeps = {},
): { dispose(): void } {
  const getAisAlarmConfig = deps.getAisAlarmConfig ?? defaultGetAisAlarmConfig;
  const getTargets = deps.getTargets ?? getSharedAisTargets;
  const now = deps.now ?? Date.now;

  // Cache the latest own-boat vector off the bus; the interval below reads it.
  const own: OwnVector = {};
  const unsubs = [
    subscribeSelected(bus, Channels.Nav.Position, getSharedSourcePriority, (s) => {
      if (s.value.kind !== 'geo') return;
      own.lat = s.value.value.lat;
      own.lon = s.value.value.lon;
      own.posAtMs = now();
    }),
    subscribeSelected(bus, Channels.Nav.Cog, getSharedSourcePriority, (s) => {
      if (s.value.kind !== 'scalar' || !Number.isFinite(s.value.value)) return;
      own.cog = s.value.value;
      own.cogAtMs = now();
    }),
    subscribeSelected(bus, Channels.Nav.Sog, getSharedSourcePriority, (s) => {
      if (s.value.kind !== 'scalar' || !Number.isFinite(s.value.value)) return;
      own.sog = s.value.value;
      own.sogAtMs = now();
    }),
  ];

  const check = (): void => {
    if (!configRef.current.enabled[ID]) {
      registry.clear(ID);
      return;
    }
    const ais = getAisAlarmConfig();
    if (!ais || !ais.enabled) {
      registry.clear(ID);
      return;
    }
    const targets = getTargets();
    const nowMs = now();
    const ownFresh =
      own.lat !== undefined &&
      own.lon !== undefined &&
      own.cog !== undefined &&
      own.sog !== undefined &&
      own.posAtMs !== undefined &&
      nowMs - own.posAtMs <= STALE_MS &&
      own.cogAtMs !== undefined &&
      nowMs - own.cogAtMs <= STALE_MS &&
      own.sogAtMs !== undefined &&
      nowMs - own.sogAtMs <= STALE_MS;
    if (!targets || !ownFresh) {
      // No basis to confirm a threat — don't hold a possibly-stale alarm.
      registry.clear(ID);
      return;
    }

    const ownIn = { lat: own.lat!, lon: own.lon!, cog: own.cog!, sog: own.sog! };
    const threats: { mmsi: number; name?: string; cpaM: number; tcpaS: number }[] = [];
    for (const t of targets.all()) {
      if (nowMs - t.lastSeenMs > STALE_MS) continue; // stale fix
      if (t.lat === undefined || t.lon === undefined) continue;
      if (t.cog === undefined || t.sog === undefined) continue; // no motion vector
      const r = computeCpa(ownIn, { lat: t.lat, lon: t.lon, cog: t.cog, sog: t.sog });
      if (r.cpaMeters < ais.cpaMeters && r.tcpaSeconds >= 0 && r.tcpaSeconds < ais.tcpaSeconds) {
        threats.push({ mmsi: t.mmsi, name: t.name, cpaM: r.cpaMeters, tcpaS: r.tcpaSeconds });
      }
    }

    if (threats.length === 0) {
      registry.clear(ID);
      return;
    }

    threats.sort((a, b) => a.tcpaS - b.tcpaS);
    const worst = threats[0]!;
    const severity: AlarmSeverity = worst.tcpaS < CRITICAL_TCPA_S ? 'CRITICAL' : 'WARN';

    // While acked-but-still-pending, don't re-fire every tick (that would
    // undo the ack) — unless the situation escalates WARN → CRITICAL.
    const current = registry.get(ID);
    const ackedPending =
      current !== undefined && current.clearedAt === null && current.ackedAt !== null;
    if (ackedPending && !(severity === 'CRITICAL' && current.severity !== 'CRITICAL')) return;

    registry.fire({
      id: ID,
      severity,
      label: formatLabel(worst.cpaM, worst.tcpaS),
      sticky: false,
      context: {
        mmsi: worst.mmsi,
        ...(worst.name !== undefined ? { name: worst.name } : {}),
        cpaM: worst.cpaM,
        tcpaS: worst.tcpaS,
        threats: threats.length,
      },
    });
  };

  const timer = setInterval(check, deps.intervalMs ?? CHECK_INTERVAL_MS);

  return {
    dispose: () => {
      clearInterval(timer);
      for (const u of unsubs) u();
    },
  };
}
