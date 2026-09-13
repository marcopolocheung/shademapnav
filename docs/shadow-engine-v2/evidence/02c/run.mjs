import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../../../..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'umbra-02c-'));
const original=path.join(root,'app/lib/shadowField/__tests__/agreement/harness.ts');
const test=path.join(root,'app/lib/shadowField/__tests__/agreement/agreement.test.ts');
const core=path.join(here,'core.mjs');
fs.symlinkSync(path.join(root,'node_modules'),path.join(scratch,'node_modules'),'dir');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs=['docs/shadow-engine-v2/BRIEF.md','docs/shadow-engine-v2/00-findings.md','docs/shadow-engine-v2/01-current-engine-audit.md','docs/shadow-engine-v2/02-architecture.md','docs/shadow-engine-v2/02a-feasibility.md','docs/shadow-engine-v2/02b-placement.md','app/lib/shadowField/__tests__/agreement/agreement.test.ts','app/lib/shadowField/__tests__/agreement/harness.ts','app/lib/shadowField/__tests__/agreement/fixtures.ts','app/lib/shadowSampling.ts','app/lib/shadowField/ShadowField.ts','app/hooks/useNavigation.ts'];
fs.writeFileSync(path.join(here,'run-metadata.json'),JSON.stringify({date:new Date().toISOString(),revision:spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),node:process.version,platform:os.platform(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length,inputs:Object.fromEntries(inputs.map(p=>[p,sha(path.join(root,p))]))},null,2));
let harness=fs.readFileSync(original,'utf8').replace(/from "(\.[^"]+)"/g,(_,p)=>`from ${JSON.stringify(path.resolve(path.dirname(original),p))}`);
harness=`import fs from 'node:fs';\nimport * as core from ${JSON.stringify(core)};\nconst z=Number(process.env.LATTICE_Z);\nconst rasters=new WeakMap();\nconst referenceRows=new WeakMap();\nconst rawRuns=[];\nfunction grid(f){let g=rasters.get(f.prisms);if(!g){g=core.rasterize(f.prisms.prisms,z);rasters.set(f.prisms,g);}return g;}\n`+harness;
harness=harness.replace('  return sampleBothSidewalks(\n    canvas.project,',`  const g=grid(fixture),points=[];
  const maskedProject=(lng,lat)=>{
    const p=core.project(lng,lat,z),valid=core.validGround(g,p),xy=canvas.project(lng,lat);
    const x=Math.round(xy[0]*canvas.dpr),y=Math.round(xy[1]*canvas.dpr),i=(y*canvas.imageData.width+x)*4;
    points.push({lng,lat,grid:p,valid,pixel:[x,y],rgb:Array.from(canvas.imageData.data.slice(i,i+3))});
    return valid?xy:[-1,-1];
  };
  const answer=sampleBothSidewalks(
    maskedProject,`);
harness=harness.replace('    edgeSampleCount(distanceM)\n  );\n}',`    edgeSampleCount(distanceM)
  );
  const n=points.length/2;
  if(!points.slice(0,n).some(p=>p.valid))answer.left=null;
  if(!points.slice(n).some(p=>p.valid))answer.right=null;
  referenceRows.set(fixture,{points,width:canvas.imageData.width,height:canvas.imageData.height});
  return answer;
}`);
harness=harness.replace('return { left: shadow.left, right: shadow.right };','return shadow;');
harness=harness.replace('  return fixtures.map((fixture) => {\n    const reference', '  const rows=fixtures.map((fixture,i) => {\n    const reference');
harness=harness.replace('      city: fixture.city,\n      left: Math.abs(field.left - reference.left),\n      right: Math.abs(field.right - reference.right),',`      i, city: fixture.city, when: fixture.when.toISOString(),edge:fixture.edge,sun:sunForRaw(fixture),
      answer:field,reference,referenceSamples:referenceRows.get(fixture),
      left: field.left===null||reference.left===null?null:Math.abs(field.left-reference.left),
      right: field.right===null||reference.right===null?null:Math.abs(field.right-reference.right),
      grid:{z,x0:grid(fixture).x0,y0:grid(fixture).y0,w:grid(fixture).w,h:grid(fixture).h},
`);
harness=harness.replace('  });\n}\n\nexport function reportFor',`  });
  rawRuns.push(rows);
  fs.writeFileSync(process.env.RAW_OUTPUT,JSON.stringify({z,runs:rawRuns},null,2));
  return rows;
}

export function reportFor`);
harness=harness.replaceAll('flatMap((d) => [d.left, d.right])','flatMap((d) => [d.left, d.right]).filter(v=>v!==null)');
harness=`import {sunFor as sunForRaw} from ${JSON.stringify(path.join(root,'app/lib/shadowField/__tests__/agreement/fixtures.ts'))};\n`+harness;
fs.writeFileSync(path.join(scratch,'harness.ts'),harness);
// The committed assertion file is imported unchanged. Only the authorized corpus adapter and candidate factory are substituted.
const setup=`import {vi} from 'vitest';
vi.mock(${JSON.stringify(original)},async()=>await import(${JSON.stringify(path.join(scratch,'harness.ts'))}));
vi.mock(${JSON.stringify(path.join(root,'app/lib/shadowField/ShadowField.ts'))},async importOriginal=>{
 const actual=await importOriginal();const core=await import(${JSON.stringify(core)});
 const {metersPerDegree}=await import(${JSON.stringify(path.join(root,'app/lib/shadowField/geometry.ts'))});
 const {sunFor}=await import(${JSON.stringify(path.join(root,'app/lib/shadowField/__tests__/agreement/fixtures.ts'))});
 const cache=new WeakMap();
 return {...actual,createGeometryShadowField:(providers)=>({sampleEdges:(edges,when)=>{
  const bbox=actual.bboxAroundEdges(edges,2000),set=providers[0].prismsFor(bbox);
  if(!set)throw Error('Candidate lacks corpus geometry');
  let f=cache.get(set);if(!f){f=core.rasterize(set.prisms,Number(process.env.LATTICE_Z));cache.set(set,f);}
  return edges.map(edge=>core.sampleEdges(f,core.layout([edge],f.z,{...actual,metersPerDegree}),sunFor({edge,when}))[0]);
 }})};
});`;
fs.writeFileSync(path.join(scratch,'setup.ts'),setup);
const extra=`import {it,expect} from 'vitest';import fs from 'node:fs';
import {agreementFixtures,sunFor} from ${JSON.stringify(path.join(root,'app/lib/shadowField/__tests__/agreement/fixtures.ts'))};
import {disagreementsFor,referenceFor} from ${JSON.stringify(original)};
const c=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(here,'ceilings.json'))},'utf8'));
it('caps invalid receiver share overall and separately in every retained city',()=>{
 process.env.RAW_OUTPUT=process.env.RAW_OUTPUT.replace('.json','-validity.json');
 const rows=disagreementsFor(agreementFixtures(),f=>{const s=sunFor(f);return referenceFor(f,s,s.altitudeFraction);});
 expect(rows.length).toBe(c.retainedCases);
 for(const city of [null,'madrid','singapore','kent-wa']){
  const points=rows.filter(r=>city===null||r.city===city).flatMap(r=>r.referenceSamples.points);
  const invalid=points.filter(p=>!p.valid).length;
  console.log(JSON.stringify({city:city??'overall',invalid,total:points.length,share:invalid/points.length,ceiling:c.maxInvalidSampleShare}));
  expect(invalid/points.length,city??'overall').toBeLessThanOrEqual(c.maxInvalidSampleShare);
 }
});`;
fs.writeFileSync(path.join(scratch,'validity.test.ts'),extra);
const config={root,test:{environment:'node',include:[test,path.join(scratch,'validity.test.ts')],setupFiles:[path.join(scratch,'setup.ts')],silent:false,reporters:['verbose'],fileParallelism:false}};
fs.writeFileSync(path.join(scratch,'vitest.config.mjs'),'export default '+JSON.stringify(config));
fs.writeFileSync(path.join(here,'harness-amendment.patch'),spawnSync('diff',['-u',original,path.join(scratch,'harness.ts')],{encoding:'utf8'}).stdout);
function run(label,args,env={}){
 const result=spawnSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),...args],{cwd:root,env:{...process.env,...env},encoding:'utf8'});
 fs.writeFileSync(path.join(here,label+'.log'),result.stdout+result.stderr);
 console.log(label,'exit',result.status,result.stdout.slice(-1800));
 return result.status;
}
const statuses={legacy:run('legacy-gate',['run',test])};
for(const z of [17,18,19])statuses[z]=run('gate-z'+z,['run','--config',path.join(scratch,'vitest.config.mjs')],{LATTICE_Z:String(z),RAW_OUTPUT:path.join(here,'raw-z'+z+'.json')});
fs.writeFileSync(path.join(here,'gate-status.json'),JSON.stringify(statuses,null,2));
console.log('Temporary generated harness:',scratch);
