import Link from 'next/link';
import { ReportView } from '@/components/ReportView';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Link className="back-link" href="/">← Check another listing</Link>
      <div className="page-intro"><p className="eyebrow">Follow the evidence</p><h1>Your listing, connected.</h1><p>A report brings the warning signs and the shared trail together.</p></div>
      <ReportView key={id} reportId={id} />
    </>
  );
}
