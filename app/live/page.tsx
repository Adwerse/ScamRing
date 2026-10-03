'use client';
// Owner: D (built by B)
// Live alerts for this browser session: earlier alerts from /api/alerts, new ones from /api/stream.
import Link from 'next/link';
import { useEffect, useState } from 'react';

type LiveAlert = { _id: string; reportId: string; message: string; createdAt: string };

export default function Page() {
  const [alerts, setAlerts] = useState<LiveAlert[] | null>(null);

  useEffect(() => {
    fetch('/api/alerts', { cache: 'no-store' })
      .then((response) => response.json() as Promise<{ alerts: LiveAlert[] }>)
      .then((body) => setAlerts((current) => [...(current ?? []), ...body.alerts.filter((alert) => !current?.some((item) => item._id === alert._id))]))
      .catch(() => setAlerts([]));
    const source = new EventSource('/api/stream');
    source.addEventListener('alert', (event) => {
      const alert = JSON.parse((event as MessageEvent<string>).data) as LiveAlert;
      setAlerts((current) => (current?.some((item) => item._id === alert._id) ? current : [alert, ...(current ?? [])]));
    });
    return () => source.close();
  }, []);

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Live</p>
        <h1>Alerts for you</h1>
        <p>When a moderator confirms a scam, every listing you checked that is linked to it shows up here, as it happens. Keep this page open.</p>
      </div>
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
