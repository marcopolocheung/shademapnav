import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const {build}=await import(path.join(root,'node_modules/esbuild/lib/main.js'));
const {chromium}=await import(path.join(root,'node_modules/@playwright/test/index.mjs'));
const out=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'umbra-02c-gpu-')),'probe.js');
await build({entryPoints:[path.join(here,'gpu-browser.ts')],bundle:true,format:'iife',platform:'browser',outfile:out});
const server=http.createServer((req,res)=>{if(req.url==='/probe.js'){res.setHeader('content-type','application/javascript');res.end(fs.readFileSync(out));}else res.end('<script src="/probe.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage();page.on('console',m=>console.log(m.text()));
 await page.goto('http://127.0.0.1:'+server.address().port+'/');
 const result=await page.evaluate(()=>window.runProbe());
 result.browser=browser.version();result.date=new Date().toISOString();
 fs.writeFileSync(path.join(here,'gpu-raw.json'),JSON.stringify(result,null,2));
 const mismatch=result.rows.filter(r=>JSON.stringify(r.cpu)!==JSON.stringify(r.gpu));
 const pointMismatches=result.rows.flatMap(r=>r.cpuValues.map((v,i)=>({z:r.z,case:r.i,slot:i,cpu:v,gpu:r.gpuValues[i]}))).filter(r=>r.cpu!==r.gpu);
 const summary={rows:result.rows.length,mismatchingEdges:mismatch.length,pointMismatches,witnesses:result.witnesses,zero:result.zero,partial:result.partial};
 fs.writeFileSync(path.join(here,'gpu-summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 if(mismatch.length||pointMismatches.length)process.exitCode=1;
 assert.deepEqual(result.zero[0].validSampleFraction,{left:0,right:0});
 assert.equal(result.zero[0].source,'none');assert.equal(result.zero[0].confidence,0);
 assert.equal(result.zero[0].left,null);assert.equal(result.zero[0].right,null);
 assert.equal(result.partial[0].left,1);assert.equal(result.partial[0].right,.5);
 assert.equal(result.partial[0].confidence,.4);
 const expected=[null,null,1,0,0,1];if(result.witnesses.some((w,i)=>w.cpu!==expected[i]||w.gpu!==expected[i]))process.exitCode=1;
}finally{await browser?.close();await new Promise(r=>server.close(r));}
