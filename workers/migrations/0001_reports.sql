-- Insurance KB v3 — Reports table.
-- D1 binding: REPORTS_DB
--
-- Apply: wrangler d1 execute insurance-kb-reports --file=./migrations/0001_reports.sql

CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,           -- e.g. "rpt_2026-05-05_abc123"
  title           TEXT NOT NULL,
  author_uid      TEXT NOT NULL,              -- Firebase UID
  author_name     TEXT,
  author_email    TEXT,
  tags            TEXT,                        -- JSON array, e.g. ["訂閱式", "東南亞"]
  status          TEXT NOT NULL DEFAULT 'published',  -- 'draft' | 'published' | 'archived'
  source_session_id TEXT,                      -- KV research_session id (NULL if 後台手動上架)
  region          TEXT,                        -- e.g. "TW" / "SEA" / "GLOBAL"
  category        TEXT,                        -- e.g. "商品分析" / "市場觀察"
  summary         TEXT,                        -- short summary for list view
  word_count      INTEGER DEFAULT 0,
  finding_count   INTEGER DEFAULT 0,
  view_count      INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,            -- unix seconds
  updated_at      INTEGER NOT NULL,
  -- R2 path: reports/{id}.md (content stored separately to keep D1 lean)
  r2_path         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created   ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_author    ON reports(author_uid);
CREATE INDEX IF NOT EXISTS idx_reports_category  ON reports(category);
CREATE INDEX IF NOT EXISTS idx_reports_status    ON reports(status);

-- Audit log: every create / update / delete leaves a trace
CREATE TABLE IF NOT EXISTS reports_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT NOT NULL,
  action          TEXT NOT NULL,               -- 'create' | 'update' | 'delete' | 'restore'
  actor_uid       TEXT NOT NULL,
  actor_email     TEXT,
  diff_summary    TEXT,                        -- e.g. "title changed; +3 findings"
  created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_report ON reports_audit(report_id, created_at DESC);
