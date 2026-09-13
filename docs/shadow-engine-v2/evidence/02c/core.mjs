export const Q=1/64, R=6378137, C=2*Math.PI*R;
export function project(lng,lat,z){const n=256*2**z;return [(lng+180)/360*n,(.5-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/(2*Math.PI))*n];}
export function inside(x,y,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
// Compact absent/constant bands are allowed by 02 §3.1. Only B varies in this spike.
export function rasterize(objects,z){
 const polygons=objects.map(p=>({...p,rings:(p.rings??[p.ring]).map(r=>r.map(([x,y])=>project(x,y,z)))}));
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of polygons)for(const r of p.rings)for(const [x,y]of r){x0=Math.min(x0,Math.floor(x));x1=Math.max(x1,Math.ceil(x));y0=Math.min(y0,Math.floor(y));y1=Math.max(y1,Math.ceil(y));}
 const w=x1-x0,h=y1-y0,B=new Int32Array(w*h);let maxQ=0;
 for(const p of polygons){const ring=p.rings[0],xs=ring.map(a=>a[0]),ys=ring.map(a=>a[1]),q=Math.round(p.heightM*64);maxQ=Math.max(maxQ,q);
  for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++){
   if(inside(x+.5,y+.5,ring)&&!p.rings.slice(1).some(r=>inside(x+.5,y+.5,r))){const i=(y-y0)*w+x-x0;B[i]=Math.max(B[i],q);}
  }
 }
 return {z,x0,y0,w,h,B,maxQ};
}
export function layout(edges,z,helpers){
 const {sidewalkOffsets,edgeSampleCount,metersPerDegree}=helpers,points=[],groups=[];
 for(const e of edges){const lat=(e.from[1]+e.to[1])/2,m=metersPerDegree(lat),length=Math.hypot((e.to[0]-e.from[0])*m.mPerLng,(e.to[1]-e.from[1])*m.mPerLat),n=edgeSampleCount(length),offsets=sidewalkOffsets(e),start=points.length;
  for(const side of ['left','right'])for(let i=0;i<=n;i++){const lng=e.from[0]+i/n*(e.to[0]-e.from[0])+offsets[side][0],phi=e.from[1]+i/n*(e.to[1]-e.from[1])+offsets[side][1];points.push([...project(lng,phi,z),C*Math.cos(lat*Math.PI/180)/(256*2**z),lng,phi]);}
  groups.push({start,n:n+1});
 }
 return {points,groups};
}
// Direction: fixture SunCalc azimuth -> east=-sin(a), south=cos(a).
export function ray(sun){return {dx:Math.fround(-Math.sin(sun.azimuth)),dy:Math.fround(Math.cos(sun.azimuth)),slope:Math.fround(Math.tan(sun.altitude))};}
// Flat G, no crowns. Global extent/max is a complete bound for this finite snapshot only.
// Positive-length overlap, half-open cells, simultaneous corner advance, origin lift Q.
// Horizon stores max slope at this exact azimuth/receiver; no angular interpolation.
export function trace(f,p,d,horizon=false,receiver={kind:"ground",heightM:0}){
 const [px,py,m]=p,{dx,dy,slope}=d;
 if(receiver.kind==="ground"&&!validGround(f,p))return {value:null,cells:0,valid:false,source:"none",confidence:0};
 if(!horizon&&slope<=0)return {value:1,cells:0,valid:true,source:"none",confidence:1};
 const z0=receiver.heightM+(receiver.kind==="wall"?0:Q);
 const ox=px-f.x0,oy=py-f.y0;
 let lo=0,hi=horizon?Infinity:Math.max(0,(f.maxQ/64-z0)/(m*slope));
 for(const [o,v,size]of [[ox,dx,f.w],[oy,dy,f.h]]){if(v===0){if(o<0||o>=size)return {value:0,cells:0};}else{const a=-o/v,b=(size-o)/v;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}
 if(!(hi>lo))return {value:0,cells:0};
 const sx=Math.sign(dx),sy=Math.sign(dy),xx=ox+dx*lo,yy=oy+dy*lo;
 let x=Math.floor(xx),y=Math.floor(yy);if(dx<0&&xx===x)x--;if(dy<0&&yy===y)y--;
 // Correct floating error at clipped outer boundary, without stepping over interior cells.
 x=Math.max(0,Math.min(f.w-1,x));y=Math.max(0,Math.min(f.h-1,y));
 const tx=dx===0?Infinity:Math.abs(1/dx),ty=dy===0?Infinity:Math.abs(1/dy);
 let nx=dx===0?Infinity:((sx>0?x+1:x)-ox)/dx,ny=dy===0?Infinity:((sy>0?y+1:y)-oy)/dy,t=lo,cells=0,best=0;
 while(t<hi&&x>=0&&y>=0&&x<f.w&&y<f.h){const end=Math.min(nx,ny,hi);if(end>t){cells++;const height=f.B[y*f.w+x]/64;
  if(height>z0){if(horizon){best=Math.max(best,t===0?Infinity:(height-z0)/(t*m));}else if(z0+t*m*slope<height)return {value:1,cells};}
 }
 if(end>=hi)break;
 const advanceX=nx<=ny,advanceY=ny<=nx;if(advanceX){x+=sx;nx+=tx;}if(advanceY){y+=sy;ny+=ty;}t=end;
 }
 return {value:horizon?best:0,cells};
}
export function validGround(f,p){
 const x=Math.floor(p[0])-f.x0,y=Math.floor(p[1])-f.y0;
 return !(x>=0&&y>=0&&x<f.w&&y<f.h&&f.B[y*f.w+x]>0);
}
export function aggregate(plan,values,night=false){
 return plan.groups.map(({start,n})=>{
  const sides={};
  for(const [name,offset] of [['left',0],['right',n]]){
   const available=values.slice(start+offset,start+offset+n).filter(v=>v!==null);
   const fraction=available.length/n;
   sides[name]={shadow:available.length?available.reduce((s,v)=>s+v,0)/available.length:null,
    source:available.length&&!night?'tiles':'none',confidence:available.length?(night?1:.8)*fraction:0,
    validSampleFraction:fraction,validSamples:available.length,totalSamples:n};
  }
  return {left:sides.left.shadow,right:sides.right.shadow,sidewalks:sides,
   validSampleFraction:{left:sides.left.validSampleFraction,right:sides.right.validSampleFraction},
   source:Object.values(sides).some(s=>s.source==='tiles')?'tiles':'none',
   confidence:Math.min(sides.left.confidence,sides.right.confidence),
   buildingSource:night||!Object.values(sides).some(s=>s.validSamples>0)?null:'tiles',canopySources:{osm:false,raster:false}};
 });
}
export function sampleEdges(f,plan,sun){
 const d=ray(sun),values=plan.points.map(p=>trace(f,p,d).value);
 return aggregate(plan,values,sun.altitude<=0);
}
export function stats(a){const s=[...a].sort((a,b)=>a-b);return {n:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,median:s[Math.floor(s.length/2)],p90:s[Math.ceil(.9*s.length)-1],worst:s.at(-1)};}
