-- research-pipeline-ba-spec §8: b-side state machine for a-side (engine) handoff.
-- One row per research session submitted to the backend pipeline.
CREATE TABLE IF NOT EXISTS research_jobs (
  session_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  email TEXT,
  task_type TEXT NOT NULL DEFAULT 'insurance_research',
  status TEXT NOT NULL DEFAULT 'ready',
  -- ready → pending_sync → submitted → running → completed | failed
  engine_job_id TEXT,
  report_id TEXT,
  contract_json TEXT NOT NULL,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_jobs_uid ON research_jobs (uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_jobs_engine ON research_jobs (engine_job_id);
