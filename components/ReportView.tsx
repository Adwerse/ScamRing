'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import RingGraph from './RingGraph';
import { VerdictCard } from './VerdictCard';
import { errorMessage, isRing, isVerdict, priceLabel, requestJson, statusLabel, type CheckResponse, type ReportResponse, type RingResponse } from './contracts';

export function ReportView({ reportId, initial }: { reportId: string; initial?: CheckResponse }) {
  const [report, setReport] = useState<ReportResponse>();
  const [ring, setRing] = useState<RingResponse>();
  const [reportError, setReportError] = useState('');
  const [ringError, setRingError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const revision = useRef(0);
  const validId = /^[a-f\d]{24}$/i.test(reportId);
  const refresh = useCallback(async (signal?: AbortSignal, quiet = false) => {
    if (!validId) { setLoading(false); return; }
    const currentRevision = ++revision.current;
    if (!quiet) setRefreshing(true);
    const encoded = encodeURIComponent(reportId);
    const results = await Promise.allSettled([
      requestJson<ReportResponse>(`/api/reports/${encoded}`, { signal }),
      requestJson<RingResponse>(`/api/reports/${encoded}/ring`, { signal }),
    ]);
    if (signal?.aborted || revision.current !== currentRevision) return;
    const [reportResult, ringResult] = results;
    if (reportResult.status === 'fulfilled') {
      if (typeof reportResult.value._id !== 'string' || typeof reportResult.value.text !== 'string' || (reportResult.value.verdict && !isVerdict(reportResult.value.verdict))) setReportError('The report response is incomplete. Please retry.');
      else { setReport(previous => JSON.stringify(previous) === JSON.stringify(reportResult.value) ? previous : reportResult.value); setReportError(''); }
    } else setReportError(errorMessage(reportResult.reason));
    if (ringResult.status === 'fulfilled' && isRing(ringResult.value)) { setRing(previous => JSON.stringify(previous) === JSON.stringify(ringResult.value) ? previous : ringResult.value); setRingError(''); }
    else setRingError(ringResult.status === 'rejected' ? errorMessage(ringResult.reason) : 'The connection map response is incomplete. Please retry.');
    setLoading(false); setRefreshing(false);
  }, [reportId, validId]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      await refresh(controller.signal, true);
      if (!controller.signal.aborted) timer = setTimeout(tick, 3000);
    }
    void tick();
    // Periodic fallback complements the alert-triggered refresh from the mounted toast.
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const onAlert = (event: Event) => {
      const alert = (event as CustomEvent<{ reportId: string }>).detail;
      if (alert?.reportId === reportId) void refresh(controller.signal, true);
    };
    window.addEventListener('scamring:alert', onAlert);
    return () => { controller.abort(); window.removeEventListener('scamring:alert', onAlert); };
  }, [reportId, refresh]);
  const verdict = report?.verdict ?? initial?.verdict;
  if (!validId) return <p className="notice error" role="alert">That report link is not valid. Return to the check page to check a listing.</p>;
  return <div className="result-stack">
    <div className="section-heading"><p className="muted">This report refreshes every 3 seconds while open.</p><button type="button" className="button secondary small" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh report'}</button></div>
    {reportError && <p className="notice error" role="alert">{verdict ? 'The last result is shown; the latest update could not be fetched. ' : ''}{reportError}</p>}
    {loading && !initial && <p className="notice" role="status">Loading this report and its connections…</p>}
    {verdict && <VerdictCard verdict={verdict} reportId={reportId} />}
    {!loading && !verdict && !reportError && <p className="notice">This report has not received a verdict yet. Its listing and connections are available below.</p>}
    {!initial && report && <section className="panel"><p className="eyebrow">Reported listing</p><h2>{report.area || 'Area unspecified'}</h2><div className="listing-meta"><span>{priceLabel(report.priceEur)}</span><span>{report.kind === 'room' ? 'Room' : 'Whole property'}</span><span>{report.source}</span><span>{statusLabel[report.status]}</span></div><p className="listing-text">{report.text}</p></section>}
    {ringError && <div className="notice error" role="alert"><p>The connection map could not be updated. {ringError}</p><button className="button secondary small" type="button" onClick={() => void refresh()}>Retry connections</button></div>}
    {ring && <RingGraph data={ring} />}
  </div>;
}
