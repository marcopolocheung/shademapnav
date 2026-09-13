import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import {fileURLToPath} from 'node:url';
import {createServer} from '../../../../node_modules/vite/dist/node/index.js';import * as core from '../02c/core.mjs';
const p=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(p,'../../../..'),v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
try{
 const helpers={...await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),...await v.ssrLoadModule('/app/lib/shadowField/geometry.ts')},geo=helpers;
 const {agreementFixtures,sunFor}=await v.ssrLoadModule('/app/lib/shadowField/__tests__/agreement/fixtures.ts'),{paintShadowCanvas,reportFor}=await v.ssrLoadModule('/app/lib/shadowField/__tests__/agreement/harness.ts');
 const {sampleBothSidewalks,isBlueDominantShadowPixel}=await v.ssrLoadModule('/app/lib/shadowSampling.ts');
 const fixtures=agreementFixtures(),old=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(p,'../02c/raw-z18.json.gz')))).runs[0];
 fs.writeFileSync(path.join(p,'fixtures.json'),JSON.stringify(fixtures));
 const modes=['fixed4','width-clamp','width-clamp-guard'];const runs={};const cache=new WeakMap();
 const distance=(x,y,ring,m)=>{let best=Infinity;for(let i=1;i<ring.length;i++){const a=[(ring[i-1][0]-x)*m.mPerLng,(ring[i-1][1]-y)*m.mPerLat],b=[(ring[i][0]-x)*m.mPerLng,(ring[i][1]-y)*m.mPerLat],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/(dx*dx+dy*dy)));best=Math.min(best,Math.hypot(a[0]+t*dx,a[1]+t*dy));}return best;};
 for(const mode of modes){const rows=[];
 for(const [i,f] of fixtures.entries()){
  let field=cache.get(f.prisms);if(!field){field=core.rasterize(f.prisms.prisms,18);cache.set(f.prisms,field);}
  const plan=core.layout([f.edge],18,helpers),sun=sunFor(f),m=helpers.metersPerDegree((f.edge.from[1]+f.edge.to[1])/2),dx=(f.edge.to[0]-f.edge.from[0])*m.mPerLng,dy=(f.edge.to[1]-f.edge.from[1])*m.mPerLat,length=Math.hypot(dx,dy),n=plan.groups[0].n;
  const centre=[(f.edge.from[0]+f.edge.to[0])/2,(f.edge.from[1]+f.edge.to[1])/2],widthPx=Math.max(16,Math.ceil((Math.abs(dx)+50)/1.2)),heightPx=Math.max(16,Math.ceil((Math.abs(dy)+50)/1.2));
  const canvas=paintShadowCanvas(f.prisms.prisms,centre,sun,sun.altitudeFraction,{widthPx,heightPx,metresPerPixel:1.2,dpr:2});
  const diagonal=Math.abs(dx)>1e-6&&Math.abs(dy)>1e-6,edgeIndex=Math.floor((i%50)/5),displaced=edgeIndex%2===1;
  const streetWidth={madrid:20,singapore:25,'kent-wa':14}[f.city],available=streetWidth/2-(displaced?3:0),guard=mode==='width-clamp-guard'?plan.points[0][2]*Math.SQRT1_2:0;
  const offset=mode==='fixed4'||diagonal?4:Math.max(0,Math.min(4,available-guard));
  const points=plan.points.map((point,j)=>{const t=(j%n)/(n-1),center=[f.edge.from[0]+t*(f.edge.to[0]-f.edge.from[0]),f.edge.from[1]+t*(f.edge.to[1]-f.edge.from[1])],lng=center[0]+(point[3]-center[0])*offset/4,lat=center[1]+(point[4]-center[1])*offset/4;return [...core.project(lng,lat,18),point[2],lng,lat];});
  const tris=f.prisms.prisms.flatMap(b=>{const t=geo.buildShadowTriangles(b.ring,b.heightM,sun.azimuth,sun.altitude,m.mPerLat,m.mPerLng);return Array.from({length:t.length/3},(_,j)=>t.slice(j*3,j*3+3));});
  const onRoof=(lng,lat)=>f.prisms.prisms.some(b=>geo.pointInPolygon(lng,lat,b.ring));
  const vector=(lng,lat)=>sun.altitude<=0?1:onRoof(lng,lat)?0:Number(tris.some(t=>geo.pointInTriangle(lng,lat,...t)));
  const details=points.map(point=>{const [lng,lat]=point.slice(3),xy=canvas.project(lng,lat),pixel=xy.map(a=>Math.round(a*2)),k=(pixel[1]*widthPx+pixel[0])*4,rgb=Array.from(canvas.imageData.data.slice(k,k+3));
   const pixelLng=centre[0]+(pixel[0]+.5-widthPx/2)*1.2/m.mPerLng,pixelLat=centre[1]-(pixel[1]+.5-heightPx/2)*1.2/m.mPerLat,trace=core.trace(field,point,core.ray(sun));
   const reference=Number(isBlueDominantShadowPixel(...rgb));
   return {lng,lat,valid:core.validGround(field,point),candidate:trace.value,reference,pixel,rgb,pixelLng,pixelLat,pixelShiftM:Math.hypot((pixelLng-lng)*m.mPerLng,(pixelLat-lat)*m.mPerLat),footprintDistanceM:Math.min(...f.prisms.prisms.map(b=>distance(lng,lat,b.ring,m))),onFootprint:onRoof(lng,lat),pixelOnFootprint:onRoof(pixelLng,pixelLat),vectorAtPoint:vector(lng,lat),vectorAtPixel:vector(pixelLng,pixelLat)};});
  // Keep the unchanged inclusive loop, pixel rounding, predicate and denominator behavior.
  let j=0;const reference=sampleBothSidewalks(()=>{const d=details[j++];return d.valid?canvas.project(d.lng,d.lat):[-1,-1];},canvas.imageData,2,f.edge.from,f.edge.to,n-1);
  for(const [side,start]of [['left',0],['right',n]])if(!details.slice(start,start+n).some(d=>d.valid))reference[side]=null;
  const answer=core.aggregate({...plan,points},details.map(d=>d.candidate),sun.altitude<=0)[0];
  const row={i,city:f.city,edgeIndex,diagonal,displaced,when:f.when.toISOString(),edge:f.edge,sun,edgeBearingDeg:(Math.atan2(dx,dy)*180/Math.PI+360)%360,offset,available,guard,reference,answer,points:details,left:Math.abs(answer.left-reference.left),right:Math.abs(answer.right-reference.right)};
  if(mode==='fixed4'){for(const side of ['left','right'])if(reference[side]!==old[i].reference[side]||answer[side]!==old[i].answer[side])throw Error('Baseline differs '+i+' '+side);}
  rows.push(row);
 }
 runs[mode]=rows;console.log(mode,JSON.stringify(reportFor(rows)));
 }
 const summaries={};
 for(const [mode,rows]of Object.entries(runs)){
  const invalid={};for(const city of ['overall','madrid','singapore','kent-wa']){const rs=rows.filter(r=>city==='overall'||r.city===city),ps=rs.flatMap(r=>r.points);invalid[city]={total:ps.length,invalid:ps.filter(d=>!d.valid).length,share:ps.filter(d=>!d.valid).length/ps.length,byEdge:Object.fromEntries([...new Set(rs.map(r=>r.edgeIndex))].map(k=>{const ps=rs.filter(r=>r.edgeIndex===k).flatMap(r=>r.points);return[k,{total:ps.length,invalid:ps.filter(d=>!d.valid).length}];}))};}
  summaries[mode]={report:reportFor(rows),invalid,severe:rows.flatMap(r=>['left','right'].filter(s=>r[s]>.25).map(side=>({i:r.i,city:r.city,side,delta:r[side],edgeIndex:r.edgeIndex,when:r.when,altitudeDeg:r.sun.altitude*180/Math.PI,azimuthNorthDeg:(r.sun.azimuth*180/Math.PI+180)%360,edgeBearingDeg:r.edgeBearingDeg,answer:r.answer[side],reference:r.reference[side],points:r.points.slice(side==='left'?0:r.points.length/2,side==='left'?r.points.length/2:r.points.length)})))};
 }
 fs.writeFileSync(path.join(p,'diagnostics-raw.json.gz'),zlib.gzipSync(JSON.stringify(runs,null,2)));
 fs.writeFileSync(path.join(p,'diagnostics-summary.json'),JSON.stringify(summaries,null,2));
}finally{await v.close();}
