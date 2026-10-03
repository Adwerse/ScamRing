import type { Metadata } from 'next';
import PropertyMap from '@/components/PropertyMap';

export const metadata: Metadata = { title: 'Ireland listing map | ScamRing' };
export default function Page() {
  return <><div className="page-intro property-map-intro"><p className="eyebrow">A wider view of the evidence</p><h1>Rental reports.<br /><em>Across Ireland.</em></h1><p>Explore saved listing checks by area and suspicion level. Select a marker to read the reports behind it.</p></div><PropertyMap /></>;
}
