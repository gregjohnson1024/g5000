'use client';

import { AcLoadsTab } from '../tabs/AcLoadsTab';

export default function AnchorAcPage() {
  return (
    <main className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold text-ink mb-3">AC loads</h1>
      <AcLoadsTab />
    </main>
  );
}
