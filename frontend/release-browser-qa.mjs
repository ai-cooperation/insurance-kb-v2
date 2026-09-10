// CI-only browser smoke test of the real production build, no fabricated data.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:4179';
const server = process.argv[2] ? null : spawn('node', ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4179'], {stdio:'inherit'});
const browser = await chromium.launch({headless:true});
const label = new URL(base).hostname.replaceAll('.', '-');
await mkdir('release-qa', {recursive:true});
try {
  for (let attempt=0; attempt<3; attempt++) {
    try {const r=await fetch(base);if(r.ok)break;throw Error(`HTTP ${r.status}`);}
    catch (e) {if(attempt===2)throw e;await new Promise(r=>setTimeout(r,1000));}
  }
  const expected = await readFile('dist/index.html','utf8');
  const stats = JSON.parse(await readFile('dist/data/stats.json','utf8'));
  const expectedAssets=[...expected.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(m=>m[1]);
  const rows=[];
  for (const width of [375,768,1280]) {
    const page=await browser.newPage({viewport:{width,height:900}});
    // App data readiness, not unrelated persistent auth/analytics connections.
    const response=await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
    assert.equal(response.status(),200);
    await page.waitForSelector('#root h1, #root h2',{timeout:30000});
    await page.getByText(stats.total_visible.toLocaleString('en-US'),{exact:true}).first().waitFor({timeout:30000});
    if(stats.latest_date_count>0) await page.waitForSelector('#today-grid h3',{timeout:30000});
    const html=await response.text();
    for(const asset of expectedAssets){assert.ok(html.includes(asset),`Wrong asset version: ${asset}`);const r=await page.request.get(base+asset);assert.equal(r.status(),200);}
    const layout=await page.evaluate(()=>({title:document.title,text:document.querySelector('#root').innerText.slice(0,400),
      viewport:innerWidth,width:document.documentElement.scrollWidth,
      headings:[...document.querySelectorAll('h1,h2')].map(el=>({text:el.textContent,scroll:el.scrollWidth,client:el.clientWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}))}));
    assert.ok(layout.text.length>20,'Empty app');
    assert.ok(layout.width<=width+2,'Horizontal page overflow');
    for(const h of layout.headings){assert.ok(h.scroll<=h.client+2,`Heading overflow: ${h.text}`);assert.ok(h.left>=-2&&h.right<=width+2,`Heading outside viewport: ${h.text}`);}
    await page.screenshot({path:`release-qa/${label}-${width}.png`,fullPage:true});
    rows.push(layout);await page.close();
  }
  await writeFile(`release-qa/${label}.json`,JSON.stringify(rows,null,2));
  console.log(JSON.stringify({base,viewports:rows.map(r=>r.viewport),assets:expectedAssets,status:'passed'}));
} finally {await browser.close();if(server)server.kill();}
