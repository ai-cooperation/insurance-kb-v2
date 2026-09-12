// Optional full real-data traversal, served locally through the production reader.
// No external calls, no publication, no synthetic results labelled as real.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

test('full saved publication traverses once, resolves full records and Wiki pages',
  {skip:!process.env.AGENT_PUBLICATION_DIR},async()=>{
    const root=resolve(process.env.AGENT_PUBLICATION_DIR);
    const out=join(mkdtempSync(join(tmpdir(),'insurance-real-')),'reader.mjs');
    execFileSync('node_modules/.bin/esbuild',['src/agent-retrieval.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
    const {AgentReader}=await import(pathToFileURL(out));
    const kvMap=new Map(),cache=new Map();
    const reader=new AgentReader({get:async k=>kvMap.get(k)??null,put:async(k,v)=>kvMap.set(k,v)},'local-verification',async url=>{
      const file=new URL(url).pathname.split('/agent/')[1];
      if(!cache.has(file))cache.set(file,readFileSync(join(root,file),'utf8'));
      return new Response(cache.get(file));
    });
    const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
    const expected=new Map();
    for(const ref of manifest.shards)for(const row of JSON.parse(readFileSync(join(root,ref.file),'utf8')))expected.set(row.uid,row);
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
    assert.equal(exhaustive.total_matches,0);assert.equal(exhaustive.coverage.scanned_records,manifest.total_records);
    assert.equal(exhaustive.coverage.completed_shards,manifest.search_shards.length);
    const rows=[...expected.values()];
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
    console.log(JSON.stringify({real_records:ids.size,list_calls:calls,search_calls:1,search_shards:manifest.search_shards.length,
      wiki_pages:wikiIDs.length,full_record_samples:sample.map(r=>r.uid),snapshot_id:manifest.snapshot_id}));
  });
