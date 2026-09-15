/** Complete Agent retrieval over immutable monthly data. Chat stays separate.
 * Search proves scope coverage server-side; list pagination still requires its
 * next_cursor. Failed reads throw; never turn missing data into empty success.
 */
import { scoreNormalizedArticle, searchArticles, searchTermGroups, type Article } from "./search";
import {buildSearchQuery} from './agent-search-query';
import {cachedSearch,withD1QuotaGuard} from './agent-d1-guard';

type Args = Record<string, unknown>;
type Ref = { file: string; sha256: string; month?: string; count?: number; revision_id?: string; period?: string;
  from_month?: string | null; to_month?: string | null; has_unknown_dates?: boolean };
type Manifest = { schema_version: number; kind: string; snapshot_id: string; shards: Ref[];
  catalogs: Record<string, Ref>; months: Record<string, number>; total_records: number;
  newest_date?: string; pages: Record<string, Ref>; search_backend?: string; search_format?: string;
  search_shards?: Ref[]; search_records?: number };
type Row = Article & { uid: string; _lineage: { revision_id: string; content_kind?: string; verification_status?: string } };
type SearchRow = [string,string,number,string,string,string,string,string,string];
type CursorKV = { get(key: string): Promise<string | null>; put(key: string, value: string, options?: {expirationTtl: number}): Promise<unknown> };
type State = { operation: string; snapshot_id: string; scope: Args; limit: number; shard: number; offset: number };
const BASE = "https://insurance-kb.cooperation.tw/data/agent/";
const HASH = /^[a-f0-9]{64}$/;
const MAX_SHARDS = 4;
const MAX_SEARCH_SHARDS = 40;
const COMPACT_SEARCH_SHARDS = 20;
const MAX_SEARCH_RESULTS = 20;
const SEARCH_CONCURRENCY = 5;
const MONTH = /^(\d{4}-(0[1-9]|1[0-2])|unknown)$/;

function fail(code: string, message: string): never { throw new Error(`${code}: ${message}`); }
function stringArg(args: Args, key: string, max = 300): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("INVALID_ARGUMENT", key);
  return value;
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) fail("INVALID_ARGUMENT", "integer outside allowed range");
  return value;
}
function dateArg(args: Args, key: string): string | undefined {
  const v = stringArg(args, key, 10);
  if (v !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0,10) !== v)) fail("INVALID_ARGUMENT", key);
  return v;
}
function stable(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => [k, stable(v)]));
  return x;
}
async function hash(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join("");
}

export class AgentReader {
  constructor(private kv: CursorKV, private owner: string, private fetcher: typeof fetch = fetch,
    private searchDb?: D1Database) {}

  private async json(path: string, expected?: string): Promise<any> {
    if (!/^(manifest|wiki-manifest)\.json$/.test(path) && !/^(snapshots|catalogs|objects(?:\/[a-z0-9-]+)?)\/[a-f0-9]{64}\.json$/.test(path)) fail("INTEGRITY_ERROR", "invalid publication path");
    // compatibility_date=2024-10-18 does not expose AbortSignal.timeout.
    // Keep the explicit deadline without requiring a broad runtime upgrade.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),15000);
    let response: Response;
    const fetchPublication = this.fetcher;
    try { response = await fetchPublication(BASE + path, { signal: controller.signal, headers: {"Cache-Control":"no-cache"} }); }
    catch (error) {
      console.error(JSON.stringify({event:"agent_publication_fetch_failed",path,
        reason:error instanceof Error?error.name:typeof error}));
      return fail("DATA_UNAVAILABLE", path);
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      console.error(JSON.stringify({event:"agent_publication_fetch_failed",path,status:response.status}));
      fail("DATA_UNAVAILABLE", `${path} HTTP ${response.status}`);
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) fail("INTEGRITY_ERROR", "publication object exceeds budget");
    if (expected && await hash(text) !== expected) fail("INTEGRITY_ERROR", `checksum ${path}`);
    try { return JSON.parse(text); } catch { return fail("INTEGRITY_ERROR", `JSON ${path}`); }
  }

  private async manifest(snapshot: unknown, kind = "agent_articles"): Promise<Manifest> {
    if (snapshot !== undefined && (typeof snapshot !== "string" || !HASH.test(snapshot))) fail("INVALID_ARGUMENT", "snapshot_id");
    const path = snapshot ? `snapshots/${snapshot}.json` : kind === "agent_wikis" ? "wiki-manifest.json" : "manifest.json";
    const m = await this.json(path);
    if (!m || m.schema_version !== 3 || m.kind !== kind || !HASH.test(m.snapshot_id ?? "")) fail("INTEGRITY_ERROR", "manifest schema/kind");
    const {snapshot_id, ...body} = m;
    if (await hash(JSON.stringify(stable(body))) !== snapshot_id || (snapshot && snapshot !== snapshot_id)) fail("INTEGRITY_ERROR", "snapshot checksum");
    if (kind === "agent_articles" && (!Array.isArray(m.shards) || !m.catalogs || !m.months)) fail("INTEGRITY_ERROR", "article manifest");
    if (kind === "agent_articles") {
      const counts: Record<string, number> = {}, paths = new Set<string>();
      for (const s of m.shards) {
        if (!s || !MONTH.test(s.month ?? "") || !HASH.test(s.sha256 ?? "")
            || typeof s.file !== "string" || !Number.isSafeInteger(s.count) || s.count <= 0 || paths.has(s.file))
          fail("INTEGRITY_ERROR", "shard descriptor");
        paths.add(s.file); counts[s.month] = (counts[s.month] ?? 0) + s.count;
      }
      if (!Number.isSafeInteger(m.total_records) || m.total_records < 0
          || Object.values(counts).reduce((a,b)=>a+b,0) !== m.total_records
          || JSON.stringify(stable(counts)) !== JSON.stringify(stable(m.months)))
        fail("INTEGRITY_ERROR", "manifest coverage totals");
      if (m.search_backend !== undefined
          && (m.search_backend !== "d1-v1" || m.search_records !== m.total_records))
        fail("INTEGRITY_ERROR", "search backend totals");
      if (m.search_shards !== undefined) {
        const shardLimit = m.search_format === "compact-v2" ? COMPACT_SEARCH_SHARDS : MAX_SEARCH_SHARDS;
        if (!Array.isArray(m.search_shards) || m.search_shards.length > shardLimit
            || m.search_records !== m.total_records)
          fail("INTEGRITY_ERROR", "search coverage totals");
        let searchRecords = 0;
        const searchPaths = new Set<string>();
        for (const s of m.search_shards) {
          const from = s?.from_month, to = s?.to_month;
          const validRange = (from === null && to === null && s?.has_unknown_dates === true)
            || (typeof from === "string" && typeof to === "string" && MONTH.test(from) && MONTH.test(to)
              && from !== "unknown" && to !== "unknown" && from <= to);
          if (!s || !HASH.test(s.sha256 ?? "") || typeof s.file !== "string"
              || !Number.isSafeInteger(s.count) || s.count! <= 0 || searchPaths.has(s.file) || !validRange)
            fail("INTEGRITY_ERROR", "search shard descriptor");
          searchPaths.add(s.file); searchRecords += s.count!;
        }
        if (searchRecords !== m.total_records) fail("INTEGRITY_ERROR", "search coverage totals");
      }
    }
    if (kind === "agent_wikis" && (!m.pages || typeof m.pages !== "object")) fail("INTEGRITY_ERROR", "wiki manifest");
    return m;
  }

  async catalog(args: Args = {}) {
    const m = await this.manifest(args.snapshot_id);
    return { snapshot_id: m.snapshot_id, total_records: m.total_records, months: m.months,
      newest_date: m.newest_date, content_scope: "full_saved_record_not_source_fulltext",
      date_semantics: "published dates from sources, not collection start date; legacy dates unverified",
      scope: "browser-visible records; filtered and duplicate records remain in backend",
      tools: ["list_articles", "search_articles", "get_article", "get_wiki"],
      search_mode: m.search_backend === "d1-v1" ? "d1_complete_global_ranking"
        : m.search_shards ? "server_complete_global_ranking" : "unavailable_for_this_snapshot",
      instructions: "Search scans its selected scope server-side. Only list_articles needs next_cursor. Cite snapshot_id+article_id+revision_id." };
  }

  private async state(args: Args, operation: string): Promise<State> {
    if (args.cursor !== undefined) {
      if (typeof args.cursor !== "string" || !/^[a-f0-9]{32}$/.test(args.cursor)) fail("INVALID_CURSOR", "invalid or expired cursor");
      const raw = await this.kv.get(`agent_cursor:${this.owner}:${args.cursor}`);
      if (!raw) fail("INVALID_CURSOR", "expired; restart from explicit snapshot_id");
      let s: State;
      try { s = JSON.parse(raw); } catch { return fail("INVALID_CURSOR", "malformed state"); }
      if (s.operation !== operation) fail("INVALID_CURSOR", "operation mismatch");
      for (const [k,v] of Object.entries(args)) {
        if (k === "cursor") continue;
        const expected = k === "limit" ? s.limit : k === "snapshot_id" ? s.snapshot_id : s.scope[k];
        if (v !== expected) fail("INVALID_CURSOR", `scope mismatch: ${k}`);
      }
      return s;
    }
    let date_from = dateArg(args,"date_from"), date_to = dateArg(args,"date_to");
    if (args.all_history !== undefined && typeof args.all_history !== "boolean") fail("INVALID_ARGUMENT", "all_history");
    if (args.days !== undefined && (date_from || date_to || args.all_history)) fail("INVALID_ARGUMENT", "days conflicts with date range/all_history");
    if (args.all_history && (date_from || date_to)) fail("INVALID_ARGUMENT", "all_history conflicts with date range");
    const days = args.days === undefined ? undefined : integer(args.days,30,1,36500);
    if (days !== undefined || (operation === "list" && !args.all_history && !date_from && !date_to)) {
      const now = new Date(); date_to = now.toISOString().slice(0,10);
      date_from = new Date(now.getTime() - (days ?? 30)*86400000).toISOString().slice(0,10);
    }
    if (date_from && date_to && date_from > date_to) fail("INVALID_ARGUMENT", "reversed date range");
    const query = stringArg(args,"query");
    if (operation === "search" && !query) fail("INVALID_ARGUMENT", "query is required on first search");
    if (operation === "search" && query!.trim().split(/\s+/).length > 8)
      fail("INVALID_ARGUMENT", "query has more than 8 terms");
    const scope = Object.fromEntries(Object.entries({date_from,date_to,query,
      category:stringArg(args,"category"),region:stringArg(args,"region"),all_history:args.all_history,days:args.days}).filter(([,v])=>v !== undefined));
    const m = await this.manifest(args.snapshot_id);
    const defaultLimit = operation === "search" ? MAX_SEARCH_RESULTS : 30;
    const maxLimit = operation === "search" ? MAX_SEARCH_RESULTS : 100;
    return {operation,snapshot_id:m.snapshot_id,scope,limit:integer(args.limit,defaultLimit,1,maxLimit),shard:0,offset:0};
  }

  async list(args: Args = {}) { return this.scan(args); }
  async search(args: Args = {}) { return this.completeSearch(args); }

  private preview(r: Row, snapshot_id: string, score?: number) {
    return {uid:r.uid,title:r.title,title_en:r.title_en,date:r.date,source:r.source,
      source_url:r.source_url,category:r.category,region:r.region,summary:r.summary?.slice(0,200),
      preview_only:true,score,content_kind:r._lineage.content_kind,verification_status:r._lineage.verification_status,
      citation:{article_id:r.uid,revision_id:r._lineage.revision_id,snapshot_id}};
  }

  private async completeSearch(args: Args) {
    if (args.cursor !== undefined) fail("INVALID_CURSOR", "search is server-complete; restart with query and optional scope");
    const s = await this.state(args,"search");
    const m = await this.manifest(s.snapshot_id);
    if (m.search_backend === "d1-v1") return this.d1Search(s,m);
    if (!m.search_shards) fail("DATA_UNAVAILABLE", "complete search index is unavailable for this snapshot");
    const from = s.scope.date_from as string | undefined, to = s.scope.date_to as string | undefined;
    const fromMonth = from?.slice(0,7), toMonth = to?.slice(0,7);
    const selected = m.search_shards.filter(x =>
      (!fromMonth || (x.to_month !== null && x.to_month !== undefined && x.to_month >= fromMonth))
      && (!toMonth || (x.from_month !== null && x.from_month !== undefined && x.from_month <= toMonth)));
    if (m.search_format === "compact-v2")
      return this.compactSearch(s,m,selected,from,to,fromMonth,toMonth);
    let scanned = 0, totalMatches = 0;
    let best: Array<{article: Row; score: number}> = [];
    for (let start = 0; start < selected.length; start += SEARCH_CONCURRENCY) {
      const batch = selected.slice(start,start+SEARCH_CONCURRENCY);
      const loaded = await Promise.all(batch.map(part => this.json(part.file,part.sha256)));
      for (let index = 0; index < loaded.length; index++) {
        const rows = loaded[index], part = batch[index];
        if (!Array.isArray(rows) || rows.length !== part.count
            || rows.some(r => !r?.uid || !HASH.test(r?._lineage?.revision_id ?? "")))
          fail("INTEGRITY_ERROR", "search shard shape");
        scanned += rows.length;
        const candidates: Row[] = rows.filter((r: Row) => {
          if ((from && r.date < from) || (to && r.date > to)) return false;
          if (s.scope.category && !(r.category ?? "").toLowerCase().includes(String(s.scope.category).toLowerCase())) return false;
          if (s.scope.region && !(r.region ?? "").toLowerCase().includes(String(s.scope.region).toLowerCase())) return false;
          return true;
        });
        const matches = searchArticles(candidates,String(s.scope.query),candidates.length) as Array<{article: Row; score: number}>;
        totalMatches += matches.length;
        best = [...best,...matches].sort((a,b) => b.score-a.score
          || (b.article.date ?? "").localeCompare(a.article.date ?? "")
          || a.article.uid.localeCompare(b.article.uid)).slice(0,s.limit);
      }
    }
    const trace_id = crypto.randomUUID();
    const months = Object.keys(m.months).filter(month => month !== "unknown"
      && (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth)).sort().reverse();
    const coverage = {selected_shards:selected.length,completed_shards:selected.length,remaining_shards:0,
      scanned_records:scanned,months,excluded_unknown_date_records:(from||to)?(m.months.unknown??0):0};
    console.info(JSON.stringify({event:"agent_retrieval",trace_id,operation:"search",snapshot_id:m.snapshot_id,
      complete:true,count:best.length,total_matches:totalMatches,coverage}));
    return {snapshot_id:m.snapshot_id,trace_id,scope:s.scope,count:best.length,total_matches:totalMatches,
      results:best.map(x=>this.preview(x.article,m.snapshot_id,x.score)),complete:true,next_cursor:null,coverage,
      result_truncated:totalMatches>best.length,ordering:"global_relevance_score_then_date_desc_within_snapshot",
      warning:totalMatches>best.length?`Complete scope scan found ${totalMatches} matches; returning top ${best.length}.`:null};
  }

  private async resolveSearchRows(m: Manifest,
    candidates: Array<{uid:string;revision:string;date:string;score:number}>): Promise<Map<string,Row>> {
    const byCatalog = new Map<string,string[]>();
    for (const candidate of candidates) {
      const prefix = Object.keys(m.catalogs).filter(p=>candidate.uid.startsWith(p)).sort((a,b)=>b.length-a.length)[0];
      if (!prefix) fail("INTEGRITY_ERROR", "search result has no catalog bucket");
      if (!byCatalog.has(prefix)) byCatalog.set(prefix,[]);
      byCatalog.get(prefix)!.push(candidate.uid);
    }
    const articleRefs = new Map<string,Ref>();
    const catalogs = [...byCatalog.entries()];
    for (let start=0; start<catalogs.length; start+=SEARCH_CONCURRENCY) {
      const batch=catalogs.slice(start,start+SEARCH_CONCURRENCY);
      const loaded=await Promise.all(batch.map(([prefix])=>this.json(m.catalogs[prefix].file,m.catalogs[prefix].sha256)));
      for(let i=0;i<batch.length;i++) for(const uid of batch[i][1]) {
        const ref=loaded[i]?.[uid]; if(!ref) fail("INTEGRITY_ERROR", "search catalog lookup");
        articleRefs.set(uid,ref);
      }
    }
    const byFile = new Map<string,{ref:Ref;uids:Set<string>}>();
    for (const [uid,ref] of articleRefs) {
      if (!byFile.has(ref.file)) byFile.set(ref.file,{ref,uids:new Set()});
      byFile.get(ref.file)!.uids.add(uid);
    }
    const full = new Map<string,Row>(), files=[...byFile.values()];
    for(let start=0;start<files.length;start+=SEARCH_CONCURRENCY) {
      const batch=files.slice(start,start+SEARCH_CONCURRENCY);
      const loaded=await Promise.all(batch.map(x=>this.json(x.ref.file,x.ref.sha256)));
      for(let i=0;i<batch.length;i++) {
        if(!Array.isArray(loaded[i])) fail("INTEGRITY_ERROR", "article shard after D1 search");
        for(const row of loaded[i] as Row[]) if(batch[i].uids.has(row.uid)) full.set(row.uid,row);
      }
    }
    for(const candidate of candidates) {
      const row=full.get(candidate.uid), ref=articleRefs.get(candidate.uid);
      if(!row?._lineage || row._lineage.revision_id!==candidate.revision
          || ref?.revision_id!==candidate.revision)
        fail("INTEGRITY_ERROR", "D1 result revision differs from monthly source");
    }
    return full;
  }

  private async d1Search(s: State, m: Manifest) {
    if (!this.searchDb) fail("DATA_UNAVAILABLE", "D1 search binding is unavailable");
    const from=s.scope.date_from as string|undefined,to=s.scope.date_to as string|undefined;
    const query=buildSearchQuery({query:String(s.scope.query),date_from:from,date_to:to,
      category:s.scope.category as string|undefined,region:s.scope.region as string|undefined},s.limit);
    const db=this.searchDb;
    const key=JSON.stringify(['agent-query-v2',m.snapshot_id,m.total_records,query.sql,query.params]);
    const cached=await cachedSearch(key,()=>withD1QuotaGuard(this.kv,async()=>{
      // One D1 batch gives metadata + matches the same transaction snapshot.
      // Never cache a partially indexed publication or accept total_records alone
      // as evidence that its actual SQL matches are correct.
      const [metadata,result]=await db.batch([
        db.prepare('SELECT snapshot_id,total_records FROM agent_search_meta WHERE singleton=1'),
        db.prepare(query.sql).bind(...query.params),
      ]);
      const meta=metadata.results?.[0] as {snapshot_id:string;total_records:number}|undefined;
      if(!metadata.success || !meta || meta.snapshot_id!==m.snapshot_id || meta.total_records!==m.total_records)
        fail('DATA_UNAVAILABLE','D1 index snapshot does not match publication');
      const total=(result.results?.[0] as {total?:number}|undefined)?.total;
      if(!result.success || typeof total!=='number' || !Number.isSafeInteger(total) || total<0)
        fail('INTEGRITY_ERROR','D1 search returned no verified total');
      const candidates=(result.results??[]).filter((row:any)=>row.uid!==null).map((row:any)=>({uid:String(row.uid),revision:String(row.revision_id),
        date:String(row.date),score:Number(row.score)}));
      if(candidates.length!==Math.min(total,s.limit) || candidates.some(row=>!HASH.test(row.revision)
          || !Number.isFinite(row.score) || row.score<=0) || new Set(candidates.map(row=>row.uid)).size!==candidates.length)
        fail('INTEGRITY_ERROR','D1 search candidates differ from verified total');
      return {total,candidates,rows_read:metadata.meta?.rows_read!==undefined && result.meta?.rows_read!==undefined
        ?metadata.meta.rows_read+result.meta.rows_read:null,
        rows_written:metadata.meta?.rows_written!==undefined && result.meta?.rows_written!==undefined
          ?metadata.meta.rows_written+result.meta.rows_written:null};
    }));
    const {total,candidates}=cached.value;
    const full=await this.resolveSearchRows(m,candidates);
    const fromMonth=from?.slice(0,7),toMonth=to?.slice(0,7);
    const months=Object.keys(m.months).filter(month=>month!=="unknown"&&(!fromMonth||month>=fromMonth)&&(!toMonth||month<=toMonth)).sort().reverse();
    const trace_id=crypto.randomUUID();
    const coverage={index_backend:"d1-v1",selected_shards:1,completed_shards:1,remaining_shards:0,
      scanned_records:cached.hit?0:null,indexed_records:m.total_records,months,
      excluded_unknown_date_records:(from||to)?(m.months.unknown??0):0};
    console.info(JSON.stringify({event:"agent_retrieval",trace_id,operation:"search",snapshot_id:m.snapshot_id,
      complete:true,count:candidates.length,total_matches:total,coverage,query_mode:query.mode,
      cache_hit:cached.hit,rows_read:cached.hit?0:cached.value.rows_read,rows_written:cached.hit?0:cached.value.rows_written}));
    return {snapshot_id:m.snapshot_id,trace_id,scope:s.scope,count:candidates.length,total_matches:total,
      results:candidates.map(x=>this.preview(full.get(x.uid)!,m.snapshot_id,x.score)),complete:true,next_cursor:null,coverage,
      result_truncated:total>candidates.length,ordering:"global_relevance_score_then_date_desc_within_snapshot",
      warning:total>candidates.length?`Complete scope search found ${total} matches; returning top ${candidates.length}.`:null};
  }

  private async compactSearch(s: State, m: Manifest, selected: Ref[], from?: string, to?: string,
    fromMonth?: string, toMonth?: string) {
    const termGroups = searchTermGroups(String(s.scope.query));
    const category = String(s.scope.category ?? "").toLowerCase();
    const region = String(s.scope.region ?? "").toLowerCase();
    let scanned = 0, totalMatches = 0;
    let best: Array<{uid:string;revision:string;articleShard:number;date:string;score:number}> = [];
    for (let start = 0; start < selected.length; start += SEARCH_CONCURRENCY) {
      const batch = selected.slice(start,start+SEARCH_CONCURRENCY);
      const loaded = await Promise.all(batch.map(part => this.json(part.file,part.sha256)));
      for (let index = 0; index < loaded.length; index++) {
        const rows = loaded[index], part = batch[index];
        if (!Array.isArray(rows) || rows.length !== part.count)
          fail("INTEGRITY_ERROR", "compact search shard shape");
        scanned += rows.length;
        for (const value of rows) {
          if (!Array.isArray(value) || value.length !== 9 || typeof value[0] !== "string"
              || !HASH.test(value[1] ?? "") || !Number.isSafeInteger(value[2])
              || value[2] < 0 || value[2] >= m.shards.length
              || value.slice(3).some(field => typeof field !== "string"))
            fail("INTEGRITY_ERROR", "compact search row shape");
          const row = value as SearchRow;
          if ((from && row[3] < from) || (to && row[3] > to)
              || (category && !row[6].includes(category)) || (region && !row[7].includes(region))) continue;
          const score = scoreNormalizedArticle(row[4],row[5],row[6],row[8],termGroups);
          if (score <= 0) continue;
          totalMatches++;
          best.push({uid:row[0],revision:row[1],articleShard:row[2],date:row[3],score});
          best.sort((a,b) => b.score-a.score || b.date.localeCompare(a.date) || a.uid.localeCompare(b.uid));
          if (best.length > s.limit) best.pop();
        }
      }
    }

    const needed = new Map<number,Set<string>>();
    for (const candidate of best) {
      if (!needed.has(candidate.articleShard)) needed.set(candidate.articleShard,new Set());
      needed.get(candidate.articleShard)!.add(candidate.uid);
    }
    const full = new Map<string,Row>();
    const entries = [...needed.entries()];
    for (let start = 0; start < entries.length; start += SEARCH_CONCURRENCY) {
      const batch = entries.slice(start,start+SEARCH_CONCURRENCY);
      const loaded = await Promise.all(batch.map(([shard]) => {
        const ref = m.shards[shard]; return this.json(ref.file,ref.sha256);
      }));
      for (let index = 0; index < loaded.length; index++) {
        const [shard,wanted] = batch[index], rows = loaded[index];
        if (!Array.isArray(rows) || rows.length !== m.shards[shard].count)
          fail("INTEGRITY_ERROR", "article shard shape after search");
        for (const row of rows as Row[]) if (wanted.has(row.uid)) full.set(row.uid,row);
      }
    }
    for (const candidate of best) {
      const row = full.get(candidate.uid);
      if (!row?._lineage || row._lineage.revision_id !== candidate.revision)
        fail("INTEGRITY_ERROR", "compact search pointer/revision mismatch");
    }
    const trace_id = crypto.randomUUID();
    const months = Object.keys(m.months).filter(month => month !== "unknown"
      && (!fromMonth || month >= fromMonth) && (!toMonth || month <= toMonth)).sort().reverse();
    const coverage = {selected_shards:selected.length,completed_shards:selected.length,remaining_shards:0,
      scanned_records:scanned,months,excluded_unknown_date_records:(from||to)?(m.months.unknown??0):0};
    console.info(JSON.stringify({event:"agent_retrieval",trace_id,operation:"search",search_format:m.search_format,
      snapshot_id:m.snapshot_id,complete:true,count:best.length,total_matches:totalMatches,coverage}));
    return {snapshot_id:m.snapshot_id,trace_id,scope:s.scope,count:best.length,total_matches:totalMatches,
      results:best.map(x=>this.preview(full.get(x.uid)!,m.snapshot_id,x.score)),complete:true,next_cursor:null,coverage,
      result_truncated:totalMatches>best.length,ordering:"global_relevance_score_then_date_desc_within_snapshot",
      warning:totalMatches>best.length?`Complete scope scan found ${totalMatches} matches; returning top ${best.length}.`:null};
  }

  private async scan(args: Args) {
    const s = await this.state(args,"list");
    const m = await this.manifest(s.snapshot_id);
    const from = s.scope.date_from as string | undefined, to = s.scope.date_to as string | undefined;
    const selected = m.shards.filter(x => (!from || (x.month !== "unknown" && x.month! >= from.slice(0,7))) && (!to || (x.month !== "unknown" && x.month! <= to.slice(0,7))));
    let shard = s.shard, offset = s.offset, fetched = 0;
    const results: any[] = [];
    while (shard < selected.length && results.length < s.limit && fetched < MAX_SHARDS) {
      const part = selected[shard];
      const rows = await this.json(part.file,part.sha256);
      if (!Array.isArray(rows) || rows.length !== part.count || rows.some(r => !r?.uid || !HASH.test(r?._lineage?.revision_id ?? ""))) fail("INTEGRITY_ERROR", "article shard shape");
      fetched++;
      while (offset < rows.length && results.length < s.limit) {
        const r: Row = rows[offset++];
        if ((from && r.date < from) || (to && r.date > to) || r.filter) continue;
        if (s.scope.category && !(r.category ?? "").toLowerCase().includes(String(s.scope.category).toLowerCase())) continue;
        if (s.scope.region && !(r.region ?? "").toLowerCase().includes(String(s.scope.region).toLowerCase())) continue;
        results.push(this.preview(r,m.snapshot_id));
      }
      if (offset >= rows.length) { shard++; offset=0; }
    }
    const complete = shard >= selected.length;
    let next_cursor: string | null = null;
    if (!complete) {
      next_cursor = crypto.randomUUID().replaceAll("-", "");
      await this.kv.put(`agent_cursor:${this.owner}:${next_cursor}`,JSON.stringify({...s,shard,offset}),{expirationTtl:172800});
    }
    const trace_id = crypto.randomUUID();
    const coverage = {selected_shards:selected.length,completed_shards:shard,partial_shard:offset>0?selected[shard]?.file:null,
      months:[...new Set(selected.map(x=>x.month))],remaining_shards:Math.max(0,selected.length-shard),
      excluded_unknown_date_records:(from||to)?(m.months.unknown??0):0};
    console.info(JSON.stringify({event:"agent_retrieval",trace_id,operation:"list",snapshot_id:m.snapshot_id,complete,count:results.length,coverage}));
    return {snapshot_id:m.snapshot_id,trace_id,scope:s.scope,count:results.length,
      articles:results,
      complete,next_cursor,coverage,ordering:"date_desc_within_snapshot; no global relevance ranking",
      warning:complete?null:"Partial retrieval. Continue next_cursor before claiming all-history coverage or no matches."};
  }

  private segment(value: unknown, args: Args) {
    const text = JSON.stringify(value);
    const offset = integer(args.offset,0,0,text.length);
    const end = Math.min(text.length,offset+12000);
    return {content:text.slice(offset,end),content_format:"application/json; concatenate segments before parsing",
      offset,next_offset:end<text.length?end:null,total_characters:text.length,complete:end>=text.length};
  }

  async article(args: Args) {
    if (args.offset && !args.snapshot_id) fail("INVALID_ARGUMENT", "continuation requires snapshot_id");
    const id = stringArg(args,"article_id",128);
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) fail("INVALID_ARGUMENT", "article_id");
    const m = await this.manifest(args.snapshot_id);
    const prefix = Object.keys(m.catalogs).filter(p=>id.startsWith(p)).sort((a,b)=>b.length-a.length)[0];
    const bucket = m.catalogs[prefix];
    if (!bucket) fail("NOT_FOUND", id);
    const catalog = await this.json(bucket.file,bucket.sha256);
    const ref = catalog[id];
    if (!ref) fail("NOT_FOUND", id);
    const rows = await this.json(ref.file,ref.sha256);
    if (!Array.isArray(rows)) fail("INTEGRITY_ERROR", "article shard");
    const row: Row | undefined = rows.find(r=>r.uid===id);
    if (!row?._lineage || !HASH.test(row._lineage.revision_id)) fail("INTEGRITY_ERROR", "article lookup");
    if (ref.revision_id !== row._lineage.revision_id) fail("INTEGRITY_ERROR", "catalog revision mismatch");
    if (args.revision_id !== undefined && row._lineage.revision_id !== args.revision_id) fail("REVISION_MISMATCH", "use the citation's snapshot_id");
    return {article_id:id,snapshot_id:m.snapshot_id,revision_id:row._lineage.revision_id,
      source_url:row.source_url,content_kind:row._lineage.content_kind,verification_status:row._lineage.verification_status,
      ...this.segment(row,args)};
  }

  async wiki(args: Args) {
    if (args.offset && !args.snapshot_id) fail("INVALID_ARGUMENT", "continuation requires snapshot_id");
    const m = await this.manifest(args.snapshot_id,"agent_wikis");
    const id = stringArg(args,"page_id",180);
    if (id) {
      const ref = m.pages[id]; if (!ref) fail("NOT_FOUND", id);
      const page = await this.json(ref.file,ref.sha256);
      if (page.page_id !== id || page.revision_id !== ref.revision_id) fail("INTEGRITY_ERROR", "Wiki lookup mismatch");
      if (args.revision_id !== undefined && page.revision_id !== args.revision_id) fail("REVISION_MISMATCH", "Wiki revision");
      return {found:true,page_id:id,snapshot_id:m.snapshot_id,revision_id:page.revision_id,
        lineage_status:page.lineage_status,lifecycle_status:page.lifecycle_status,
        verification_status:"unverified",content_kind:"derived_wiki",...this.segment(page,args)};
    }
    const month = stringArg(args,"month",7);
    if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("INVALID_ARGUMENT", "month");
    const selected = Object.entries(m.pages).filter(([,v])=>!month||v.period===month);
    const offset = integer(args.offset,0,0,selected.length), limit = integer(args.limit,30,1,100);
    const end = Math.min(offset+limit,selected.length);
    return {found:selected.length>0,snapshot_id:m.snapshot_id,month,total_pages:selected.length,
      pages:selected.slice(offset,end).map(([page_id,ref])=>({page_id,...ref})),
      next_offset:end<selected.length?end:null,complete:end>=selected.length,
      instruction:"Read each page_id with this snapshot_id; derived Wiki is not a complete source corpus."};
  }
}
