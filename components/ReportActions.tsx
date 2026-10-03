'use client';

import { useEffect, useRef, useState } from 'react';

export function ReportActions({ reportId }: { reportId: string }) {
  const [message, setMessage] = useState('');
  const [fallback, setFallback] = useState('');
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (fallback) { linkInput.current?.focus(); linkInput.current?.select(); }
  }, [fallback]);
  async function copyLink() {
    const url = new URL(`/report/${encodeURIComponent(reportId)}`, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      setFallback(''); setMessage('Report link copied.');
    } catch {
      setFallback(url); setMessage('Copy the selected report link below.');
    }
  }
  return <div className="report-actions">
    <div className="report-action-buttons">
      <button className="button secondary small" type="button" onClick={() => void copyLink()}>Copy report link</button>
      <button className="button secondary small" type="button" onClick={() => window.print()}>Print report</button>
    </div>
    <p className="field-help">The link opens this report for anyone you share it with.</p>
    <p className="field-help" role="status">{message}</p>
    {fallback && <label>Report link<input ref={linkInput} readOnly value={fallback} onFocus={event => event.target.select()} /></label>}
  </div>;
}
