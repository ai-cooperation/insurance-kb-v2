// Synthetic for testing only: deterministic corpus served by a fake CDN.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const out = join(mkdtempSync(join(tmpdir(), 'insurance-agent-test-')), 'reader.mjs');
execFileSync('node_modules/.bin/esbuild', ['src/agent-retrieval.ts', '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`]);
const { AgentReader } = await import(pathToFileURL(out));
function stable(x) {
  if (Array.isArray(x)) return x.map(stable);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])]));
  return x;
}
const encode = x => JSON.stringify(stable(x));
const hash = s => createHash('sha256').update(s).digest('hex');
function fixture() {
  const files = new Map(), cursors = new Map();
  const object = (x, folder='objects') => {
    const text = encode(x), sha256 = hash(text), file = `${folder}/${sha256}.json`;
    files.set(file, text); return {file, sha256, count: x.length};
  };
  const rows = Array.from({length: 7}, (_,i) => ({uid:`a${i}`, date:`202${6-i}-01-01`,
    title:`Synthetic insurance ${i}`, summary:'complete saved excerpt '.repeat(900),
    _lineage:{revision_id:String(i).repeat(64),content_kind:'saved_excerpt',verification_status:'unverified'}}));
  const shards = rows.map(r => ({...object([r]),month:r.date.slice(0,7)}));
  const searchShards = rows.map(r => ({...object([r], 'objects/search'),from_month:r.date.slice(0,7),to_month:r.date.slice(0,7)}));
  const catalogs = Object.fromEntries(rows.map((r,i) => [r.uid,object({[r.uid]:{...shards[i],revision_id:r._lineage.revision_id}},'catalogs')]));
  function snapshot(body, current) {
    const snapshot_id=hash(encode(body)), m={...body,snapshot_id};
    files.set(current,encode(m)); files.set(`snapshots/${snapshot_id}.json`,encode(m));return m;
  }
  const manifest=snapshot({schema_version:3,kind:'agent_articles',shards,search_shards:searchShards,search_records:7,catalogs,total_records:7,
    months:Object.fromEntries(shards.map(s=>[s.month,1])),newest_date:'2026-01-01'},'manifest.json');
  const kv={get:async k=>cursors.get(k)??null,put:async(k,v)=>{cursors.set(k,v);}};
  const fetcher=async url=>{const p=new URL(url).pathname.split('/agent/')[1];return new Response(files.get(p)??'missing',{status:files.has(p)?200:404});};
  const reader=new AgentReader(kv,'test-user',fetcher);
  return {reader,files,rows,shards,snapshot,manifest,kv,fetcher,object};
}

test('all-history pagination traverses every shard without duplicates',async()=>{
  const {reader}=fixture(); let args={all_history:true,limit:2}, ids=[];
  for(let i=0;i<10;i++) {
    const r=await reader.list(args); ids.push(...r.articles.map(a=>a.uid));
    if(r.complete){assert.equal(r.next_cursor,null);break;}
    assert.ok(r.next_cursor);args={cursor:r.next_cursor};
  }
  assert.deepEqual(ids,['a0','a1','a2','a3','a4','a5','a6']);
});
test('search scans every search shard and globally finds old history in one call',async()=>{
  const {reader}=fixture(); const r=await reader.search({query:'6'});
  assert.equal(r.complete,true);assert.equal(r.next_cursor,null);
  assert.equal(r.results[0].uid,'a6');
  assert.equal(r.coverage.selected_shards,7);
  assert.equal(r.coverage.completed_shards,7);
  assert.equal(r.coverage.scanned_records,7);
  assert.equal(r.total_matches,1);
  assert.equal(r.ordering,'global_relevance_score_then_date_desc_within_snapshot');
  const ranked=await reader.search({query:'Synthetic',limit:2});
  assert.deepEqual(ranked.results.map(x=>x.uid),['a0','a1']);
  assert.equal(ranked.total_matches,7);assert.equal(ranked.result_truncated,true);
});

test('search fails closed when compact coverage is incomplete',async()=>{
  const {reader,manifest,snapshot}=fixture();
  const {snapshot_id,...body}=manifest;
  snapshot({...body,search_records:6},'manifest.json');
  await assert.rejects(reader.search({query:'Synthetic'}),/INTEGRITY_ERROR/);
});

test('search date range fetches only overlapping compact shards',async()=>{
  const {reader}=fixture();
  const r=await reader.search({query:'Synthetic',date_from:'2024-01-01',date_to:'2025-12-31'});
  assert.deepEqual(r.results.map(x=>x.uid),['a1','a2']);
  assert.equal(r.coverage.selected_shards,2);assert.equal(r.coverage.scanned_records,2);
});

test('missing compact search shard fails instead of returning partial matches',async()=>{
  const {reader,files,manifest}=fixture();files.delete(manifest.search_shards[1].file);
  await assert.rejects(reader.search({query:'Synthetic'}),/DATA_UNAVAILABLE/);
});
test('reader works on the deployed compatibility date without AbortSignal.timeout',async()=>{
  const original=AbortSignal.timeout;
  Object.defineProperty(AbortSignal,'timeout',{value:undefined,configurable:true});
  try {
    const {reader}=fixture();const r=await reader.search({query:'6'});
    assert.equal(r.complete,true);assert.equal(r.results[0].uid,'a6');
  } finally {
    Object.defineProperty(AbortSignal,'timeout',{value:original,configurable:true});
  }
});
test('missing shard fails instead of claiming complete',async()=>{
  const {reader,files,shards}=fixture();files.delete(shards[1].file);
  await assert.rejects(reader.list({all_history:true}),/DATA_UNAVAILABLE/);
});
test('checksum mismatch fails closed',async()=>{
  const {reader,files,shards}=fixture();files.set(shards[0].file,'[]');
  await assert.rejects(reader.list({all_history:true}),/INTEGRITY_ERROR/);
});
test('cursor is bound to operation and scope',async()=>{
  const {reader}=fixture();const r=await reader.list({all_history:true,limit:1});
  await assert.rejects(reader.search({query:'x',cursor:r.next_cursor}),/INVALID_CURSOR/);
  await assert.rejects(reader.list({cursor:r.next_cursor,region:'JP'}),/INVALID_CURSOR/);
  await assert.rejects(reader.list({cursor:'tampered'}),/INVALID_CURSOR/);
});
test('record segmentation returns entire saved content and checks revision',async()=>{
  const {reader,rows}=fixture();let offset=0,text='',snapshot_id;
  for(let i=0;i<20;i++) {
    const r=await reader.article({article_id:'a0',offset,snapshot_id});text+=r.content;snapshot_id=r.snapshot_id;
    if(r.complete)break;offset=r.next_offset;
  }
  assert.equal(JSON.parse(text).summary,rows[0].summary);
  await assert.rejects(reader.article({article_id:'a0',offset:1}),/continuation requires snapshot_id/);
  await assert.rejects(reader.article({article_id:'a0',revision_id:'f'.repeat(64)}),/REVISION_MISMATCH/);
});
test('date range excludes irrelevant months and validates dates',async()=>{
  const {reader}=fixture();const r=await reader.list({date_from:'2024-01-01',date_to:'2025-12-31'});
  assert.deepEqual(r.articles.map(a=>a.uid),['a1','a2']);assert.equal(r.complete,true);
  await assert.rejects(reader.list({date_from:'2026-02-30'}),/INVALID_ARGUMENT/);
});
test('Wiki month lists real pages and exposes full Markdown and provenance',async()=>{
  const {reader,files,snapshot}=fixture();
  const page={page_id:'2026-07/market-global',revision_id:'a'.repeat(64),saved_markdown:'### Source index\n[1] example',source_refs:[],lineage_status:'unknown',lifecycle_status:'unknown'};
  const text=encode(page),sha256=hash(text),file=`objects/wiki/${sha256}.json`;files.set(file,text);
  snapshot({schema_version:3,kind:'agent_wikis',pages:{[page.page_id]:{file,sha256,period:'2026-07',revision_id:page.revision_id}}},'wiki-manifest.json');
  const listed=await reader.wiki({month:'2026-07'});assert.equal(listed.found,true);
  const fetched=await reader.wiki({page_id:page.page_id});assert.equal(JSON.parse(fetched.content).saved_markdown,page.saved_markdown);
});

test('manifest totals and shard shape are checked even when checksum is valid',async()=>{
  const {reader,manifest,snapshot}=fixture();
  const {snapshot_id,...body}=manifest;
  snapshot({...body,total_records:8},'manifest.json');
  await assert.rejects(reader.catalog(),/INTEGRITY_ERROR/);
});

test('cursor stays on frozen snapshot when current publication changes',async()=>{
  const {reader,manifest,snapshot}=fixture();
  const first=await reader.list({all_history:true,limit:1});
  const {snapshot_id,...body}=manifest;
  snapshot({...body,newest_date:'2026-02-01'},'manifest.json');
  assert.notEqual((await reader.catalog()).snapshot_id,first.snapshot_id);
  const second=await reader.list({cursor:first.next_cursor});
  assert.equal(second.snapshot_id,first.snapshot_id);assert.equal(second.articles[0].uid,'a1');
});

test('cursor cannot be used by a different authenticated owner',async()=>{
  const {reader,kv,fetcher}=fixture();
  const first=await reader.list({all_history:true,limit:1});
  const other=new AgentReader(kv,'other-user',fetcher);
  await assert.rejects(other.list({cursor:first.next_cursor}),/INVALID_CURSOR/);
});

test('partial shard resume neither skips nor duplicates records',async()=>{
  const {reader,rows,object,snapshot,manifest}=fixture();
  const batch=rows.slice(0,3).map(r=>({...r,date:'2026-01-01'}));
  snapshot({schema_version:3,kind:'agent_articles',shards:[{...object(batch),month:'2026-01'}],
    search_shards:[{...object(batch,'objects/search'),from_month:'2026-01',to_month:'2026-01'}],search_records:3,
    catalogs:manifest.catalogs,months:{'2026-01':3},total_records:3},'manifest.json');
  const first=await reader.list({all_history:true,limit:2});
  assert.equal(first.coverage.completed_shards,0);assert.ok(first.coverage.partial_shard);
  const second=await reader.list({cursor:first.next_cursor});
  assert.equal(second.complete,true);
  assert.deepEqual([...first.articles,...second.articles].map(r=>r.uid),['a0','a1','a2']);
});

test('invalid scope arguments and missing lookups are explicit failures',async()=>{
  const {reader}=fixture();
  for (const args of [{limit:0},{limit:101},{days:30,all_history:true},{date_from:'2026-02-01',date_to:'2026-01-01'},{region:42}])
    await assert.rejects(reader.list(args),/INVALID_ARGUMENT/);
  await assert.rejects(reader.search({}),/INVALID_ARGUMENT/);
  await assert.rejects(reader.article({article_id:'../x'}),/INVALID_ARGUMENT/);
  await assert.rejects(reader.article({article_id:'absent'}),/NOT_FOUND/);
  await assert.rejects(reader.catalog({snapshot_id:'bad'}),/INVALID_ARGUMENT/);
});
