'use client';

import { useEffect, useState } from 'react';

type Entry = {
  area: string;
  priceEur: number | null;
  level: string | null;
  status: string;
  at: string;
};

export default function Page() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [connection, setConnection] = useState('Connecting…');

  useEffect(() => {
    const source = new EventSource('/api/stream?feed=live');
    source.onopen = () => setConnection('Live');
    source.onerror = () => setConnection('Reconnecting to live feed…');
    source.addEventListener('live', (event) => {
      try {
        const entry: Entry = JSON.parse((event as MessageEvent).data);
        setEntries((current) => [entry, ...current].slice(0, 30));
      } catch {}
    });
    return () => source.close();
  }, []);

  return (
    <>
      <h1 className="text-4xl font-bold">ScamRing live</h1>
      <p role="status" className="my-4 text-neutral-500">
        {connection}
      </p>
      {!entries.length ? (
        <p className="text-xl">Waiting for new checks and moderation decisions.</p>
      ) : null}
      <ul className="space-y-4">
        {entries.map((entry, i) => (
          <li key={`${entry.at}-${i}`} className="rounded-xl border p-6 text-2xl">
            <span className="font-bold">{entry.area}</span> ·{' '}
            {entry.priceEur == null ? 'Price unknown' : `€${entry.priceEur}`}
            <p className="mt-2">
              {entry.status === 'confirmed_scam' ? 'Scam confirmed' : entry.status} ·{' '}
              {entry.level || 'Scoring…'}
            </p>
            <time className="text-sm text-neutral-500">
              {new Date(entry.at).toLocaleTimeString()}
            </time>
          </li>
        ))}
      </ul>
    </>
  );
}
