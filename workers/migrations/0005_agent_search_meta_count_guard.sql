-- Keep the published D1 snapshot marker in lockstep with the row count.
-- A mismatch aborts the surrounding D1 batch so row changes roll back too.
CREATE TRIGGER IF NOT EXISTS agent_search_meta_insert_count_guard
BEFORE INSERT ON agent_search_meta
WHEN NEW.total_records != (SELECT COUNT(*) FROM agent_search_articles)
BEGIN
  SELECT RAISE(ABORT, 'agent_search_meta record count mismatch');
END;

CREATE TRIGGER IF NOT EXISTS agent_search_meta_update_count_guard
BEFORE UPDATE OF total_records ON agent_search_meta
WHEN NEW.total_records != (SELECT COUNT(*) FROM agent_search_articles)
BEGIN
  SELECT RAISE(ABORT, 'agent_search_meta record count mismatch');
END;
