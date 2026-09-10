import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

test('MCP exposes one copy of each paged Agent tool and retains report tools',async()=>{
  const out=join(mkdtempSync(join(tmpdir(),'insurance-mcp-')),'mcp.mjs');
  execFileSync('node_modules/.bin/esbuild',['src/mcp.ts','--bundle','--platform=node','--format=esm',`--outfile=${out}`]);
  const {handleMCPManifest}=await import(pathToFileURL(out));
  const result=await handleMCPManifest({json:x=>x});
  const names=result.tools.map(t=>t.name);
  assert.equal(result.version,'0.4.0');
  assert.equal(new Set(names).size,names.length);assert.equal(result.tool_count,names.length);
  for(const name of ['list_knowledge','list_articles','search_articles','get_article','get_wiki','add_finding','get_report'])assert.ok(names.includes(name));
  assert.ok(result.tools.find(t=>t.name==='search_articles').inputSchema.properties.cursor);
  assert.ok(result.tools.find(t=>t.name==='get_wiki').inputSchema.properties.page_id);
});
