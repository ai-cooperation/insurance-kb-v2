# Monthly storage and Agent evidence contract

Scope: Git-backed monthly storage, immutable article/wiki revisions, complete
MCP retrieval. Existing browser payloads and Chat search remain compatible.
No D1/R2/Queues migration, no reconstruction of missing historical evidence.

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

## MCP contracts

- `list_knowledge`: snapshot, coverage, months, file counts and freshness.
- `list_articles` / `search_articles`: date range, optional legacy days,
  category, region, limit and opaque cursor. Search walks all selected shards;
  per-call scanning is bounded. `next_cursor` means more scanning/results.
  `complete` is true only after all selected shards have been read. Results
  are deterministic within one immutable snapshot; no global top-k claim.
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
11. Pagination crosses empty/no-match shards and is resumable.
12. Cursor binds query, date range and snapshot; tampering is rejected.
13. Exact old revisions resolve after later edits.
14. Wiki source changes mark stale; old citations remain resolvable.
15. Full saved summaries are available; source full text is never implied.
16. Browser monthly JSON, manifest, stats and legacy Chat JSON match baseline.
17. Every staged file and deployed artifact respects its size budget.

## Release and recovery

Run migration in an isolated checkout after small heterogeneous samples pass.
Publish new data before deploying MCP code that requires it. The app receives
new data during its existing Pages deployment; no extra infrastructure.
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

Compatibility change for custom MCP clients: list/search return paged matches,
not a global top-k; get_wiki returns a page catalog then paged JSON text. Clients
must follow next_cursor/next_offset and pin snapshots. Tool descriptions and MCP
initialization carry these rules. Web UI and Chat search contracts do not change.
