'use client';

import { SolarTab } from '../tabs/SolarTab';

export default function AnchorSolarPage() {
  return (
    <main className="p-6 page-main">
      <h1 className="text-xl font-semibold text-ink mb-3">Solar</h1>
      <SolarTab />
    </main>
  );
}
