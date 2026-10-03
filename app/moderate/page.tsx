'use client';

import { useCallback, useEffect, useState } from 'react';

type QueueItem = {
  _id: string;
  area: string;
  priceEur: number | null;
  level: string | null;
  signalTitles: string[];
  ringSize: number;
};

export default function Page() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/moderation/queue', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Queue unavailable');
      setQueue(data);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Queue unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      setPin(localStorage.getItem('scamring:moderator-pin:v1') || '');
    } catch {}
    void load();
  }, [load]);
  async function moderate(id: string, action: string) {
    setBusy(id);
    setNotice('');
    try {
      const response = await fetch(`/api/moderation/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-moderator-pin': pin },
        body: JSON.stringify({ action, by: 'demo-moderator' }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Decision failed');
      await load();
      setNotice(
        action === 'confirm'
          ? 'Scam confirmed. Linked alerts are being delivered.'
          : action === 'legit'
            ? 'Report marked legitimate.'
            : 'Report rejected.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-bold">Moderation queue</h1>
      <p className="mt-2 text-neutral-500">
        Review the evidence before confirming a scam.
      </p>
      <div className="my-6 flex flex-wrap items-center gap-4">
        <label>
          Moderator PIN{' '}
          <input
            type="password"
            autoComplete="off"
            className="ml-2 w-32 rounded border p-2"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              try {
                localStorage.setItem('scamring:moderator-pin:v1', e.target.value);
              } catch {}
            }}
          />
        </label>
        <button
          className="rounded border px-4 py-2"
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh queue
        </button>
      </div>
      {error ? (
        <p role="alert" className="my-4 text-red-700">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="my-4 text-green-800">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p role="status">Loading reports…</p>
      ) : !error && !queue.length ? (
        <p>No pending reports.</p>
      ) : null}
      <p className="my-2 text-sm text-neutral-500 md:hidden">
        Swipe the table to see the decision buttons.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-left">
          <thead>
            <tr>
              {['Risk', 'Listing', 'Evidence', 'Ring', 'Decision'].map((label) => (
                <th key={label} className="border-b p-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {queue.map((item) => (
              <tr key={item._id}>
                <td className="border-b p-3 font-bold">
                  <span
                    className={`rounded-full px-3 py-1 text-sm ${item.level === 'HIGH' ? 'bg-red-100 text-red-800' : item.level === 'MEDIUM' ? 'bg-amber-100 text-amber-900' : item.level === 'LOW' ? 'bg-green-100 text-green-900' : 'bg-neutral-100 text-neutral-700'}`}
                  >
                    {item.level || 'Unscored'}
                  </span>
                </td>
                <td className="border-b p-3">
                  {item.area}
                  <br />
                  {item.priceEur == null ? 'Price unknown' : `€${item.priceEur}`}
                </td>
                <td className="border-b p-3">
                  {item.signalTitles.join(', ') || 'No signals yet'}
                </td>
                <td className="border-b p-3">{item.ringSize}</td>
                <td className="border-b p-3">
                  <div className="flex flex-wrap gap-2">
                    {(['confirm', 'legit', 'reject'] as const).map((action) => (
                      <button
                        key={action}
                        disabled={busy !== null || !pin}
                        onClick={() => void moderate(item._id, action)}
                        className={`rounded px-3 py-2 disabled:opacity-40 ${action === 'confirm' ? 'bg-red-800 text-white' : 'border'}`}
                      >
                        {action === 'confirm'
                          ? 'Confirm scam'
                          : action === 'legit'
                            ? 'Legit'
                            : 'Reject'}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
