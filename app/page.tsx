import CheckForm from '@/components/CheckForm';
import { RingPreview } from '@/components/RingPreview';

export const dynamic = 'force-dynamic';

export default function Page() {
  return <>
    <CheckForm demoEnabled={process.env.DEMO === '1'} intro={<section className="hero"><div className="eyebrow hero-label"><span className="pulse-dot" />A shared defence against rental scams</div><h1><span className="hero-desktop-lead">Before the deposit.<br /></span><em>Connect the dots.</em></h1><p><span className="hero-desktop-copy">Paste a rental listing. Look for reused photos, shared payment handles and connections to reported scams.</span><span className="hero-mobile-copy">Check a rental message for warning signs before paying.</span></p><RingPreview /></section>} />
    <section className="how-it-works"><p className="eyebrow">Small clues. A bigger picture.</p><div><article><span>↗</span><h3>Beyond a single listing</h3><p>Scammers can change a description. Shared contact details and reused photos can reveal the trail.</p></article><article><span>◎</span><h3>Evidence you can inspect</h3><p>See which warning signs raised the score, then explore the reports behind each connection.</p></article><article><span>↻</span><h3>A verdict that stays current</h3><p>Keep a report open to see updated evidence when a linked listing is confirmed.</p></article></div></section>
  </>;
}
