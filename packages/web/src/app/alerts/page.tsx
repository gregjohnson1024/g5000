import { ActiveList } from './active-list';
import { HistoryList } from './history-list';
import { SettingsForm } from './settings-form';

export default function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <AlertsPageInner searchParamsPromise={searchParams} />;
}

async function AlertsPageInner({ searchParamsPromise }: { searchParamsPromise: Promise<{ tab?: string }> }) {
  const { tab = 'active' } = await searchParamsPromise;

  return (
    <main className="p-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Alerts</h1>
      <nav className="flex gap-4 mb-6 border-b">
        <TabLink href="?tab=active" label="Active" active={tab === 'active'} />
        <TabLink href="?tab=history" label="History" active={tab === 'history'} />
        <TabLink href="?tab=settings" label="Settings" active={tab === 'settings'} />
      </nav>
      {tab === 'active' && <ActiveList />}
      {tab === 'history' && <HistoryList />}
      {tab === 'settings' && <SettingsForm />}
    </main>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`pb-2 ${active ? 'border-b-2 border-blue-500 font-semibold' : 'text-gray-500'}`}
    >
      {label}
    </a>
  );
}
