'use client';

import { useEffect, useState } from 'react';
import { errorMessage, requestJson, type ProofResponse } from './contracts';

export default function ProofView() {
  const [proof, setProof] = useState<ProofResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    requestJson<ProofResponse>('/api/under-the-hood', { signal: controller.signal }).then(value => { if (typeof value.available !== 'boolean') throw new Error('The proof endpoint returned an incomplete response.'); setProof(value); }).catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  return <div className="result-stack">
    <div className="section-heading"><p className="muted">Live, read-only database inspection.</p><button className="button secondary" disabled={loading} onClick={() => setAttempt(a => a + 1)}>{loading ? 'Inspecting…' : 'Refresh evidence'}</button></div>
    {loading && <p className="notice" role="status">Reading collection counts, indexes and query execution…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && proof && !proof.available && <section className="panel empty-state"><span aria-hidden="true">◎</span><h2>Ready when the database is.</h2><p>{proof.message}</p><p>The checker UI can use the team’s stub responses while the database is being prepared.</p></section>}
    {!loading && proof?.available && <>
      {proof.empty && <p className="notice">The database is connected, but there are no reports yet. Import the seed to see the ring traversal and query execution evidence.</p>}
      <section className="panel"><p className="eyebrow">What’s in the database</p><h2>The shared evidence.</h2><div className="counts-grid">{Object.entries(proof.counts ?? {}).map(([name, count]) => <div key={name}><strong>{count.toLocaleString('en-IE')}</strong><span>{name.replaceAll('_', ' ')}</span></div>)}</div></section>
      <section className="panel"><p className="eyebrow">The query, explained</p><h2>{proof.scan?.stage === 'IXSCAN' ? 'An index does the searching.' : 'See how the query runs.'}</h2>{proof.scan ? <><div className="stats"><div><strong className="scan-stage">{proof.scan.stage}</strong><span>winning scan stage</span></div><div><strong>{proof.scan.keysExamined}</strong><span>keys examined</span></div><div><strong>{proof.scan.documentsExamined}</strong><span>documents examined</span></div></div><p>Index: <code>{proof.scan.indexName ?? 'No named index reported'}</code></p>{proof.scan.stage === 'COLLSCAN' && <p className="notice">This query currently scans the collection. The index setup needs to be checked by Lane A.</p>}</> : <p>No identifier lookup can be explained yet. A report with identifiers is needed.</p>}<p className="muted">This is execution evidence from an identifier lookup on a stored report. The scan stage is read from MongoDB’s winning plan.</p></section>
      <section className="panel"><p className="eyebrow">Following the connections</p><h2>One shared traversal.</h2>{proof.ring ? <><div className="stats"><div><strong>{proof.ring.reports}</strong><span>reports returned</span></div><div><strong>{proof.ring.sharedIdentifiers}</strong><span>shared identifiers</span></div><div><strong>{proof.ring.maxHops}</strong><span>maximum hops</span></div></div><p>{proof.ring.confirmed} confirmed scam reports in the sampled ring.</p><p className="muted">Returned by Lane A’s getRing helper for a stored report. Until its real implementation lands, this helper returns the frozen fixture.</p></> : <p>{proof.ringPending ? "The ring helper is returning reports outside this database. Live traversal evidence will appear when the backend implementation is ready." : "The traversal will appear after the first report is stored."}</p>}</section>
      <section className="panel"><p className="eyebrow">Database building blocks</p><h2>Indexes, in the open.</h2><div className="table-scroll"><table><caption className="sr-only">Collection indexes in the connected database</caption><thead><tr><th>Collection</th><th>Index</th><th>Fields</th></tr></thead><tbody>{proof.indexes?.map(index => <tr key={`${index.collection}-${index.name}`}><td>{index.collection}</td><td><code>{index.name}</code></td><td>{Object.keys(index.keys).join(', ')}</td></tr>)}</tbody></table></div>{!proof.indexes?.length && <p>No collection indexes were returned.</p>}<h3>Search & vector indexes</h3>{proof.searchIndexes?.length ? <ul className="index-list">{proof.searchIndexes.map(index => <li key={`${index.collection}-${index.name}`}><code>{index.name}</code><span>{index.collection}</span><span className="chip">{index.queryable ? 'Queryable' : index.status}</span></li>)}</ul> : <p>No search indexes were returned. Personal sandboxes skip these; restricted index permissions can also prevent inspection.</p>}</section>
    </>}
  </div>;
}
