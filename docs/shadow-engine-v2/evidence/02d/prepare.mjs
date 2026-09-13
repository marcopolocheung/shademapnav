import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createServer} from '../../../../node_modules/vite/dist/node/index.js';
import * as core from '../02c/core.mjs';
const p=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(p,'../../../..');
const v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'}),original=globalThis.fetch;
const save=(name,obj)=>fs.writeFileSync(path.join(p,name),JSON.stringify(obj,null,2));
try{
 const areas=JSON.parse(fs.readFileSync(path.join(p,'areas.json')));areas['madrid-region']={bbox:[-3.720,40.405,-3.690,40.427]};
 const raw=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(p,'sources/madrid-osm.json.gz'))));
 const roads=raw.elements.filter(e=>/^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$/.test(e.tags?.highway)&&e.tags?.area!=='yes');
 globalThis.fetch=async()=>new Response(JSON.stringify({elements:roads}),{status:200});
 const {fetchRoutingGraph}=await v.ssrLoadModule('/app/lib/overpass.ts'),{snapToGraph,dijkstra}=await v.ssrLoadModule('/app/lib/routing.ts');
 const helpers={...await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),...await v.ssrLoadModule('/app/lib/shadowField/geometry.ts')};
 const graph=await fetchRoutingGraph(40.414,-3.709,40.418,-3.702);globalThis.fetch=original;
 const edges=[],seen=new Set();
 for(const [id,list]of graph.adj)for(const e of list){if(id<0||e.toId<0)continue;const lo=Math.min(id,e.toId),hi=Math.max(id,e.toId),key=lo+','+hi;if(seen.has(key))continue;seen.add(key);const a=graph.nodes.get(lo),b=graph.nodes.get(hi);edges.push({from:[a.lon,a.lat],to:[b.lon,b.lat]});}
 const start=snapToGraph([-3.706459,40.415402],graph),end=snapToGraph([-3.7075,40.4173],graph),route=dijkstra(graph,start,end,0);
 if(!route)throw Error('No route');
 const routeEdges=route.nodeIds.slice(1).map((id,i)=>{const a=graph.nodes.get(route.nodeIds[i]),b=graph.nodes.get(id);return {from:[a.lon,a.lat],to:[b.lon,b.lat]};});
 save('route.json',{capturedAt:new Date().toISOString(),sourceTimestamp:raw.osm3s,roads:roads.length,nodes:graph.nodes.size,edges,routeEdges,routeDistanceM:route.distanceM,routeNodes:route.nodeIds.length,plan:core.layout(edges,18,helpers),routePlan:core.layout(routeEdges,18,helpers)});
 console.log('route',JSON.stringify({roads:roads.length,edges:edges.length,nodes:graph.nodes.size,routeDistanceM:route.distanceM,routeNodes:route.nodeIds.length,points:core.layout(edges,18,helpers).points.length}));
 const {createCogTileSource}=await v.ssrLoadModule('/app/lib/canopyRaster/cogTileSource.ts'),{createCanopyTileStore}=await v.ssrLoadModule('/app/lib/canopyRaster/canopyTileStore.ts');
 let seq=0;const calls=[];
 globalThis.fetch=async(input,opts)=>{
  const url=String(input);if(!url.includes('/meta-chm-v2/chm/'))return original(input,opts);
  const range=new Headers(opts?.headers).get('range'),key=crypto.createHash('sha256').update(url+'|'+range).digest('hex'),base=path.join(p,'sources','chm-'+key);
  if(fs.existsSync(base+'.json')){const m=JSON.parse(fs.readFileSync(base+'.json'));return new Response(fs.readFileSync(base+'.bin'),{status:m.status,headers:m.headers});}
  const t=performance.now(),r=await original(input,opts),bytes=new Uint8Array(await r.arrayBuffer()),meta={url,range,status:r.status,headers:Object.fromEntries(r.headers),bytes:bytes.length,ms:performance.now()-t,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),capturedAt:new Date().toISOString()};
  fs.writeFileSync(base+'.bin',bytes);fs.writeFileSync(base+'.json',JSON.stringify(meta,null,2));calls.push(meta);return new Response(bytes,{status:r.status,headers:r.headers});
 };
 for(const [city,area]of Object.entries(areas)){
  if(fs.existsSync(path.join(p,city+'-chm.json')))continue;
  const store=createCanopyTileStore({source:createCogTileSource(),maxAttempts:1}),patch=await store.read(area.bbox,{priority:'route',signal:AbortSignal.timeout(90000)});
  const meta={...patch};for(const [k,a]of Object.entries(patch))if(ArrayBuffer.isView(a)){fs.writeFileSync(path.join(p,city+'-chm-'+k+'.bin'),new Uint8Array(a.buffer,a.byteOffset,a.byteLength));delete meta[k];}
  save(city+'-chm.json',meta);console.log(city,'chm',JSON.stringify(meta));
 }
 save('chm-calls.json',calls);
 const {agreementFixtures}=await v.ssrLoadModule('/app/lib/shadowField/__tests__/agreement/fixtures.ts');save('fixtures.json',agreementFixtures());
}finally{globalThis.fetch=original;await v.close();}
