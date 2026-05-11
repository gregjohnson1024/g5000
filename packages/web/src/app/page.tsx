export default function Home() {
  return (
    <main className="p-6 space-y-2">
      <h1 className="text-2xl font-semibold">G5000</h1>
      <p className="text-slate-400">
        Performance instrument processor. See{' '}
        <a className="underline" href="/inspect">
          /inspect
        </a>{' '}
        for live channel data.
      </p>
    </main>
  );
}
