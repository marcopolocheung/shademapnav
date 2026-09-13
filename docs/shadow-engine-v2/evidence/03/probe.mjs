// Read only IFD/HTTP probes. No raster-band reads, credentials, or app changes.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {fromUrl} from 'geotiff';
const root=new URL('./',import.meta.url), dir=new URL('http/',root);fs.mkdirSync(dir,{recursive:true});
const original=globalThis.fetch, calls=[];
globalThis.fetch=async(input, options)=>{
 const url=String(input), range=new Headers(options?.headers).get('range');
 const id=crypto.createHash('sha256').update(url+' '+range).digest('hex');
 if(fs.existsSync(new URL(id+'.json',dir))){const meta=JSON.parse(fs.readFileSync(new URL(id+'.json',dir)));calls.push(meta);return new Response(fs.readFileSync(new URL(id+'.bin',dir)),{status:meta.status,headers:meta.headers});}
 const r=await original(input,options), body=new Uint8Array(await r.arrayBuffer());
 const meta={url,range,status:r.status,headers:Object.fromEntries(r.headers),bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex'),capturedAt:new Date().toISOString()};
 fs.writeFileSync(new URL(id+'.json',dir),JSON.stringify(meta,null,2));fs.writeFileSync(new URL(id+'.bin',dir),body);calls.push(meta);
 if(r.status===429)throw Error('Rate limited; stopped');
 return new Response(body,{status:r.status,headers:r.headers});
};
const coords={madrid:[-3.7038,40.4168],kent:[-122.2348,47.3809],singapore:[103.8198,1.3521],nairobi:[36.8219,-1.2921],sao_paulo:[-46.6333,-23.5505],jakarta:[106.8456,-6.2088]};
function xyz(lon,lat,z){const n=2**z;return [Math.floor((lon+180)/360*n),Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n)];}
function quad(lon,lat){const [x,y]=xyz(lon,lat,10);return Array.from({length:10},(_,i)=>{const b=9-i;return ((x>>b)&1)+2*((y>>b)&1)}).join('');}
const assets=[];
for(const [name,[lon,lat]] of Object.entries(coords)) assets.push({name:'chm-'+name,url:`https://data.source.coop/tge-labs/meta-chm-v2/chm/${quad(lon,lat)}.tif`,lat});
for(const [name,res] of [['cop30','10'],['cop90','30']]){const key=`Copernicus_DSM_COG_${res}_N40_00_W004_00_DEM`;assets.push({name,url:`https://copernicus-dem-${res==='10'?'30':'90'}m.s3.amazonaws.com/${key}/${key}.tif`,lat:40.4168});}
assets.push({name:'aws-geotiff-madrid',url:'https://s3.amazonaws.com/elevation-tiles-prod/geotiff/13/4011/3088.tif',lat:40.4168});
assets.push({name:'ign-egm08-rednap',url:'https://cdn.proj.org/es_ign_egm08-rednap.tif',lat:40.4168});
const linzItem=JSON.parse(fs.readFileSync(new URL('sources/linz-item.txt',root)));
const linzAsset=Object.values(linzItem.assets).find(a=>a.type?.includes('tiff'));
if(linzAsset)assets.push({name:'linz-dem-AS21',url:new URL(linzAsset.href,'https://nz-elevation.s3-ap-southeast-2.amazonaws.com/new-zealand/new-zealand/dem_1m/2193/AS21.json').href,lat:-34.5});
const rows=[];
for(const a of assets){const row={...a,ifds:[]};try{const t=await fromUrl(a.url,{blockSize:65536,allowFullFile:false});const count=await t.getImageCount();for(let i=0;i<count;i++){const im=await t.getImage(i),d=new Proxy(im.getFileDirectory(),{get:(obj,key)=>obj.getValue(key)});row.ifds.push({index:i,width:im.getWidth(),height:im.getHeight(),newSubfileType:d.NewSubfileType??0,bits:Array.from(d.BitsPerSample??[]),sampleFormat:Array.from(d.SampleFormat??[]),tileWidth:d.TileWidth,tileHeight:d.TileLength,modelPixelScale:d.ModelPixelScale&&Array.from(d.ModelPixelScale),geoKeys:im.getGeoKeys(),gdalMetadata:d.GDAL_METADATA??null,nodata:d.GDAL_NODATA??null,compressedTileBytes:Array.from(await im.getFileDirectory().loadValue('TileByteCounts')??[]).reduce((s,n)=>s+Number(n),0)});}
}catch(e){row.error=String(e)}rows.push(row);console.log(a.name,row.error??row.ifds.map(x=>`${x.width}x${x.height}:${x.newSubfileType}`).join(' '));}
const zooms=[];const oldZooms=fs.existsSync(new URL('terrain-levels.json',root))?JSON.parse(fs.readFileSync(new URL('terrain-levels.json',root))):[];
for(const name of ['madrid','kent','singapore'])for(let z=0;z<=16;z++){const [x,y]=xyz(...coords[name],z),url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;const old=oldZooms.find(t=>t.url===url);if(old){zooms.push({...old,name});continue;}const r=await original(url,{method:'HEAD'});const row={name,z,x,y,url,status:r.status,headers:Object.fromEntries(r.headers),capturedAt:new Date().toISOString()};zooms.push(row);if(r.status===429)throw Error('Rate limited');}
fs.writeFileSync(new URL('raster-metadata.json',root),JSON.stringify({rows,calls},null,2));fs.writeFileSync(new URL('terrain-levels.json',root),JSON.stringify(zooms,null,2));
