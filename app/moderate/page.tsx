'use client';
// Owner: D (built by B)
// Moderation queue: pending reports, highest score first. A moderator enters the PIN once and
// confirms, clears or rejects each report. Confirming alerts everyone who checked a linked listing.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Action = 'confirm' | 'legit' | 'reject';

type QueuedReport = {
  _id: string;
  text: string;
  area: string;
  kind: 'room' | 'whole';
  priceEur: number | null;
  seed: boolean;
  verdict?: { score: number; level: 'LOW' | 'MEDIUM' | 'HIGH' };
};

const ACTIONS: { action: Action; label: string; style: string }[] = [
  { action: 'confirm', label: 'Confirm scam', style: 'button primary small' },
  { action: 'legit', label: 'Mark legitimate', style: 'button secondary small' },
  { action: 'reject', label: 'Reject report', style: 'button secondary small' },
];

const DONE: Record<Action, string> = { confirm: 'Confirmed as a scam', legit: 'Marked legitimate', reject: 'Report rejected' };

export default function Page() {
  const [reports, setReports] = useState<QueuedReport[] | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/moderation/queue', { cache: 'no-store' });
    const body = (await response.json()) as { reports: QueuedReport[] };
    setReports(body.reports);
  }, []);

  useEffect(() => {
    load().catch(() => setNotice({ text: 'Could not load the queue. Refresh to try again.', error: true }));
  }, [load]);

  async function act(report: QueuedReport, action: Action) {
    if (!pin) {
      setNotice({ text: 'Enter the moderator PIN first.', error: true });
      return;
    }
    setBusy(report._id);
    setNotice(null);
    try {
      const response = await fetch(`/api/moderation/${report._id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, pin }),
      });
      const body = (await response.json()) as { error?: string; alerts?: number };
      if (response.status === 401) setNotice({ text: 'That PIN is not correct.', error: true });
      else if (!response.ok) setNotice({ text: `The action failed (${body.error ?? response.status}).`, error: true });
      else {
        const alerts = body.alerts === undefined ? '' : ` ${body.alerts} ${body.alerts === 1 ? 'person was' : 'people were'} alerted.`;
        setNotice({ text: `${DONE[action]}: ${report.area}.${alerts}`, error: false });
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Moderation</p>
        <h1>Review reports</h1>
        <p>Confirming a scam alerts everyone who checked a linked listing and updates their verdicts. A shared detail is evidence of reuse, not proof of guilt, so confirm only what you have verified.</p>
      </div>
      <section className="panel" aria-labelledby="queue-title">
        <div className="section-heading">
          <h2 id="queue-title">Pending reports</h2>
          <label className="pin-field">
            <span className="muted">Moderator PIN</span>
            <input id="moderator-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
        </div>
        {notice && <p className={notice.error ? 'notice error' : 'notice'} role="status">{notice.text}</p>}
        {reports === null ? (
          <p className="muted">Loading the queue…</p>
        ) : reports.length === 0 ? (
          <div className="empty-state"><span>✓</span><p>No reports are waiting for review.</p></div>
        ) : (
          <ul className="report-list">
            {reports.map((report) => (
              <li key={report._id}>
                <div className="listing-meta">
                  <Link href={`/report/${report._id}`}>{report.area}</Link>
                  <span>{report.priceEur === null ? 'No price' : `€${report.priceEur.toLocaleString('en-IE')} / month`}</span>
                  <span>{report.verdict ? `${report.verdict.level} · ${report.verdict.score}` : 'No verdict yet'}</span>
                  {report.seed && <span className="chip">Demo data</span>}
                </div>
                <p className="muted">{report.text.length > 180 ? `${report.text.slice(0, 180)}…` : report.text}</p>
                <div className="moderation-actions">
                  {ACTIONS.map(({ action, label, style }) => (
                    <button key={action} type="button" className={style} disabled={busy === report._id} onClick={() => act(report, action)}>{label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <style jsx>{`
        .pin-field { display: inline-flex; align-items: center; gap: 10px; }
        .pin-field input { width: 120px; padding: 8px 10px; border: 1px solid var(--control-border); border-radius: 6px; font: inherit; }
        .moderation-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      `}</style>
    </>
  );
}
