// Optional full real-data traversal, served locally through the production reader.
// No external calls, no publication, no synthetic results labelled as real.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sqliteD1} from './helpers/sqlite-d1.mjs';

test('full saved publication traverses once, resolves full records and Wiki pages',
  {skip:!process.env.AGENT_PUBLICATION_DIR},async(t)=>{
    const root=resolve(process.env.AGENT_PUBLICATION_DIR);
    const out=join(mkdtempSync(join(tmpdir(),'insurance-real-')),'reader.mjs');
    execFileSync('node_modules/.bin/esbuild',['src/agent-retrieval.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
    const {AgentReader}=await import(pathToFileURL(out));
    const kvMap=new Map(),cache=new Map();
    const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
    const expected=new Map();
    for(const ref of manifest.shards)for(const row of JSON.parse(readFileSync(join(root,ref.file),'utf8')))expected.set(row.uid,row);
    const rows=[...expected.values()];
    const db=sqliteD1(rows,manifest.snapshot_id);t.after(()=>db.close());
    const reader=new AgentReader({get:async k=>kvMap.get(k)??null,put:async(k,v)=>kvMap.set(k,v)},'local-verification',async url=>{
      const file=new URL(url).pathname.split('/agent/')[1];
      if(!cache.has(file))cache.set(file,readFileSync(join(root,file),'utf8'));
      return new Response(cache.get(file));
    },db);
    const ids=new Set();let args={all_history:true,limit:100},calls=0,last;
    const info=console.info;console.info=()=>{};
    try{
      for(;calls<10000;){
        last=await reader.list(args);calls++;
        for(const row of last.articles){assert.ok(!ids.has(row.uid));ids.add(row.uid);}
        if(last.complete)break;
        args={cursor:last.next_cursor};
      }
    }finally{console.info=info;}
    assert.ok(last.complete);assert.deepEqual(ids,new Set(expected.keys()));
    const exhaustive=await reader.search({query:'__agent_complete_scan_sentinel_no_match__',all_history:true});
    assert.equal(exhaustive.complete,true);assert.equal(exhaustive.next_cursor,null);
    assert.equal(exhaustive.total_matches,0);assert.equal(exhaustive.coverage.indexed_records,manifest.total_records);
    assert.equal(exhaustive.coverage.scanned_records,null);
    assert.equal(exhaustive.coverage.completed_shards,1);
    const common=await reader.search({query:'IFRS 17',all_history:true,limit:5});
    assert.equal(common.complete,true);assert.equal(common.coverage.indexed_records,manifest.total_records);
    assert.ok(common.total_matches>0);assert.equal(common.results.length,5);
    // Independent full-corpus literal oracle, not a fake SQL response.
    for(const query of ['IFRS 17','保險','ifrs','100%','a_b','nonexistent-sentinel-article']) {
      const terms=query.toLowerCase().split(/\s+/);
      const expected=rows.map(article=>({article,score:terms.reduce((n,term)=>n+
        ['title','title_en','category','summary'].reduce((score,k,i)=>score+
          (String(article[k]??'').toLowerCase().includes(term)?[3,3,2,1][i]:0),0),0)}))
        .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.article.date.localeCompare(a.article.date)||a.article.uid.localeCompare(b.article.uid));
      const actual=await reader.search({query,all_history:true,limit:5});
      assert.equal(actual.total_matches,expected.length,query);
      assert.deepEqual(actual.results.map(r=>[r.uid,r.score]),expected.slice(0,5).map(x=>[x.article.uid,x.score]),query);
    }
    const sample=[rows[0],rows.at(-1),rows.reduce((a,b)=>JSON.stringify(a).length>JSON.stringify(b).length?a:b)];
    for(const row of sample){
      let offset=0,content='';
      do{
        const part=await reader.article({article_id:row.uid,snapshot_id:manifest.snapshot_id,revision_id:row._lineage.revision_id,offset});
        content+=part.content;offset=part.next_offset;
      }while(offset!==null);
      assert.deepEqual(JSON.parse(content),row);
    }
    const wmanifest=JSON.parse(readFileSync(join(root,'wiki-manifest.json'),'utf8'));
    const wikiIDs=[];let offset=0;
    do{
      const part=await reader.wiki({snapshot_id:wmanifest.snapshot_id,limit:100,offset});
      wikiIDs.push(...part.pages.map(p=>p.page_id));offset=part.next_offset;
    }while(offset!==null);
    assert.deepEqual(new Set(wikiIDs),new Set(Object.keys(wmanifest.pages)));
    for(const page_id of [wikiIDs[0],wikiIDs.at(-1)]){
      let offset=0,text='';
      do{const r=await reader.wiki({page_id,snapshot_id:wmanifest.snapshot_id,offset});text+=r.content;offset=r.next_offset;}while(offset!==null);
      assert.deepEqual(JSON.parse(text),JSON.parse(readFileSync(join(root,wmanifest.pages[page_id].file),'utf8')));
    }
    console.log(JSON.stringify({real_records:ids.size,list_calls:calls,search_queries_verified:6,sql_backend:'local-sqlite-fts5',search_backend:manifest.search_backend,
      wiki_pages:wikiIDs.length,full_record_samples:sample.map(r=>r.uid),snapshot_id:manifest.snapshot_id}));
  });
