# Monthly storage and Agent evidence contract

Scope: Git-backed monthly source storage, D1 search acceleration, immutable
article/wiki revisions and complete MCP retrieval. Existing browser payloads
and Chat search remain compatible. No reconstruction of missing evidence.

## Storage and ownership

`index/master-index.json` becomes a small schema-3 manifest, not an article
array. `index/objects/<month>/<sha256>.json` holds complete records in bounded
shards. Immutable snapshots retain old manifests and objects. All Python
consumers use `load_index` / `save_index`. Missing/corrupt shards fail closed.
The initial migration preserves original fields, including filtered records.

Each record has `_lineage`: article ID, content hash/revision, prior revision,
observed timestamp, source URL, published date, retrieval timestamp (unknown
for legacy records), content kind and verification status. Hashes identify
saved content, not truth. Original IDs never depend on month or title.
Writer updates require the supplied prior revision to match current data.
Normal saves cannot omit existing IDs: withdrawals use filter revisions, not
implicit deletion. All Actions writers share one concurrency group; local
operators must also serialize writes (the filesystem check is not a database lock).

Agent publication is an explicit visible-record projection using the same
visibility/dedup policy as the existing browser builder, with full saved
fields rather than 200-character summaries. Excluded records remain in the
backend and are not newly exposed. Published snapshots contain immutable
shards and ID lookup buckets. A source reference is
`{snapshot_id, article_id, revision_id}`. Reading a historical reference
requires its snapshot; a revision mismatch is an error, never latest fallback.

The current snapshot is mirrored into a D1 FTS5 trigram index for search only.
Monthly immutable files remain the source of truth: every D1 result is resolved
through the snapshot catalog and its revision is checked against the saved
record before it is returned. A snapshot mismatch fails closed. After Pages is
verified, the workflow applies a bounded, idempotent delta under an exact
from/to snapshot precondition and checks the D1 row count. More than 400
changes stops the workflow for a reviewed full reindex rather than silently
publishing a partial index. This avoids both a full-history Git search object
and a full JSON scan inside the Worker CPU budget.

## MCP contracts

- `list_knowledge`: snapshot, coverage, months, file counts and freshness.
- `list_articles`: date range, optional legacy days, category, region, limit
  and opaque cursor. `next_cursor` means more enumeration remains; clients must
  continue until `complete=true` when they need every article in the range.
- `search_articles`: query plus the same scope filters, but no cursor. D1
  searches the complete current visible set in one tool call, then the server
  resolves the top results from immutable monthly files and returns a
  deterministic global relevance ranking (up to 20 previews).
  `complete=true` certifies that the selected scope was scanned, while
  `total_matches` and `result_truncated` distinguish complete coverage from a
  top-N response limited by `limit`.
  D1 `coverage.indexed_records` is the snapshot's indexed corpus size, NOT a
  billable scan count. `scanned_records` is null when the engine does not report
  article-level scan counts, or zero on an in-memory candidate-cache hit.
  Structured logs report actual D1 `rows_read` / `rows_written` separately;
  unavailable metrics remain null, never a fabricated corpus-size estimate.
- `get_article`: article ID and optional snapshot/revision; full saved record.
  Long content is returned as bounded text segments with explicit offsets.
- `get_wiki`: enumerate period pages or read one immutable page, including
  full Markdown in bounded segments, evidence references, generation
  coverage, stale/unknown status and verification state.

Errors include INVALID_ARGUMENT, INVALID_CURSOR, DATA_UNAVAILABLE,
INTEGRITY_ERROR, NOT_FOUND and REVISION_MISMATCH. Failed reads never become
empty success. Trace IDs, snapshot and coverage are logged without raw text.
Authorization stays at the existing MCP boundary. Rebuild/write tools are not
exposed to read-only agents.

## Wiki lifecycle

New monthly generations record exactly the selected article revisions and
prompt evidence (including truncation), model, prompt version and reason.
Numbered evidence markers map to immutable source references. This proves
traceability, not claim support. Legacy pages have unknown provenance; URL
matches must not be presented as historical generation evidence. Existing
Wiki pages remain derived and unverified. Changed/missing evidence marks a
page stale; changed candidate groups also trigger regeneration eligibility.
Failed regeneration preserves the previous page and reports failure.
Paragraph hashes identify exact quoted text, not a full semantic chunk-editing
engine. This change does not retrofit report-generation pipelines with verified
claim support, regenerate legacy Wiki pages, or build an automatic Wiki graph.

## Acceptance and boundaries

Synthetic fixtures are test-only. Migration evidence uses the frozen real
repository snapshot and reports exact comparisons.

1. Empty corpus remains valid.
2. Duplicate/empty IDs are rejected.
3. Invalid dates go into an explicit unknown bucket, not a fabricated date.
4. Oversized months split further; oversized individual records fail.
5. Missing/corrupt shard never returns an empty corpus.
6. Partial write does not change current manifest.
7. Repeated migration/save is idempotent.
8. Cross-month correction preserves ID and old snapshot readability.
9. Stale concurrent edits are rejected.
10. Filtered records survive migration but are not publicly exposed.
11. Article enumeration crosses shards and is resumable without duplicates.
12. List cursors bind date range and snapshot; tampering is rejected.
13. Exact old revisions resolve after later edits.
14. Wiki source changes mark stale; old citations remain resolvable.
15. Full saved summaries are available; source full text is never implied.
16. Browser monthly JSON, manifest, stats and legacy Chat JSON match baseline.
17. Every staged file and deployed artifact respects its size budget.
18. D1 snapshot ID and count exactly equal the current visible publication;
    any missing, partial or stale index fails closed.
19. Search performs global score/date ordering over the current snapshot,
    including old-history hits, and rechecks every returned revision in Git.

## Release and recovery

Run migration in an isolated checkout after small heterogeneous samples pass.
Deploy MCP code and the D1 schema before publishing a manifest that requires
them. The app receives source data during its existing Pages deployment; D1 is
advanced only after both production aliases serve that exact snapshot.
Do not push or deploy without the user's release authorization. Retain old
snapshots; no automatic garbage collection in this change. Restore a prior
manifest for storage rollback; deploy prior code/data together for rollback.
Repository total growth and snapshot retention require later operational
review, but no single all-history article array remains on the write path.
The gate stops at 50 MiB per staged Git blob, 20 MiB per public asset and
15,000 public files, with the existing workflow failure alert. This is an early
capacity gate, not unlimited retention. Immutable snapshots consume extra storage;
review retention/storage before these budgets are approached. Never remove old
citation targets to make a failing build pass. Browser monthly files retain their
existing layout; their size is checked, not silently repartitioned by this patch.

Compatibility change for custom MCP clients: `search_articles` 0.5.1 no longer
accepts or emits a continuation cursor; restart old partial searches with the
original query and scope, and request at most 20 previews. `list_articles` still requires `next_cursor`, and
`get_wiki`/`get_article` still require `next_offset` for long content. Pin
snapshots when resolving citations. Web UI and Chat search contracts do not
change. This is exhaustive lexical/alias retrieval, not vector RAG; Wiki remains
a navigation/derived-evidence layer and is not used to claim source coverage.

## 2026-09-12 quota repair (local validation; production validation pending)

The query in 738e3bb evaluated LIKE inside scoring expressions and repeated
that work for count and top-N. The repair preserves literal substring OR,
alias expansions, exact totals and score/date/UID ordering. If every term
and alias contains at least three Unicode characters, FTS MATCH supplies a
candidate set, followed by exact literal scoring. If ANY term or alias is
shorter, the source table is scanned once without joining FTS. Do not silently
discard short terms (including `17` in `IFRS 17`) or change OR to AND.
Count and top-N consume one materialized scored set; LIMIT alone is not a
scan budget. This fixes duplicate work but does not make broad searches free.

Successful public-snapshot candidate IDs/counts are cached in Worker memory
for five minutes, at most 64 entries. Concurrent identical requests share one
query. Keys include the snapshot, SQL, all filters and limit. Results still
resolve and validate their immutable source revisions on every request.
Cache eviction/cold isolates can miss; no persistent result-cache writes or
availability guarantee is implied. Metadata and matches are read in one D1
batch so they cannot straddle two committed index versions.

A confirmed D1 daily-quota error opens an Agent-only KV circuit until midnight
UTC. Search and sync check it before new D1 calls. A cached exact-snapshot
result can still be served; otherwise return D1_QUOTA_EXCEEDED, never empty
success or an untested full-JSON fallback. KV propagation is eventual, so this
is repeated-failure suppression, not an account-wide hard budget. Existing
Report authorization/storage paths are unchanged and still share account quota.
Sync returns HTTP 503 with retry_at and Retry-After; existing workflow failure
notifications remain active. Quota, auth, precondition and verification errors
stop retries. Transient errors keep at most three attempts, honoring Retry-After;
a cooldown over 60 seconds stops the process instead of retrying early.

Failed workflows retain the public-data-only delta as an artifact for 14 days.
It contains no authentication token. After the reset, recover the failed delta
in snapshot order using the existing authenticated sync command; do not rerun
the crawler as a substitute, clear the index, or rebuild it. A successfully
applied delta is an idempotent replay; a 409 requires reconciling the actual
indexed snapshot before replaying later deltas. Automatic multi-snapshot
catch-up and serving an older Agent publication are NOT implemented here.
The existing mismatch gate remains fail-closed; preserved artifacts prevent
losing the recovery input when a GitHub runner exits.

No schema migration, full import, production query or quota-reset operation
is required for these source edits. Before approving production availability,
measure actual D1 rows_read/rows_written, cold Worker CPU and concurrent cache
misses with the intended daily request volume. Short-term scans remain a known
budget risk. Do not advertise permanent free-tier availability on these tests.

Local acceptance runs actual SQLite/FTS5 SQL (not canned D1 results): literal
short/long/Unicode terms, mixed terms, aliases, wildcard literals, dates and
filters, no matches/empty corpus, deterministic top-N and totals, input binding
limits, query plans, duplicate-cache requests, changed scope, failed/corrupt
source reads, quota suppression/reset, permanent vs transient retry, and
idempotent sync replay. The optional real-publication test compares six queries
against an independent full-corpus literal oracle and traverses all saved IDs.
Local SQLite metrics are not Cloudflare billable usage or Worker CPU evidence.
