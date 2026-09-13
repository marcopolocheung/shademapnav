"""D1 planar codecs and D2 geometric acquisition. PYTHONPATH needs shapely."""
import datetime, gzip, hashlib, json, math, pathlib, platform, sys, time
import numpy as np
from PIL import Image
import shapely
from shapely.geometry import Polygon, LineString, MultiPoint, box
from shapely.ops import unary_union
import zstandard, brotli
P=pathlib.Path(__file__).resolve().parent
C=2*math.pi*6378137; N=256*2**18
def project(lon,lat,z=18):
    return ((np.asarray(lon)+180)/360*(256*2**z),(.5-np.arcsinh(np.tan(np.radians(lat)))/(2*math.pi))*(256*2**z))
def coord(x,y): return [np.asarray(x)/N*360-180,np.degrees(np.arctan(np.sinh(math.pi*(1-2*np.asarray(y)/N))))]
def quant(a): return np.floor(np.asarray(a)*64+.5).astype('<i4')
def save(name,obj): P.joinpath(name).write_text(json.dumps(obj,indent=2))
dem={}
for f in (P/'sources').glob('dem-14-*.png'):
    _,_,x,y=f.stem.split('-'); rgb=np.asarray(Image.open(f),dtype=np.float64)
    dem[int(x),int(y)]=rgb[:,:,0]*256+rgb[:,:,1]+rgb[:,:,2]/256-32768
def terrain(x,y):
    # Terrarium values are source pixel centres; bilinear interpolation at canonical vertices.
    x,y=np.broadcast_arrays(np.asarray(x)/16-.5,np.asarray(y)/16-.5)
    ix=np.floor(x).astype(int);iy=np.floor(y).astype(int);dx=x-ix;dy=y-iy
    def get(xx,yy):
        out=np.full(xx.shape,np.nan)
        for tx,ty in set(zip((xx//256).ravel(),(yy//256).ravel())):
            sel=(xx//256==tx)&(yy//256==ty)
            if (tx,ty) not in dem: raise ValueError(f'Missing DEM {tx}/{ty}')
            out[sel]=dem[tx,ty][yy[sel]%256,xx[sel]%256]
        assert np.isfinite(out).all();return out
    return get(ix,iy)*(1-dx)*(1-dy)+get(ix+1,iy)*dx*(1-dy)+get(ix,iy+1)*(1-dx)*dy+get(ix+1,iy+1)*dx*dy
def chm(city,x,y):
    meta=json.loads((P/f'{city}-chm.json').read_text());a=np.fromfile(P/f'{city}-chm-heights.bin',dtype='u1').reshape(meta['height'],meta['width'])
    b=meta['bbox'];x0,y0=project(b[0],b[3]);x1,y1=project(b[2],b[1]);xx,yy=np.broadcast_arrays(x,y)
    ix=np.floor((xx-x0)/(x1-x0)*meta['width']).astype(int);iy=np.floor((yy-y0)/(y1-y0)*meta['height']).astype(int)
    ok=(ix>=0)&(ix<meta['width'])&(iy>=0)&(iy<meta['height'])
    h=a[np.clip(iy,0,meta['height']-1),np.clip(ix,0,meta['width']-1)]
    if meta.get('valid') is not None or (P/f'{city}-chm-valid.bin').exists():
        val=np.fromfile(P/f'{city}-chm-valid.bin',dtype='u1').reshape(a.shape);ok &= val[np.clip(iy,0,a.shape[0]-1),np.clip(ix,0,a.shape[1]-1)]>0
    return h,ok
def buildings(city):
    raw=json.loads(gzip.decompress((P/f'sources/{city}-osm.json.gz').read_bytes()));out=[]
    for e in raw['elements']:
        if not e.get('tags',{}).get('building') or len(e.get('geometry',[]))<4 or e['nodes'][0]!=e['nodes'][-1]:continue
        def positive(k,scale=1):
            try: return max(0,float(e['tags'].get(k,0))*scale)
            except ValueError:return 0
        h=positive('render_height') or positive('height') or positive('building:levels',3) or 10
        x,y=project([a['lon'] for a in e['geometry']],[a['lat'] for a in e['geometry']]);poly=Polygon(zip(x,y))
        if not poly.is_valid:poly=shapely.make_valid(poly)
        # Sample complete original footprint boundary at <= one source DEM pixel (16 lattice cells).
        boundary=poly.boundary;ds=np.linspace(0,boundary.length,max(2,math.ceil(boundary.length/16)+1));ps=[boundary.interpolate(d) for d in ds]
        foundation=float(np.median(terrain([a.x for a in ps],[a.y for a in ps])))
        out.append({'id':e['id'],'poly':poly,'foundation':foundation,'height':h,'roof':int(quant(foundation+h)),'tags':e['tags']})
    return sorted(out,key=lambda b:b['id'])
codecs={'gzip6':(lambda b:gzip.compress(b,compresslevel=6,mtime=0),gzip.decompress),'zstd3':(zstandard.ZstdCompressor(level=3).compress,zstandard.ZstdDecompressor().decompress),'brotli5':(lambda b:brotli.compress(b,quality=5),brotli.decompress)}
def packed(b):
    result={}
    for name,(enc,dec) in codecs.items():
        t=time.perf_counter();c=enc(b);encode=(time.perf_counter()-t)*1000;t=time.perf_counter();back=dec(c);decode=(time.perf_counter()-t)*1000
        assert back==b
        result[name]={'bytes':len(c),'ratio':len(b)/len(c),'encodeMs':encode,'decodeMs':decode}
    return result
def delta(a):
    d=a.view('<u4').copy();d[:,:,1:]=a.view('<u4')[:,:,1:]-a.view('<u4')[:,:,:-1]
    restored=np.cumsum(d,axis=2,dtype=np.uint64).astype('<u4');assert np.array_equal(restored,a.view('<u4'));return d
areas=json.loads((P/'areas.json').read_text());rows=[];allbuildings={}
P.joinpath('tiles').mkdir(exist_ok=True)
for city,area in areas.items():
    bs=buildings(city);allbuildings[city]=bs
    save(city+'-buildings.json',[{k:v for k,v in b.items() if k!='poly'} for b in bs])
    for tx,ty in area['tiles']:
        x=tx*256+np.arange(256)[None,:];y=ty*256+np.arange(256)[:,None];xc,yc=np.broadcast_arrays(x+.5,y+.5)
        gv=quant(terrain(x,y));gc=(gv.astype('f8')+quant(terrain(x+1,y+1)))/128
        B=np.zeros((256,256),dtype='<i4');owner=np.zeros_like(B);hits=[]
        for b in bs:
            if not b['poly'].intersects(box(tx*256,ty*256,(tx+1)*256,(ty+1)*256)):continue
            mask=shapely.contains_xy(b['poly'],xc,yc)&(b['roof']>B)
            if not mask.any():continue
            B[mask]=b['roof'];owner[mask]=len(hits)+1;hits.append(b)
        h,valid=chm(city,xc,yc);assert valid.all()
        ctop=quant(gc+h);cbase=quant(gc+.35*h);cbase=np.maximum(cbase,np.where(B>0,B,quant(gc)));present=(h>0)&(ctop>cbase);ctop=np.where(present,ctop,0).astype('<i4');cbase=np.where(present,cbase,0).astype('<i4')
        # All sources acquired in this tile; recipe tables identify feature/default/inferred-base provenance.
        flags=(np.full(B.shape,4|8|16,dtype='<u4')|((B>0).astype('u4'))|(present.astype('u4')*2)|(present.astype('u4')*32))
        pairs=np.stack([owner.ravel(),present.ravel()],axis=1);unique,inv=np.unique(pairs,axis=0,return_inverse=True);provenance=inv.reshape(B.shape).astype('<u4')
        a=np.stack([gv,B,cbase,ctop,flags,provenance]).astype('<i4');d=delta(a)
        layouts={'interleaved':a.transpose(1,2,0).copy().tobytes(),'planar':a.tobytes(),'planarDelta':d.tobytes()}
        stats={k:packed(b) for k,b in layouts.items()}
        bandnames=['G','B','C0','C1','flags','provenance'];bands={name:{'raw':packed(a[j].tobytes()),'delta':packed(d[j].tobytes())} for j,name in enumerate(bandnames)}
        metadata={'z':18,'x':tx,'y':ty,'shape':[6,256,256],'dtype':'little-endian 32-bit','heightScale':64,'terrain':'Mapzen Terrarium z14; source datum unverified, no certified EGM96 transform','canopy':json.loads((P/f'{city}-chm.json').read_text()),'recipes':[{'building':None if b==0 else {k:v for k,v in hits[int(b)-1].items() if k!='poly'},'canopy':bool(c),'ground':'terrarium-bilinear','crownBasePrior':.35} for b,c in unique.tolist()]}
        metaBytes=json.dumps(metadata,separators=(',',':')).encode();metaPacked=packed(metaBytes)
        key=f'{city}-18-{tx}-{ty}';(P/'tiles'/f'{key}.planar-delta.gz').write_bytes(gzip.compress(layouts['planarDelta'],compresslevel=6,mtime=0));(P/'tiles'/f'{key}.metadata.json').write_bytes(metaBytes)
        row={'city':city,'x':tx,'y':ty,'bytes':a.nbytes,'groundMinM':float(gv.min()/64),'groundMaxM':float(gv.max()/64),'buildingFraction':float((B>0).mean()),'canopyFraction':float(present.mean()),'roofBelowGroundCells':int(((B>0)&(B/64<gc)).sum()),'layouts':stats,'bands':bands,'metadata':metaPacked,'sha256Planar':hashlib.sha256(a.tobytes()).hexdigest()};rows.append(row)
        print(key,'building',round(row['buildingFraction'],3),'gzip',stats['interleaved']['gzip6']['bytes'],'->',stats['planarDelta']['gzip6']['bytes'],flush=True)
save('compression-raw.json',rows)
summaries={}
for city in ['all',*areas]:
    rs=[r for r in rows if city=='all' or r['city']==city];out={'tiles':len(rs),'buildingRange':[min(r['buildingFraction'] for r in rs),max(r['buildingFraction'] for r in rs)],'layouts':{},'bands':{}}
    for layout in ['interleaved','planar','planarDelta']:
        out['layouts'][layout]={}
        for codec in codecs:
            sizes=np.array([r['layouts'][layout][codec]['bytes'] for r in rs]);out['layouts'][layout][codec]={'total':int(sizes.sum()),'mean':float(sizes.mean()),'min':int(sizes.min()),'p50':float(np.median(sizes)),'p90':int(np.sort(sizes)[math.ceil(.9*len(sizes))-1]),'max':int(sizes.max()),'aggregateRatio':len(rs)*1572864/int(sizes.sum()),'withMetadataMean':float(np.mean([r['layouts'][layout][codec]['bytes']+r['metadata'][codec]['bytes'] for r in rs]))}
    for band in rows[0]['bands']:
        out['bands'][band]={codec:{'rawBytes':sum(r['bands'][band]['raw'][codec]['bytes'] for r in rs),'deltaBytes':sum(r['bands'][band]['delta'][codec]['bytes'] for r in rs),'deltaRatio':len(rs)*262144/sum(r['bands'][band]['delta'][codec]['bytes'] for r in rs)} for codec in codecs}
    summaries[city]=out
save('compression-summary.json',summaries)
# D2 follows the literal swept-corridor formula with explicitly finite regional bounds.
route=json.loads((P/'route.json').read_text());region=[-3.720,40.405,-3.690,40.427]
rx0,ry0=project(region[0],region[3]);rx1,ry1=project(region[2],region[1]);xx,yy=np.meshgrid(np.arange(math.floor(rx0/16)*16,rx1+16,16),np.arange(math.floor(ry0/16)*16,ry1+16,16));tops=terrain(xx,yy);terrainUpper=math.ceil(float(tops.max())*64)/64
meta=json.loads((P/'madrid-region-chm.json').read_text());cx0,cy0=project(meta['bbox'][0],meta['bbox'][3]);cx1,cy1=project(meta['bbox'][2],meta['bbox'][1]);xx=cx0+(np.arange(meta['width'])[None,:]+.5)*(cx1-cx0)/meta['width'];yy=cy0+(np.arange(meta['height'])[:,None]+.5)*(cy1-cy0)/meta['height'];h,ok=chm('madrid-region',xx,yy);assert ok.all()
canopyUpper=math.ceil(float((terrain(xx,yy)+h).max())*64)/64
buildingUpper=max(b['roof']/64 for b in allbuildings['madrid']);bound={'terrain':terrainUpper,'building':buildingUpper,'canopy':canopyUpper}
def keys(geom):
    a,b,c,d=geom.bounds;return [[x,y] for y in range(math.floor(b/256),math.floor(d/256)+1) for x in range(math.floor(a/256),math.floor(c/256)+1) if geom.intersects(box(x*256,y*256,(x+1)*256,(y+1)*256))]
counts=[]
for domain,edges,plan in [('graph',route['edges'],route['plan']),('chosen-walk',route['routeEdges'],route['routePlan'])]:
    # Lowest DEM over a dense continuous centre/sidewalk scan, rounded downward. Source error remains unverified.
    gs=[];segments=[]
    for edge,group in zip(edges,plan['groups']):
        ps=plan['points'];i=group['start'];n=group['n'];quad=[ps[i][:2],ps[i+n-1][:2],ps[i+2*n-1][:2],ps[i+n][:2]];segments.append(quad)
        for a,b in [(quad[0],quad[1]),(quad[3],quad[2]),(quad[0],quad[3]),(quad[1],quad[2])]:
            ts=np.linspace(0,1,max(2,math.ceil(math.dist(a,b))+1));gs.extend(terrain(a[0]+ts*(b[0]-a[0]),a[1]+ts*(b[1]-a[1])).tolist())
    low=math.floor(min(gs)*64)/64;scale=min(pt[2] for pt in plan['points']);receiver=unary_union([MultiPoint(q).convex_hull for q in segments]);receiverKeys=keys(receiver)
    for alt in [45,10,3]:
        reaches={k:max(0,v-low)/math.tan(math.radians(alt)) for k,v in bound.items()};reach=max(reaches.values())
        # Exact S2 azimuth 135 deg, zero angular uncertainty. Guard isotropically expands the sweep.
        for error in [0,10]:
            guard=scale*math.sqrt(2)+error;dist=reach/scale;shift=[dist/math.sqrt(2),dist/math.sqrt(2)]
            swept=unary_union([MultiPoint(q+[[a[0]+shift[0],a[1]+shift[1]] for a in q]).convex_hull.buffer(guard/scale,join_style=2) for q in segments]);kk=keys(swept)
            stats={'domain':domain,'altitudeDeg':alt,'receiverLowerM':low,'bounds':bound,'componentReachM':reaches,'guardM':guard,'assumedSourceHorizontalErrorM':error,'tiles':len(kk),'receiverTiles':len(receiverKeys),'tileKeys':kk,'rawBytes':len(kk)*1572864,'withGuttersBytes':len(kk)*1597536,'workerAndGPUBytes':len(kk)*2*1597536,'outsideCapturedRegionTiles':sum(not box(rx0,ry0,rx1,ry1).covers(box(x*256,y*256,(x+1)*256,(y+1)*256)) for x,y in kk),'wireEstimate':{codec:{'meanBytes':len(kk)*summaries['madrid']['layouts']['planarDelta'][codec]['withMetadataMean'],'tileBodyMinBytes':len(kk)*summaries['madrid']['layouts']['planarDelta'][codec]['min'],'tileBodyMaxBytes':len(kk)*summaries['madrid']['layouts']['planarDelta'][codec]['max']} for codec in codecs}}
            counts.append(stats);print('D2',domain,alt,'error',error,'tiles',len(kk),'wire gzip MiB',stats['wireEstimate']['gzip6']['meanBytes']/2**20,flush=True)
save('corridor-raw.json',counts)
save('environment.json',{'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'python':sys.version,'platform':platform.platform(),'numpy':np.__version__,'shapely':shapely.__version__,'zstandard':zstandard.__version__,'brotli':brotli.__version__,'demZoom':14,'latticeZoom':18,'codecs':list(codecs),'boundsScope':region})
