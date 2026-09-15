// Synthetic for testing only. Executes production SQL with real SQLite/FTS5.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const out=join(mkdtempSync(join(tmpdir(),'insurance-query-')),'query.mjs');
execFileSync('node_modules/.bin/esbuild',['src/agent-search-query.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
const {buildSearchQuery}=await import(pathToFileURL(out));
const db=new DatabaseSync(':memory:');
db.exec(readFileSync('migrations/0004_agent_search.sql','utf8'));
const rows=[
  ['a','2013-05-01','台灣保險市場','ifrs 17','監管','台灣','舊資料'],
  ['b','2026-09-01','ifrs updates','','市場','日本','宏利人壽'],
  ['c','2026-09-02','september 17 briefing','','市場','台灣','lina人壽'],
  ['d','2026-09-03','純文字 100% a_b c\\d "引號" 😀保險','','','台灣',''],
  ['e','2026-09-04','100x axb 保險','','','日本',''],
  ['f','2026-09-05','axa and 安盛','','','香港',''],
];
const insert=db.prepare('INSERT INTO agent_search_articles(uid,revision_id,date,title,title_en,category,region,summary) VALUES(?,?,?,?,?,?,?,?)');
for(const [uid,date,...fields] of rows)insert.run(uid,'a'.repeat(64),date,...fields);

// Independent literal-contains oracle; aliases are explicit expectations below.
function oracle(query,scope={}) {
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(r=>(!scope.date_from||r[1]>=scope.date_from)&&(!scope.date_to||r[1]<=scope.date_to)
    &&(!scope.region||r[5].includes(scope.region))&&(!scope.category||r[4].includes(scope.category)))
    .map(([uid,date,title,en,category,,summary])=>({uid,date,
      score:terms.reduce((n,t)=>n+(title.includes(t)?3:0)+(en.includes(t)?3:0)+(category.includes(t)?2:0)+(summary.includes(t)?1:0),0)}))
    .filter(r=>r.score>0).sort((a,b)=>b.score-a.score||b.date.localeCompare(a.date)||a.uid.localeCompare(b.uid));
}
function run(query,scope={},limit=20){
  const plan=buildSearchQuery({query,...scope},limit);
  return {plan,result:db.prepare(plan.sql).all(...plan.params)};
}
for(const query of ['保險','IFRS 17','ifrs','17','100%','a_b','c\\d','"引號"','😀保險','not-present','純文字','a']) {
  test(`real SQL preserves literal OR search and total: ${query}`,()=>{
    for(const scope of [{},{date_from:'2026-01-01'},{region:'台灣'},{category:'監管'}]) {
      const expected=oracle(query,scope),{result}=run(query,scope,1);
      assert.equal(result[0].total,expected.length);
      assert.deepEqual(result.filter(r=>r.uid!==null).map(({uid,date,score})=>({uid,date,score})),expected.slice(0,1));
    }
  });
}
test('company alias-only matches are not dropped by candidate pruning',()=>{
  assert.deepEqual(run('マニュライフ').result.map(r=>r.uid),['b']);
  assert.deepEqual(run('라이나').result.map(r=>r.uid),['c']);
  assert.deepEqual(run('安盛').result.map(r=>r.uid),['f']);
});
test('long terms use the FTS candidate index; short terms explicitly retain one source scan',()=>{
  const indexed=run('ifrs').plan,short=run('IFRS 17').plan;
  assert.equal(indexed.mode,'fts_candidates');assert.equal(short.mode,'short_term_scan');
  const details=db.prepare(`EXPLAIN QUERY PLAN ${indexed.sql}`).all(...indexed.params).map(r=>r.detail).join('\n');
  assert.match(details,/VIRTUAL TABLE INDEX .*M\d/);
  assert.match(details,/SEARCH a USING INTEGER PRIMARY KEY/);
  assert.doesNotMatch(short.sql,/JOIN agent_search_fts/);
});
test('empty corpora still return a verified zero total',()=>{
  const empty=new DatabaseSync(':memory:');empty.exec(readFileSync('migrations/0004_agent_search.sql','utf8'));
  const plan=buildSearchQuery({query:'保險'},20);
  assert.equal(empty.prepare(plan.sql).get(...plan.params).total,0);empty.close();
});
test('excessive bindings fail before D1 is called',()=>{
  assert.throws(()=>buildSearchQuery({query:Array(26).fill('abc').join(' ')},20),/INVALID_ARGUMENT/);
});
