import Link from 'next/link';
import { join } from 'node:path';
import { PLANS_DIR } from '../../lib/paths';
import { listJson, readJson } from '../../lib/persistence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface PlanRecord {
  id: string;
  name: string;
  createdAt: number;
  route: { distance: number; model: string };
}

export default async function PlansPage() {
  const names = await listJson(PLANS_DIR);
  const items = (
    await Promise.all(names.map((n) => readJson<PlanRecord>(join(PLANS_DIR, n))))
  ).filter((p): p is PlanRecord => p !== null);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return (
    <main className="p-8 max-w-3xl">
      <h1 className="text-2xl mb-4">Saved Plans</h1>
      {items.length === 0 && (
        <div className="text-slate-400">No saved plans yet.</div>
      )}
      <ul className="divide-y divide-slate-800">
        {items.map((p) => (
          <li key={p.id} className="py-2 flex justify-between">
            <Link href={`/chart?plan=${p.id}`} className="text-emerald-400">
              {p.name}
            </Link>
            <span className="text-xs text-slate-500">
              {p.route.model} · {(p.route.distance / 1852).toFixed(0)} NM ·{' '}
              {new Date(p.createdAt * 1000).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
