"""Durable source capture; no credentials, app edits, or artificial DEM."""
import concurrent.futures, datetime, gzip, hashlib, io, json, math, pathlib, requests
P = pathlib.Path(__file__).resolve().parent
P.joinpath('sources').mkdir(exist_ok=True)
centres = {'madrid': (-3.7038,40.4168), 'kent': (-122.2348,47.3809)}
def tile(lon,lat,z):
    return ((lon+180)/360*2**z,(.5-math.asinh(math.tan(math.radians(lat)))/(2*math.pi))*2**z)
def coord(x,y,z):
    return [x/2**z*360-180, math.degrees(math.atan(math.sinh(math.pi*(1-2*y/2**z))))]
areas={}
for city,(lon,lat) in centres.items():
    x,y=map(math.floor,tile(lon,lat,18))
    keys=[[xx,yy] for yy in range(y-2,y+3) for xx in range(x-2,x+3)]
    sw,ne=coord(x-2,y+3,18),coord(x+3,y-2,18)
    areas[city]={'centre':[lon,lat],'tiles':keys,'bbox':[sw[0],sw[1],ne[0],ne[1]]}
P.joinpath('areas.json').write_text(json.dumps(areas,indent=2))
def fetch(name,url,query=None):
    dest=P/'sources'/name
    if dest.exists(): return
    start=datetime.datetime.now(datetime.timezone.utc).isoformat()
    r=requests.post(url,data={'data':query},headers={'User-Agent':'Umbra/1.0 (+https://shademapnav.vercel.app)'},timeout=100) if query else requests.get(url,timeout=100)
    raw=r.content
    meta={'url':r.url,'capturedAt':start,'status':r.status_code,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'headers':dict(r.headers),'query':query}
    (P/'sources'/(name+'.http.json')).write_text(json.dumps(meta,indent=2))
    r.raise_for_status()
    if query:
        obj=r.json()
        if 'remark' in obj: raise RuntimeError(obj['remark'])
        dest.write_bytes(gzip.compress(raw,mtime=0))
    else: dest.write_bytes(raw)
    print(name,len(raw),flush=True)
roads='way["highway"~"^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$"]["area"!="yes"](40.414,-3.709,40.418,-3.702);'
query='[out:json][timeout:80];('+roads+'way["building"](40.405,-3.720,40.427,-3.690););out body geom;'
tasks=[('madrid-osm.json.gz','https://overpass-api.de/api/interpreter',query)]
b=areas['kent']['bbox']; q=f'[out:json][timeout:80];way["building"]({b[1]-.002},{b[0]-.003},{b[3]+.002},{b[2]+.003});out body geom;'
tasks.append(('kent-osm.json.gz','https://overpass-api.de/api/interpreter',q))
# z14 source support: ~7.3 m Madrid / 6.5 m Kent delivery samples. Native evidence is not claimed this fine.
for city,a in areas.items():
    b=[-3.720,40.405,-3.690,40.427] if city=='madrid' else a['bbox']
    x0,y0=tile(b[0],b[3],14);x1,y1=tile(b[2],b[1],14)
    for x in range(math.floor(x0)-1,math.floor(x1)+2):
        for y in range(math.floor(y0)-1,math.floor(y1)+2):
            tasks.append((f'dem-14-{x}-{y}.png',f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/14/{x}/{y}.png',None))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(lambda t:fetch(*t),tasks))
