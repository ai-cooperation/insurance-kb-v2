/**
 * Reports + Topics data hooks — list / detail / topic tree fetch via Workers API.
 *
 * Auth: relies on apiFetch() from useAuth — that wires Firebase ID token into
 * the Authorization header. Worker gates by view_reports feature.
 */

import { useEffect, useState } from 'react';
import type { ReportMeta, ReportDetail, TopicMeta } from './types';

interface ApiFetch {
  (path: string, init?: RequestInit): Promise<Response>;
}

/**
 * useReportsTree — load all topics + all reports in one go, group reports
 * under their topic. Used by the sidebar tree in Reports page.
 */
export function useReportsTree(apiFetch: ApiFetch, hasFeature: (k: string) => boolean) {
  const canView = hasFeature('view_reports');
  const [topics, setTopics] = useState<TopicMeta[]>([]);
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) {
      setTopics([]);
      setReports([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch('/api/topics').then(r => parseJson<{ topics: TopicMeta[] }>(r)),
      apiFetch('/api/reports?by_topic=1&limit=200').then(r => parseJson<{ reports: ReportMeta[] }>(r)),
    ])
      .then(([tRes, rRes]) => {
        if (cancelled) return;
        setTopics(tRes.topics);
        setReports(rRes.reports);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load reports tree');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canView, apiFetch]);

  return { topics, reports, loading, error, canView };
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
      .then(r => parseJson<ReportDetail>(r))
      .then(data => {
        if (cancelled) return;
        setDetail(data);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load report');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, apiFetch]);

  return { detail, loading, error };
}

async function parseJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}
