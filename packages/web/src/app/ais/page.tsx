import { notFound } from 'next/navigation';
import { AisClientView } from './client-view';

// Read env at render so the Pi can hide the page via systemd
// Environment=G5000_HIDE_AIS=1 without a rebuild.
export const dynamic = 'force-dynamic';

export default function AisPage() {
  if (process.env.G5000_HIDE_AIS === '1') notFound();
  return <AisClientView />;
}
