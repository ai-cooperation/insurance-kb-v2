// Synthetic only: exercises the real Worker route against SQLite, not live D1.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sqliteD1} from './helpers/sqlite-d1.mjs';

const out=join(mkdtempSync(join(tmpdir(),'insurance-sync-batch-')),'app.mjs');
execFileSync('node_modules/.bin/esbuild',['src/index.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
const {default:app}=await import(pathToFileURL(out));
const from='a'.repeat(64),to='b'.repeat(64),token='synthetic-test-token';
const row=(uid,revision='a'.repeat(64),title=uid)=>({uid,revision_id:revision,_lineage:{revision_id:revision},date:'2026-09-01',title,title_en:title,category:'market',region:'tw',summary:`summary ${title}`});
function request(plan,body){return new Request('https://example.test/internal/agent-index/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:body??JSON.stringify(plan)});}
const envFor=(db)=>({AGENT_INDEX_SYNC_TOKEN:token,KV:{get:async()=>null,put:async()=>{}},REPORTS_DB:db});

test('syncs more than 400 changes in one atomic D1 batch and updates FTS',async(t)=>{
  const db=sqliteD1([row('keep'),row('remove')],from);t.after(()=>db.close());
  const upserts=[row('keep','c'.repeat(64),'patchedmarker'),...Array.from({length:400},(_,i)=>row(`new-${i}`))];
  const plan={schema_version:1,from_snapshot_id:from,to_snapshot_id:to,total_records:401,upserts,deletes:['remove']};
  const response=await app.fetch(request(plan),envFor(db));
  assert.equal(response.status,200,await response.text());
  assert.equal(db.batchCalls,1);
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM agent_search_articles').get().n,401);
  assert.equal(db.connection.prepare('SELECT snapshot_id FROM agent_search_meta').get().snapshot_id,to);
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM agent_search_fts WHERE agent_search_fts MATCH 'patchedmarker'").get().n,1);
});

test('a count mismatch rolls back every changed row and preserves the prior snapshot',async(t)=>{
  const db=sqliteD1([row('keep'),row('remove')],from);t.after(()=>db.close());
  const plan={schema_version:1,from_snapshot_id:from,to_snapshot_id:to,total_records:9,upserts:[row('new')],deletes:['remove']};
  const response=await app.fetch(request(plan),envFor(db));
  assert.equal(response.status,500);
  assert.equal(db.connection.prepare('SELECT COUNT(*) AS n FROM agent_search_articles').get().n,2);
  assert.equal(db.connection.prepare("SELECT COUNT(*) AS n FROM agent_search_articles WHERE uid='new'").get().n,0);
  assert.equal(db.connection.prepare('SELECT snapshot_id FROM agent_search_meta').get().snapshot_id,from);
});

test('enforces the body-size limit even when Content-Length is absent',async()=>{
  const body=JSON.stringify({schema_version:1,from_snapshot_id:from,to_snapshot_id:to,total_records:0,upserts:[],deletes:[],padding:'x'.repeat(10*1024*1024)});
  const response=await app.fetch(request(null,body),envFor({prepare(){assert.fail('oversized plans must not query D1');}}));
  assert.equal(response.status,413);
});

test('rejects more than 10,000 operations before querying D1',async()=>{
  const plan={schema_version:1,from_snapshot_id:from,to_snapshot_id:to,total_records:0,upserts:[],
    deletes:Array.from({length:10_001},(_,i)=>`uid-${i}`)};
  const env=envFor({prepare(){assert.fail('over-limit plans must not query D1');}});
  const response=await app.fetch(request(plan),env);
  assert.equal(response.status,413);
});
