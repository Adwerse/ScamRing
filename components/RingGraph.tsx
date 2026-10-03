'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useState, type ReactNode } from 'react';
import { kindLabel, priceLabel, statusLabel, type RingNode, type RingResponse } from './contracts';
import { evidencePath } from './evidencePath';

const RingCanvas = dynamic(() => import('./RingCanvas'), { ssr: false, loading: () => <div className="graph-placeholder">Preparing the connection map…</div> });
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="notice">The map could not load. All connections are available in the list below.</p> : this.props.children; }
}

function stepLabel(node: RingNode): ReactNode {
  if (node.type === 'identifier') return <span className="path-detail">{node.kind === 'img' ? 'the same photo' : `the same ${kindLabel[node.kind].toLowerCase()} ${node.hint}`}</span>;
  if (node.isCurrent) return <strong className="path-listing current">Your listing</strong>;
  return <strong className={`path-listing ${node.status}`}>{node.area || 'Area unspecified'}{node.status === 'confirmed_scam' ? ' · confirmed scam' : ''}</strong>;
}

export default function RingGraph({ data }: { data: RingResponse }) {
  const [showMap, setShowMap] = useState(true);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const path = evidencePath(data);
  const reports = data.nodes.filter(n => n.type === 'report');
  const selected = reports.find(report => report.id === selectedReport);
  function selectReport(id: string) { setSelectedReport(previous => previous === id ? null : id); }
  const identifiers = new Map(data.nodes.filter(n => n.type === 'identifier').map(n => [n.id, n]));
  return <section className="panel connections" id="connections" aria-labelledby="connections-title">
    <div className="section-heading"><div><p className="eyebrow">The bigger picture</p><h2 id="connections-title">One listing. A shared trail.</h2></div><button type="button" className="button secondary small" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Show map'}</button></div>
    <p>Listings connect through shared contact details and reused photos. A connection is evidence to investigate, rather than proof on its own.</p>
    <div className="stats"><div><strong>{data.stats.reports}</strong><span>linked reports</span></div><div><strong>{data.stats.confirmed}</strong><span>confirmed scams</span></div><div><strong>{data.stats.maxHops}</strong><span>connection steps away</span></div></div>
    <p className="field-help">One connection step means a listing shares a detail with yours. Two steps means it connects through another listing. The number above is the furthest connection shown.</p>
    {path && <div className="evidence-path" aria-label="How this listing connects to a confirmed scam"><p className="eyebrow">How it connects to a confirmed scam</p><ol>{path.steps.map((step, index) => <li key={step.id}>{index > 0 && <span className="path-arrow" aria-hidden="true">→</span>}{stepLabel(step)}</li>)}</ol></div>}
    {showMap && <CanvasBoundary><RingCanvas data={data} path={path} selectedReport={selected?.id} onReportSelect={selectReport} /></CanvasBoundary>}
    <div className="legend"><span><i className="dot current" />Your listing</span><span><i className="dot confirmed_scam" />Confirmed scam</span><span><i className="dot pending" />Awaiting review</span><span><i className="dot legit" />Legitimate</span><span><i className="dot identifier" />Shared detail</span></div>
    <h3>Connected listings</h3>
    <p className="selection-status" role="status">{selected ? `${selected.area || 'The selected report'} is highlighted in the map and list.` : 'Select a report in the map or highlight one below to follow its connections.'}</p>
    {reports.length === 0 ? <p>No connected reports yet.</p> : <ul className="report-list">{reports.map(report => {
      const details = data.links.filter(link => link.source === report.id || link.target === report.id).map(link => identifiers.get(link.source === report.id ? link.target : link.source)).filter(detail => detail !== undefined);
      return <li key={report.id} data-selected={selected?.id === report.id}><div className="report-list-main"><Link href={`/report/${encodeURIComponent(report.id)}`}>{report.area || 'Area unspecified'}{report.isCurrent && <span className="chip blue">Your listing</span>}</Link><span>{priceLabel(report.priceEur)}</span></div><div className="report-list-meta"><span className={`status status-${report.status}`}>{statusLabel[report.status] || 'Awaiting review'}</span><span>{report.hops} {report.hops === 1 ? 'connection step' : 'connection steps'}</span>{details.map(detail => <span className="chip shared-detail" key={detail.id}>{detail.kind === 'img' ? 'Reused photo' : `${kindLabel[detail.kind]}: ${detail.hint}`}</span>)}<button className="text-button highlight-report" type="button" aria-pressed={selected?.id === report.id} aria-label={`${selected?.id === report.id ? 'Clear highlight for' : 'Highlight'} ${report.area || 'report'} at ${priceLabel(report.priceEur)}`} onClick={() => selectReport(report.id)}>{selected?.id === report.id ? 'Clear highlight' : 'Highlight'}</button></div></li>;
    })}</ul>}
    <style jsx>{`
      .evidence-path { border: 1px solid var(--subtle-red-border); background: var(--subtle-red); border-radius: 8px; padding: 14px 18px; margin: 0 0 18px; }
      .evidence-path .eyebrow { color: var(--risk-high); margin-bottom: 8px; }
      .evidence-path ol { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 4px; font-size: 16px; }
      .evidence-path li { display: inline-flex; align-items: center; gap: 4px; }
      .path-arrow { color: var(--muted); padding: 0 4px; }
      .path-detail { color: var(--foreground); }
      .path-listing.current { color: var(--focus); }
      .path-listing.confirmed_scam { color: var(--risk-high); }
    `}</style>
  </section>;
}
