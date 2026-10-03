import Link from 'next/link';
import { isVerdict, type Verdict } from './contracts';

const levels = {
  HIGH: { title: 'High risk', description: 'Strong warning signs. Pause before sending money.' },
  MEDIUM: { title: 'Needs a closer look', description: 'There are warning signs worth checking.' },
  LOW: { title: 'Few warning signs found', description: 'A low score does not prove that a listing is safe.' },
};

export function VerdictCard({ verdict, reportId }: { verdict: Verdict; reportId: string }) {
  if (!isVerdict(verdict)) return <p className="notice error" role="alert">The checker returned an incomplete verdict. Please try again.</p>;
  const level = levels[verdict.level];
  return <section className={`panel verdict verdict-${verdict.level.toLowerCase()}`} aria-labelledby="verdict-title" aria-live="polite">
    <div className="verdict-top"><div><p className="eyebrow">Your listing check</p><h2 id="verdict-title">{level.title}</h2><p>{level.description}</p></div><div className="score"><strong>{verdict.score}</strong><span>/ 100 · {verdict.level}</span></div></div>
    <p className="verdict-summary">{verdict.summary}</p>
    <h3>What we found</h3>
    {verdict.signals.length === 0 ? <p>No matching evidence was returned for this listing.</p> : <ul className="signals">{verdict.signals.map((signal, i) => <li key={`${signal.code}-${i}`}><span className="points">+{signal.points}</span><div><h4>{signal.title}</h4><p>{signal.evidence}</p>{signal.refs.length > 0 && <Link href={`/report/${encodeURIComponent(reportId)}#connections`}>Explore {new Set(signal.refs).size} referenced {new Set(signal.refs).size === 1 ? 'report' : 'reports'} →</Link>}</div></li>)}</ul>}
    <div className="next-steps"><h3>Before you pay</h3><p>View the property in person and check that the keys open the locks. Wait for a viewing and a contract before transferring money. If you suspect fraud, contact your local Garda station.</p><a href="https://threshold.ie" target="_blank" rel="noreferrer">Get housing advice from Threshold ↗</a></div>
    <Link className="text-link" href={`/report/${encodeURIComponent(reportId)}`}>Open full report →</Link>
  </section>;
}
