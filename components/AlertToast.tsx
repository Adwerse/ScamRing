'use client';
// Owner: D (built by B)
// Live alert toasts: listens to /api/stream and shows each alert until dismissed, with a link to
// the listing it is about. Mounted once in app/layout.tsx.
import Link from 'next/link';
import { useEffect, useState } from 'react';

type LiveAlert = { _id: string; reportId: string; triggerReportId: string; message: string; createdAt: string };

export function AlertToast() {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.addEventListener('alert', (event) => {
      const alert = JSON.parse((event as MessageEvent<string>).data) as LiveAlert;
      setAlerts((current) => (current.some((item) => item._id === alert._id) ? current : [alert, ...current]));
    });
    return () => source.close();
  }, []);

  const dismiss = (id: string) => setAlerts((current) => current.filter((alert) => alert._id !== id));

  if (alerts.length === 0) return null;
  return (
    <div className="alert-toasts" role="region" aria-label="Live alerts" aria-live="assertive">
      {alerts.map((alert) => (
        <div className="alert-toast" key={alert._id} role="alert">
          <p className="alert-toast-label">Scam confirmed</p>
          <p className="alert-toast-message">{alert.message}</p>
          <div className="alert-toast-actions">
            <Link href={`/report/${alert.reportId}`} onClick={() => dismiss(alert._id)}>View the listing →</Link>
            <button type="button" onClick={() => dismiss(alert._id)} aria-label="Dismiss alert">Dismiss</button>
          </div>
        </div>
      ))}
      <style jsx>{`
        .alert-toasts { position: fixed; right: 20px; bottom: calc(20px + env(safe-area-inset-bottom, 0px)); z-index: 50; display: grid; gap: 12px; width: min(380px, calc(100vw - 40px)); }
        .alert-toast { background: var(--surface); border: 1px solid var(--subtle-red-border); border-left: 4px solid var(--risk-high); border-radius: 8px; padding: 16px 18px; box-shadow: 0 8px 24px rgba(0, 30, 43, .16); }
        .alert-toast-label { margin: 0 0 6px; font-size: 11px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; color: var(--risk-high); }
        .alert-toast-message { margin: 0 0 12px; font-size: 15px; color: var(--foreground); }
        .alert-toast-actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 14px; }
        .alert-toast-actions button { background: none; border: 0; color: var(--muted); font: inherit; cursor: pointer; padding: 4px; }
        .alert-toast-actions button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
        @media (prefers-reduced-motion: no-preference) { .alert-toast { animation: alert-in .25s ease-out; } }
        @keyframes alert-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
      `}</style>
    </div>
  );
}
