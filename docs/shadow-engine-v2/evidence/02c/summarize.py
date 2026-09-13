import pathlib,json,math,gzip,hashlib
p=pathlib.Path(__file__).resolve().parent

def read(name):
    f=p/name
    return json.loads(f.read_text() if f.exists() else gzip.decompress((p/(name+'.gz')).read_bytes()))

def report(rows):
    v=sorted(r[s] for r in rows for s in ['left','right'] if r[s] is not None)
    return dict(cases=len(rows),readings=len(v),meanAbsolute=sum(v)/len(v),p90=v[math.ceil(.9*len(v))-1],worst=max(v),severe=sum(x>.25 for x in v),severeShare=sum(x>.25 for x in v)/len(v),byCity={c:sum(r[s] for r in rows if r['city']==c for s in ['left','right'] if r[s] is not None)/sum(r[s] is not None for r in rows if r['city']==c for s in ['left','right']) for c in ['madrid','singapore','kent-wa']})

results=[]
for z in [17,18,19]:
    raw=read(f'raw-z{z}.json');rows=raw['runs'][0];r=report(rows)
    assert len(raw['runs'])==4 # baseline, canopy baseline, opacity, solid fill
    assert all(report(run)==r for run in raw['runs'])
    invalid={}
    for city in [None,'madrid','singapore','kent-wa']:
        selected=[r for r in rows if city is None or r['city']==city]
        points=[(pt,row['sun']['altitude']>0) for row in selected for pt in row['referenceSamples']['points']]
        n=len(points);bad=sum(not pt['valid'] for pt,_ in points)
        invalid[city or 'overall']=dict(total=n,excluded=bad,valid=n-bad,invalidShare=bad/n,margin=.25-bad/n,daytimeTotal=sum(day for _,day in points),daytimeExcluded=sum(day and not pt['valid'] for pt,day in points),zeroValidSidewalks=sum(row['answer'][side] is None for row in selected for side in ['left','right']))
    worst=[dict(i=row['i'],city=row['city'],when=row['when'],edge=row['edge'],sun=row['sun'],answer=row['answer'],reference=row['reference'],left=row['left'],right=row['right']) for row in rows if row['left']==r['worst'] or row['right']==r['worst']]
    results.append(dict(z=z,report=r,invalid=invalid,worst=worst,margins=dict(mean=.04-r['meanAbsolute'],p90=.05-r['p90'],severe=.04-r['severeShare'],cities={c:.08-v for c,v in r['byCity'].items()})))
(p/'summary.json').write_text(json.dumps(results,indent=2)+'\n')
MiB=2**20
memory=[]
for z in [17,18,19]:
    scale=4**(z-17);tile=256**2*24;gutter=258**2*24
    memory.append(dict(z=z,areaMultiplier=scale,spacing={c:2*math.pi*6378137*math.cos(lat*math.pi/180)/(256*2**z) for c,lat in [('madrid',40.4168),('singapore',1.3521),('kent-wa',47.3809)]},bytesPerCell=24,twoCopiesBytesPerCell=48,tileBytes=tile,tileMiB=tile/MiB,gutterTileBytes=gutter,gutterTileMiB=gutter/MiB,oldTileFootprintBytes=tile*scale,oldTileFootprintMiB=tile*scale/MiB,old2048AreaTiles=64*scale,old2048AreaOneCopyMiB=96*scale,old2048AreaTwoCopiesMiB=192*scale,old2048AreaTwoCopiesGutterMiB=128*scale*gutter/MiB,oldMadridOneCopyMiB=3364*3046*24*scale/MiB,oldMadridTwoCopiesMiB=3364*3046*48*scale/MiB,horizon72OneCopyMiB=576*scale,horizon360OneCopyMiB=2880*scale,scenarioReads=40*scale,scenarioRawMiB=60*scale,scenarioRequiredCompression=3*scale,scenarioMeanCompressedTileKiB=20*1024/(40*scale),scenarioExtrapolatedWireMiB=20*scale))
(p/'memory.json').write_text(json.dumps(memory,indent=2)+'\n')
# Exact raw JSON bytes preserved losslessly. A new execution may recreate uncompressed copies.
for f in sorted(p.glob('*.json')):
    if f.name.startswith('raw-') or f.name=='gpu-raw.json':
        data=f.read_bytes();packed=gzip.compress(data,mtime=0);assert gzip.decompress(packed)==data
        (p/(f.name+'.gz')).write_bytes(packed);f.unlink()
files=[f for f in sorted(p.iterdir()) if f.is_file() and f.name!='SHA256SUMS']
(p/'SHA256SUMS').write_text(''.join(hashlib.sha256(f.read_bytes()).hexdigest()+'  '+f.name+'\n' for f in files))
for r in results:print(r['z'],json.dumps(r['report']),json.dumps(r['invalid']))
print(json.dumps(memory,indent=2))
