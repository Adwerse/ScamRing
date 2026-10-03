import Link from 'next/link';
import { isVerdict, type Verdict } from './contracts';

const levels = {
  HIGH: { title: 'High risk', description: 'Strong warning signs. Pause before sending money.' },
  MEDIUM: { title: 'Needs a closer look', description: 'There are warning signs worth checking.' },
  LOW: { title: 'Few warning signs found', description: 'A low score does not prove that a listing is safe.' },
};

function connectionWording(text: string) {
  return text.replace(/\b(\d+)\s+hops?\b/gi, (_, count: string) => `${count} connection ${Number(count) === 1 ? 'step' : 'steps'}`);
}

export function VerdictCard({ verdict, reportId }: { verdict: Verdict; reportId: string }) {
  if (!isVerdict(verdict)) return <p className="notice error" role="alert">The checker returned an incomplete verdict. Please try again.</p>;
  const level = levels[verdict.level];
  return <section className={`panel verdict verdict-${verdict.level.toLowerCase()}`} aria-labelledby="verdict-title" aria-live="polite">
    <div className="verdict-top"><div><p className="eyebrow">Your listing check</p><h2 id="verdict-title" tabIndex={-1}>{level.title}</h2><p>{level.description}</p></div></div>
    <div className="risk-meter" aria-hidden="true"><span style={{ width: `${verdict.score}%` }} /></div>
    <p className="verdict-summary">{connectionWording(verdict.summary)}</p>
    <div className="section-heading evidence-heading"><h3>What we found</h3><span className="chip">{verdict.signals.length} {verdict.signals.length === 1 ? 'warning sign' : 'warning signs'}</span></div>
    {verdict.signals.length === 0 ? <p>No matching evidence was returned for this listing.</p> : <ul className="signals">{verdict.signals.map((signal, i) => <li key={`${signal.code}-${i}`}><div><h4>{signal.title}</h4><p>{connectionWording(signal.evidence)}</p>{signal.refs.length > 0 && <Link href={`/report/${encodeURIComponent(reportId)}#connections`}>Explore {new Set(signal.refs).size} referenced {new Set(signal.refs).size === 1 ? 'report' : 'reports'} →</Link>}</div></li>)}</ul>}
    <details className="verdict-scoring">
      <summary>How this warning-sign score is calculated</summary>
      <div className="score"><strong>{verdict.score}</strong><span> / 100 warning-sign score</span></div>
      <p className="score-explanation">The score adds points for matching warning signs, up to 100. A higher score means more or stronger warnings. It is not the probability that a listing is a scam.</p>
      {verdict.signals.length > 0 && <ul className="score-breakdown">{verdict.signals.map((signal, i) => <li key={`${signal.code}-${i}`}><span>{signal.title}</span><strong> +{signal.points} points</strong></li>)}</ul>}
      <p className="field-help">Below 30: few warning signs. 30–69: needs a closer look. 70 or more: high risk. Missing evidence can lower a score; always check the property before paying.</p>
    </details>
    <div className="next-steps"><h3>Before you pay</h3><p>View the property in person and check that the keys open the locks. Wait for a viewing and a contract before transferring money. If you suspect fraud, contact your local Garda station.</p><a href="https://threshold.ie" target="_blank" rel="noreferrer">Get housing advice from Threshold ↗</a></div>
    <Link className="text-link" href={`/report/${encodeURIComponent(reportId)}`}>Open full report →</Link>
  </section>;
}
