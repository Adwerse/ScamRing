'use client';

import { useEffect, useState } from 'react';

export type LiveAlert = {
  _id: string;
  sessionId: string;
  reportId: string;
  triggerReportId: string;
  message: string;
  seen: boolean;
  createdAt: string;
};

export function useAlerts() {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);
  const [connection, setConnection] = useState('connecting');

  useEffect(() => {
    const seen = new Set<string>();
    let since = new Date().toISOString();
    let after = '';
    let stopped = false;
    let polling = false;
    let errors = 0;
    let inFlight: Promise<void> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = new AbortController();
    const accept = (alert: LiveAlert) => {
      if (stopped || seen.has(alert._id)) return;
      seen.add(alert._id);
      setAlerts((current) => [...current.slice(-19), alert]);
      window.dispatchEvent(new CustomEvent('scamring:alert', { detail: alert }));
    };

    const catchUp = () => {
      if (inFlight) return inFlight;
      inFlight = (async () => {
        let count: number;
        do {
          const params = new URLSearchParams({ since, ...(after ? { after } : {}) });
          const response = await fetch(`/api/alerts?${params}`, {
            signal: abort.signal,
            cache: 'no-store',
          });
          if (!response.ok) throw new Error('Alerts unavailable');
          const { alerts: items }: { alerts: LiveAlert[] } = await response.json();
          if (stopped) return;
          items.forEach(accept);
          const last = items.at(-1);
          if (last) {
            since = last.createdAt;
            after = last._id;
          }
          count = items.length;
        } while (count === 100 && !stopped);
      })().finally(() => {
        inFlight = undefined;
      });
      return inFlight;
    };

    const poll = async () => {
      try {
        await catchUp();
        if (!stopped) setConnection('polling');
      } catch {
        if (!stopped) setConnection('reconnecting');
      }
      if (!stopped) timer = setTimeout(poll, 3000);
    };

    const source = new EventSource('/api/stream');
    source.onopen = () => {
      if (stopped || polling) return;
      setConnection('live');
      // Recover alerts written during the initial connection or a reconnect gap.
      void catchUp().catch(() => {
        if (!stopped) setConnection('reconnecting');
      });
    };
    source.addEventListener('ready', () => {
      void catchUp().catch(() => { if (!stopped) setConnection('reconnecting'); });
    });
    source.addEventListener('alert', (event) => {
      errors = 0;
      try {
        accept(JSON.parse((event as MessageEvent).data));
      } catch {
        /* Ignore malformed events. */
      }
    });
    source.onerror = () => {
      if (stopped || polling) return;
      setConnection('reconnecting');
      if (++errors >= 2) {
        polling = true;
        source.close();
        void poll();
      }
    };
    return () => {
      stopped = true;
      source.close();
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  return { alerts, connection };
}
