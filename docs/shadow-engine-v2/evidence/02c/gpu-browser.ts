import * as core from './core.mjs';
import {gpuKernel} from './gpu-kernel.mjs';
import {agreementFixtures,sunFor} from '../../../../app/lib/shadowField/__tests__/agreement/fixtures';
import {sidewalkOffsets,edgeSampleCount} from '../../../../app/lib/shadowField/ShadowField';
import {metersPerDegree} from '../../../../app/lib/shadowField/geometry';
const helpers={sidewalkOffsets,edgeSampleCount,metersPerDegree};
window.runProbe=async()=>{
 const fixtures=agreementFixtures(),rows=[],meta=[];
 for(const z of [17,18,19])for(const city of ['madrid','singapore','kent-wa']){
  const cases=fixtures.map((f,i)=>({...f,i})).filter(f=>f.city===city);
  const f=core.rasterize(cases[0].prisms.prisms,z),plan=core.layout(cases.map(c=>c.edge),z,helpers),kernel=gpuKernel(f,plan,core);
  meta.push({z,city,renderer:kernel.renderer,w:f.w,h:f.h,output:[kernel.width,kernel.height]});
  for(let index=0;index<cases.length;index++){
   const fixture=cases[index],sun=sunFor(fixture),cpu=core.sampleEdges(f,plan,sun)[index],gpu=await kernel.measure(0,sun);
   const {start,n}=plan.groups[index];
   const values=plan.points.slice(start,start+2*n).map(p=>core.trace(f,p,core.ray(sun)).value);
   rows.push({z,city,i:fixture.i,sun,cpu,gpu:gpu.answer[index],cpuValues:values,gpuValues:gpu.values.slice(start,start+2*n)});
  }
  kernel.dispose();
  console.log(JSON.stringify({stage:'city',z,city}));
 }
 // Analytic receiver witnesses: the same occupied column is invalid ground, but a roof uses its own height.
 const f={z:17,x0:0,y0:0,w:3,h:3,B:new Int32Array(9),maxQ:640};f.B[4]=640;
 const witnesses=[];
 for(const [name,kind,heightM,point,sun] of [
  ['interior-day',0,0,[1.5,1.5,1],{azimuth:0,altitude:.6}],
  ['interior-night',0,0,[1.5,1.5,1],{azimuth:0,altitude:-.6}],
  ['open-night',0,0,[.5,.5,1],{azimuth:0,altitude:-.6}],
  ['roof-at-10m',1,10,[1.5,1.5,1],{azimuth:0,altitude:.6}],
  ['wall-outward-5m',2,5,[2+1/64,1.5,1],{azimuth:-Math.PI/2,altitude:.6}],
  ['wall-facing-caster-5m',2,5,[2+1/64,1.5,1],{azimuth:Math.PI/2,altitude:.6}],
 ]){
  const p=[...point,0,0,heightM],plan={points:[p,p],groups:[{start:0,n:1}]},k=gpuKernel(f,plan,core);
  const gpu=await k.measure(0,sun,kind),cpu=core.trace(f,p,core.ray(sun),false,{kind:kind===2?'wall':kind===1?'roof':'ground',heightM});
  witnesses.push({name,cpu:cpu.value,gpu:gpu.values[0]});k.dispose();
 }
 const zero=core.aggregate({groups:[{start:0,n:2}]},[null,null,null,null]);
 const partial=core.aggregate({groups:[{start:0,n:2}]},[1,null,0,1]);
 return {meta,rows,witnesses,zero,partial};
};
