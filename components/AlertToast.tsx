'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAlerts } from '@/hooks/useAlerts';

export default function AlertToast() {
  const { alerts } = useAlerts();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const alert = alerts.at(-1);
  const reportAlert = alerts.findLast((item) => pathname === `/report/${item.reportId}`);

  useEffect(() => {
    if (!reportAlert) return;
    const abort = new AbortController();
    void fetch(`/api/reports/${reportAlert.reportId}`, {
      cache: 'no-store',
      signal: abort.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const report = await response.json();
        window.dispatchEvent(
          new CustomEvent('scamring:report-updated', { detail: report }),
        );
        router.refresh();
      })
      .catch(() => {});
    return () => abort.abort();
  }, [reportAlert, router]);

  if (!alert || alert._id === dismissed) return null;

  return (
    <aside
      role="alert"
      className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl bg-red-800 p-5 text-white shadow-xl"
    >
      <p className="font-bold">A linked scam was confirmed</p>
      <p className="mt-2">{alert.message}</p>
      <div className="mt-4 flex gap-4">
        <Link className="underline" href={`/report/${alert.reportId}`}>
          View updated report
        </Link>
        <button className="underline" onClick={() => setDismissed(alert._id)}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}
