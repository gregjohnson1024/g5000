import { Channels, type Bus, type VictronSnapshot } from '@g5000/core';

const SOURCE = 'victron';

/**
 * Publish a Victron snapshot's headline scalars onto the shared bus.
 * Null fields are silently skipped so consumers only see live values.
 */
export function publishVictronToBus(bus: Bus, snap: VictronSnapshot, source = SOURCE): void {
  const t_ns = BigInt(snap.updatedAt) * 1_000_000n;

  const emit = (channel: string, value: number | null): void => {
    if (value === null) return;
    bus.publish({ channel, source, t_ns, value: { kind: 'scalar', value } });
  };

  emit(Channels.Electrical.BatterySoc, snap.battery.soc);
  emit(Channels.Electrical.BatteryVoltage, snap.battery.voltage);
  emit(Channels.Electrical.BatteryCurrent, snap.battery.current);
  emit(Channels.Electrical.BatteryPower, snap.battery.power);
  emit(Channels.Electrical.DcPower, snap.dc.power);
  emit(Channels.Electrical.AcInputPower, snap.ac.inputPower);
  emit(Channels.Electrical.AcOutputPower, snap.ac.outputPower);
  emit(Channels.Electrical.SolarPower, snap.solar.totalPower);
}
