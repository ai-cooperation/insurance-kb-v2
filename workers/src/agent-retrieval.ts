/** Complete Agent retrieval over immutable monthly data. Chat stays separate.
 * A page of matches is NOT proof of full coverage: follow next_cursor until
 * complete=true. Failed reads throw; never turn missing data into empty success.
 */
import { searchArticles, type Article } from "./search";

type Args = Record<string, unknown>;
type Ref = { file: string; sha256: string; month?: string; count?: number; revision_id?: string; period?: string };
type Manifest = { schema_version: number; kind: string; snapshot_id: string; shards: Ref[];
  catalogs: Record<string, Ref>; months: Record<string, number>; total_records: number;
  newest_date?: string; pages: Record<string, Ref> };
type Row = Article & { uid: string; _lineage: { revision_id: string; content_kind?: string; verification_status?: string } };
type CursorKV = { get(key: string): Promise<string | null>; put(key: string, value: string, options?: {expirationTtl: number}): Promise<unknown> };
type State = { operation: string; snapshot_id: string; scope: Args; limit: number; shard: number; offset: number };
const BASE = "https://insurance-kb.cooperation.tw/data/agent/";
const HASH = /^[a-f0-9]{64}$/;
const MAX_SHARDS = 4;

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
  constructor(private kv: CursorKV, private owner: string, private fetcher: typeof fetch = fetch) {}

  private async json(path: string, expected?: string): Promise<any> {
    if (!/^(manifest|wiki-manifest)\.json$/.test(path) && !/^(snapshots|catalogs|objects(?:\/[a-z0-9-]+)?)\/[a-f0-9]{64}\.json$/.test(path)) fail("INTEGRITY_ERROR", "invalid publication path");
    let response: Response;
    try { response = await this.fetcher(BASE + path, { signal: AbortSignal.timeout(15000), headers: {"Cache-Control":"no-cache"} }); }
    catch { return fail("DATA_UNAVAILABLE", path); }
    if (!response.ok) fail("DATA_UNAVAILABLE", `${path} HTTP ${response.status}`);
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
        if (!s || !/^(\d{4}-(0[1-9]|1[0-2])|unknown)$/.test(s.month) || !HASH.test(s.sha256 ?? "")
            || typeof s.file !== "string" || !Number.isSafeInteger(s.count) || s.count <= 0 || paths.has(s.file))
          fail("INTEGRITY_ERROR", "shard descriptor");
        paths.add(s.file); counts[s.month] = (counts[s.month] ?? 0) + s.count;
      }
      if (!Number.isSafeInteger(m.total_records) || m.total_records < 0
          || Object.values(counts).reduce((a,b)=>a+b,0) !== m.total_records
          || JSON.stringify(stable(counts)) !== JSON.stringify(stable(m.months)))
        fail("INTEGRITY_ERROR", "manifest coverage totals");
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
      instructions: "Use date_from/date_to or all_history. Continue next_cursor until complete. Cite snapshot_id+article_id+revision_id." };
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
    const scope = Object.fromEntries(Object.entries({date_from,date_to,query,
      category:stringArg(args,"category"),region:stringArg(args,"region"),all_history:args.all_history,days:args.days}).filter(([,v])=>v !== undefined));
    const m = await this.manifest(args.snapshot_id);
    return {operation,snapshot_id:m.snapshot_id,scope,limit:integer(args.limit,30,1,100),shard:0,offset:0};
  }

  async list(args: Args = {}) { return this.scan(args,"list"); }
  async search(args: Args = {}) { return this.scan(args,"search"); }

  private async scan(args: Args, operation: string) {
    const s = await this.state(args,operation);
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
        const score = operation === "search" ? searchArticles([r],String(s.scope.query),1)[0]?.score : undefined;
        if (operation === "search" && !score) continue;
        results.push({uid:r.uid,title:r.title,title_en:r.title_en,date:r.date,source:r.source,
          source_url:r.source_url,category:r.category,region:r.region,summary:r.summary?.slice(0,200),
          preview_only:true,score,content_kind:r._lineage.content_kind,verification_status:r._lineage.verification_status,
          citation:{article_id:r.uid,revision_id:r._lineage.revision_id,snapshot_id:m.snapshot_id}});
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
    console.info(JSON.stringify({event:"agent_retrieval",trace_id,operation,snapshot_id:m.snapshot_id,complete,count:results.length,coverage}));
    return {snapshot_id:m.snapshot_id,trace_id,scope:s.scope,count:results.length,
      articles:operation==="list"?results:undefined,results:operation==="search"?results:undefined,
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
