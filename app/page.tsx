import CheckForm from '@/components/CheckForm';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <>
    <section className="hero"><div className="eyebrow hero-label"><span className="pulse-dot" />A shared defence against rental scams</div><h1>Before the deposit.<br /><em>Connect the dots.</em></h1><p>Check a rental listing against every scam students have already reported. Shared photos, familiar payment handles, hidden connections.</p><div className="hero-details"><span>01 Paste a listing</span><span>02 See the evidence</span><span>03 Explore the connections</span></div><div className="orbit-art" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" /><span className="orbit-core">SR</span><span className="orbit-node node-one" /><span className="orbit-node node-two" /><span className="orbit-node node-three" /></div></section>
    <CheckForm demoEnabled={process.env.DEMO === '1'} />
    <section className="how-it-works"><p className="eyebrow">Small clues. A bigger picture.</p><div><article><span>↗</span><h3>Beyond a single listing</h3><p>Scammers can change a description. Shared contact details and reused photos can reveal the trail.</p></article><article><span>◎</span><h3>Evidence you can inspect</h3><p>See which signals raised the score, then explore the reports behind each connection.</p></article><article><span>↻</span><h3>A verdict that stays current</h3><p>Keep a report open to see updated evidence when a linked listing is confirmed.</p></article></div></section>
  </>;
}
