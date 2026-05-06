-- Insurance KB v3 — Report topics (wiki-tree grouping).
--
-- Each topic groups related reports (e.g. "亞洲保險公司行銷策略研究 V1" with
-- its main report + N chapter attachments). Frontend renders these as a
-- collapsible sidebar tree (matching hematology-kb's 疾病全貌 pattern).
--
-- Apply: wrangler d1 execute insurance-kb-reports --remote --file=./migrations/0002_report_topics.sql

CREATE TABLE IF NOT EXISTS report_topics (
  id          TEXT PRIMARY KEY,           -- e.g. "topic_v1_marketing"
  title       TEXT NOT NULL,              -- "V1 — 亞洲主要保險公司行銷策略研究"
  summary     TEXT,                        -- one-paragraph description shown above content
  icon        TEXT,                        -- icon name (Icon.tsx); defaults to "book"
  sort_order  INTEGER NOT NULL DEFAULT 0,  -- display order in sidebar tree
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Add topic_id + sort_order to reports.
-- topic_id is NULLable so MCP-created reports can land orphaned then be sorted later.
-- sort_order: main reports get 0 (always top), chapters get 10/20/30/...
ALTER TABLE reports ADD COLUMN topic_id    TEXT;
ALTER TABLE reports ADD COLUMN sort_order  INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_reports_topic ON reports(topic_id, sort_order);
