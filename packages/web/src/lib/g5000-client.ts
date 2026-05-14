/**
 * URL helper for the in-process HTTP self-loop used by the track recorder.
 * After the router merged into packages/web, the recorder still reads
 * `/api/position` via fetch rather than subscribing to the bus directly —
 * kept as-is to keep the merge minimal. A follow-up can replace the HTTP
 * hop with a direct `getSharedBus().channel('nav.gps.position')`
 * subscription.
 */
const HOST = process.env.G5000_HOST ?? 'http://localhost:3000';

export function positionStreamUrl(): string {
  return `${HOST}/api/position`;
}
