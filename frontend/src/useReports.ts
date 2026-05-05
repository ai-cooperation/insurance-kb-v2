/**
 * Reports data hooks — list + detail fetch via Workers API.
 *
 * Auth: relies on apiFetch() from useAuth — that wires Firebase ID token
 * into the Authorization header. Worker gates by view_reports feature.
 */

import { useEffect, useState } from 'react';
import type { ReportMeta, ReportDetail } from './types';

interface ApiFetch {
  (path: string, init?: RequestInit): Promise<Response>;
}

export function useReportsList(apiFetch: ApiFetch, hasFeature: (k: string) => boolean) {
  const canView = hasFeature('view_reports');
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setReports([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch('/api/reports?limit=50')
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error || `HTTP ${resp.status}`);
        }
        return resp.json() as Promise<{ reports: ReportMeta[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setReports(data.reports);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load reports');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canView, apiFetch]);

  return { reports, loading, error, canView };
}

export function useReportDetail(apiFetch: ApiFetch, id: string | null) {
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiFetch(`/api/reports/${encodeURIComponent(id)}`)
      .then(async (resp) => {
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error || `HTTP ${resp.status}`);
        }
        return resp.json() as Promise<ReportDetail>;
      })
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load report');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, apiFetch]);

  return { detail, loading, error };
}
