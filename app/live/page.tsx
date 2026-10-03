'use client';
// Owner: D (built by B)
// Live alerts for this browser session: earlier alerts from /api/alerts, new ones from /api/stream.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAlerts } from '@/hooks/useAlerts';

type LiveAlert = { _id: string; reportId: string; message: string; createdAt: string };

export default function Page() {
  const [history, setHistory] = useState<LiveAlert[] | null>(null);
  const { alerts: fresh, connection } = useAlerts();
  const alerts = history === null && !fresh.length ? null : [...new Map([...(history ?? []), ...fresh].map((alert) => [alert._id, alert])).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    const abort = new AbortController();
    void fetch('/api/alerts', { cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Alerts unavailable');
        return response.json() as Promise<{ alerts: LiveAlert[] }>;
      })
      .then((body) => setHistory(body.alerts))
      .catch(() => { if (!abort.signal.aborted) setHistory([]); });
    return () => abort.abort();
  }, []);

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Live</p>
        <h1>Alerts for you</h1>
        <p>When a moderator confirms a scam, every listing you checked that is linked to it shows up here, as it happens. Keep this page open.</p>
      </div>
      <p role="status" className="muted">Connection: {connection}</p>
      <section className="panel" aria-live="polite" aria-labelledby="alerts-title">
        <h2 id="alerts-title" className="sr-only">Your alerts</h2>
        {alerts === null ? (
          <p className="muted">Loading your alerts…</p>
        ) : alerts.length === 0 ? (
          <div className="empty-state"><span>◎</span><p>No alerts yet. Check a listing, and you will be told here if it is linked to a confirmed scam.</p></div>
        ) : (
          <ul className="report-list">
            {alerts.map((alert) => (
              <li key={alert._id}>
                <p>{alert.message}</p>
                <div className="listing-meta">
                  <span className="muted">{new Date(alert.createdAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}</span>
                  <Link href={`/report/${alert.reportId}`}>View the listing →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
