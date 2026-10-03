'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { Component, useState, type ReactNode } from 'react';
import { kindLabel, priceLabel, statusLabel, type RingResponse } from './contracts';

const RingCanvas = dynamic(() => import('./RingCanvas'), { ssr: false, loading: () => <div className="graph-placeholder">Preparing the connection map…</div> });
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="notice">The map could not load. All connections are available in the list below.</p> : this.props.children; }
}

export default function RingGraph({ data }: { data: RingResponse }) {
  const [showMap, setShowMap] = useState(true);
  const reports = data.nodes.filter(n => n.type === 'report');
  const identifiers = new Map(data.nodes.filter(n => n.type === 'identifier').map(n => [n.id, n]));
  return <section className="panel connections" id="connections" aria-labelledby="connections-title">
    <div className="section-heading"><div><p className="eyebrow">The bigger picture</p><h2 id="connections-title">One listing. A shared trail.</h2></div><button type="button" className="button secondary small" onClick={() => setShowMap(!showMap)}>{showMap ? 'Hide map' : 'Show map'}</button></div>
    <p>Listings connect through shared contact details and reused photos. A connection is evidence to investigate, rather than proof on its own.</p>
    <div className="stats"><div><strong>{data.stats.reports}</strong><span>linked reports</span></div><div><strong>{data.stats.confirmed}</strong><span>confirmed scams</span></div><div><strong>{data.stats.maxHops}</strong><span>maximum hops</span></div></div>
    {showMap && <CanvasBoundary><RingCanvas data={data} /></CanvasBoundary>}
    <div className="legend"><span><i className="dot current" />Your listing</span><span><i className="dot confirmed_scam" />Confirmed scam</span><span><i className="dot pending" />Awaiting review</span><span><i className="dot legit" />Legitimate</span><span><i className="dot identifier" />Shared detail</span></div>
    <h3>Connected listings</h3>
    {reports.length === 0 ? <p>No connected reports yet.</p> : <ul className="report-list">{reports.map(report => {
      const details = data.links.filter(link => link.source === report.id || link.target === report.id).map(link => identifiers.get(link.source === report.id ? link.target : link.source)).filter(detail => detail !== undefined);
      return <li key={report.id}><div className="report-list-main"><Link href={`/report/${encodeURIComponent(report.id)}`}>{report.area || 'Area unspecified'}{report.isCurrent && <span className="chip blue">Your listing</span>}</Link><span>{priceLabel(report.priceEur)}</span></div><div className="report-list-meta"><span className={`status status-${report.status}`}>{statusLabel[report.status] || 'Awaiting review'}</span><span>{report.hops} {report.hops === 1 ? 'hop' : 'hops'}</span>{details.map(detail => <span className="chip" key={detail.id} title={detail.kind === 'img' ? 'Reused photo' : detail.hint}>{kindLabel[detail.kind]}</span>)}</div></li>;
    })}</ul>}
  </section>;
}
