// Synthetic for testing only: quota failures and clock-controlled cache isolation.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=join(mkdtempSync(join(tmpdir(),'insurance-quota-')),'guard.mjs');
execFileSync('node_modules/.bin/esbuild',['src/agent-d1-guard.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
const {withD1QuotaGuard,cachedSearch}=await import(pathToFileURL(out));
function kv(){const data=new Map();return {data,get:async k=>data.get(k)??null,put:async(k,v)=>data.set(k,v)};}
test('a confirmed quota error suppresses following D1 calls until UTC reset',async()=>{
  const store=kv(),now=Date.UTC(2026,8,12,5),error=new Error("D1_ERROR: Your account has exceeded D1's free tier daily row write limit.");
  await assert.rejects(withD1QuotaGuard(store,async()=>{throw error;},now),/D1_QUOTA_EXCEEDED/);
  let called=false;
  await assert.rejects(withD1QuotaGuard(store,async()=>{called=true;},now+1000),/2026-09-13T00:00:00.000Z/);
  assert.equal(called,false);
  assert.equal(await withD1QuotaGuard(store,async()=>42,Date.UTC(2026,8,13)),42);
});
test('nested D1 causes are recognized but unrelated failures do not open circuit',async()=>{
  const store=kv();
  await assert.rejects(withD1QuotaGuard(store,async()=>{throw new Error('query failed',{cause:new Error('free tier daily row read limit exceeded')});}),/D1_QUOTA_EXCEEDED/);
  const other=kv();
  await assert.rejects(withD1QuotaGuard(other,async()=>{throw new Error('syntax error');}),/syntax error/);
  assert.equal(other.data.size,0);
});
test('cache coalesces identical public-snapshot queries without persistent writes',async()=>{
  let calls=0;
  const run=async()=>{calls++;return {total:2};};
  const values=await Promise.all([cachedSearch('synthetic-one',run,1000),cachedSearch('synthetic-one',run,1000)]);
  assert.equal(calls,1);assert.deepEqual(values.map(x=>x.hit),[false,true]);
  assert.equal((await cachedSearch('synthetic-one',run,301001)).hit,false);
  await cachedSearch('synthetic-two',run,1000);assert.equal(calls,3);
});
test('failed requests never become cached empty results',async()=>{
  await assert.rejects(cachedSearch('synthetic-failure',async()=>{throw new Error('unavailable');}),/unavailable/);
  assert.equal((await cachedSearch('synthetic-failure',async()=>7)).value,7);
});
