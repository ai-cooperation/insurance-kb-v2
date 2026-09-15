// Synthetic for testing only. Real HTTP handler; no live D1 or external calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=join(mkdtempSync(join(tmpdir(),'insurance-sync-')),'app.mjs');
execFileSync('node_modules/.bin/esbuild',['src/index.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
const {default:app}=await import(pathToFileURL(out));
const plan={schema_version:1,from_snapshot_id:'a'.repeat(64),to_snapshot_id:'b'.repeat(64),total_records:1,upserts:[],deletes:[]};
function request(token='synthetic-test-token'){
  return new Request('https://example.test/internal/agent-index/sync',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(plan)});
}
test('HTTP quota response is explicit, and a repeated sync does not touch D1',async()=>{
  let reads=0;const state=new Map();
  const env={AGENT_INDEX_SYNC_TOKEN:'synthetic-test-token',
    KV:{get:async k=>state.get(k)??null,put:async(k,v)=>state.set(k,v)},
    REPORTS_DB:{prepare(){reads++;return {async first(){throw new Error("Your account has exceeded D1's free tier daily row write limit.");}};}}};
  assert.equal((await app.fetch(request('wrong'),env)).status,401);assert.equal(reads,0);
  const first=await app.fetch(request(),env);assert.equal(first.status,503);
  assert.ok(Number(first.headers.get('Retry-After'))>0);
  assert.equal((await first.json()).error,'D1_QUOTA_EXCEEDED');assert.equal(reads,1);
  assert.equal((await app.fetch(request(),env)).status,503);assert.equal(reads,1);
});
test('already-applied delta performs no batch writes',async()=>{
  const env={AGENT_INDEX_SYNC_TOKEN:'synthetic-test-token',KV:{get:async()=>null,put:async()=>{}},
    REPORTS_DB:{prepare(){return {async first(){return {snapshot_id:plan.to_snapshot_id,total_records:1};}};},async batch(){assert.fail('idempotent replay must not write');}}};
  const response=await app.fetch(request(),env);assert.equal(response.status,200);
  assert.equal((await response.json()).snapshot_id,plan.to_snapshot_id);
});
