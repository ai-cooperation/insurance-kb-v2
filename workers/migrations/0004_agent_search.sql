-- Current Agent search accelerator. Immutable monthly JSON remains the source
-- of truth; this table is rebuilt/synchronized only from a verified snapshot.
CREATE TABLE IF NOT EXISTS agent_search_articles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  uid         TEXT NOT NULL UNIQUE,
  revision_id TEXT NOT NULL,
  date        TEXT NOT NULL,
  title       TEXT NOT NULL,
  title_en    TEXT NOT NULL,
  category    TEXT NOT NULL,
  region      TEXT NOT NULL,
  summary     TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS agent_search_fts USING fts5(
  title, title_en, category, summary,
  content='agent_search_articles', content_rowid='id',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS agent_search_ai AFTER INSERT ON agent_search_articles BEGIN
  INSERT INTO agent_search_fts(rowid,title,title_en,category,summary)
  VALUES (new.id,new.title,new.title_en,new.category,new.summary);
END;
CREATE TRIGGER IF NOT EXISTS agent_search_ad AFTER DELETE ON agent_search_articles BEGIN
  INSERT INTO agent_search_fts(agent_search_fts,rowid,title,title_en,category,summary)
  VALUES ('delete',old.id,old.title,old.title_en,old.category,old.summary);
END;
CREATE TRIGGER IF NOT EXISTS agent_search_au AFTER UPDATE ON agent_search_articles BEGIN
  INSERT INTO agent_search_fts(agent_search_fts,rowid,title,title_en,category,summary)
  VALUES ('delete',old.id,old.title,old.title_en,old.category,old.summary);
  INSERT INTO agent_search_fts(rowid,title,title_en,category,summary)
  VALUES (new.id,new.title,new.title_en,new.category,new.summary);
END;

CREATE TABLE IF NOT EXISTS agent_search_meta (
  singleton       INTEGER PRIMARY KEY CHECK(singleton = 1),
  snapshot_id     TEXT NOT NULL,
  total_records   INTEGER NOT NULL,
  indexed_at      INTEGER NOT NULL
);
