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

type AiResult = {
  reportId: string;
  decision: 'confirm_scam' | 'reject' | 'legit' | 'skip';
  reason: string;
  model: string;
  usedFallback: boolean;
  steps: { at: string; kind: 'model' | 'tool' | 'decision'; summary: string }[];
};

const DECISIONS: Record<AiResult['decision'], string> = {
  confirm_scam: 'confirmed as a scam',
  reject: 'rejected',
  legit: 'marked legitimate',
  skip: 'skipped, left for a human',
};

const DONE: Record<Action, string> = { confirm: 'Confirmed as a scam', legit: 'Marked legitimate', reject: 'Report rejected' };

export default function Page() {
  const [reports, setReports] = useState<QueuedReport[] | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState<AiResult | null>(null);

  const load = useCallback(async () => {
    const response = await fetch('/api/moderation/queue', { cache: 'no-store' });
    if (!response.ok) throw new Error('Moderation queue unavailable');
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
        const alerts = body.alerts === undefined ? '' : ` ${body.alerts} ${body.alerts === 1 ? 'alert was' : 'alerts were'} alerted.`;
        setNotice({ text: `${DONE[action]}: ${report.area}.${alerts}`, error: false });
        await load();
      }
    } catch {
      setNotice({ text: 'The request could not be completed. Refresh the queue before retrying.', error: true });
    } finally {
      setBusy(null);
    }
  }

  async function runAi(reportId?: string) {
    if (!pin) {
      setNotice({ text: 'Enter the moderator PIN first.', error: true });
      return;
    }
    setAiBusy(true);
    setNotice(null);
    setAi(null);
    try {
      const response = await fetch('/api/moderation/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-moderator-pin': pin },
        body: JSON.stringify(reportId ? { reportId } : {}),
      });
      if (response.status === 401) setNotice({ text: 'That PIN is not correct.', error: true });
      else if (response.status === 409) setNotice({ text: 'An AI review is already running. Try again in a moment.', error: true });
      else if (!response.ok) setNotice({ text: `The AI review failed (${response.status}).`, error: true });
      else {
        setAi((await response.json()) as AiResult);
        await load();
      }
    } catch {
      setNotice({ text: 'The AI review could not be completed. Refresh the queue before retrying.', error: true });
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <div className="page-intro">
        <p className="eyebrow">Moderation</p>
        <h1>Review reports</h1>
        <p className="muted">Decisions by the AI moderator are logged with their reason and can be overturned by a human.</p>
        <p>Confirming a scam alerts everyone who checked a linked listing and updates their verdicts. A shared detail is evidence of reuse, not proof of guilt, so confirm only what you have verified.</p>
      </div>
      <section className="panel" aria-labelledby="queue-title">
        <div className="section-heading">
          <h2 id="queue-title">Pending reports</h2>
          <button type="button" className="button secondary small" disabled={busy !== null || aiBusy || !pin} onClick={() => runAi()}>
            {aiBusy ? 'AI review running…' : 'AI review top of queue'}
          </button>
          <label className="pin-field">
            <span className="muted">Moderator PIN</span>
            <input id="moderator-pin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
        </div>
        {notice && <p className={notice.error ? 'notice error' : 'notice'} role="status">{notice.text}</p>}
        {ai && (
          <div className="ai-card" aria-live="polite">
            <h3>AI review: {DECISIONS[ai.decision]}</h3>
            <p>{ai.reason}</p>
            <p className="muted">
              Model: {ai.model}
              {ai.usedFallback ? ' · rule-based fallback was used' : ''}
              {ai.reportId ? <> · <Link href={`/report/${ai.reportId}`}>open report</Link></> : null}
            </p>
            <details>
              <summary>Steps ({ai.steps.length})</summary>
              <ol>
                {ai.steps.map((step, index) => (
                  <li key={index}><span className="chip">{step.kind}</span> {step.summary}</li>
                ))}
              </ol>
            </details>
          </div>
        )}
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
                    <button key={action} type="button" className={style} disabled={busy !== null || aiBusy || !pin} onClick={() => act(report, action)}>{label}</button>
                  ))}
                  <button type="button" className="button secondary small" disabled={busy !== null || aiBusy || !pin} onClick={() => runAi(report._id)}>AI review</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <style jsx>{`
        .pin-field { display: inline-flex; align-items: center; gap: 10px; }
        .pin-field input { width: 120px; padding: 8px 10px; border: 1px solid var(--control-border); border-radius: 6px; font: inherit; }
        .ai-card { margin: 12px 0; padding: 12px 16px; border: 1px solid var(--control-border); border-radius: 8px; }
        .ai-card h3 { margin: 0 0 6px; }
        .ai-card ol { margin: 8px 0 0; padding-left: 20px; }
        .ai-card li { margin: 4px 0; }
        .moderation-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
      `}</style>
    </>
  );
}
