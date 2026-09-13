"""Offline analysis / publication tables; does not acquire more data."""
import csv,gzip,json,math,pathlib
from shapely.geometry import Polygon,Point,MultiPoint,LineString
from shapely.ops import unary_union
P=pathlib.Path(__file__).resolve().parent
rows=json.loads((P/'compression-raw.json').read_text())
with (P/'compression-per-band.csv').open('w') as f:
    w=csv.writer(f);w.writerow(['city','z','x','y','band','codec','raw_band_bytes','unpredicted_compressed_bytes','delta_compressed_bytes','delta_ratio'])
    for r in rows:
        for band,b in r['bands'].items():
            for codec,d in b['delta'].items():w.writerow([r['city'],18,r['x'],r['y'],band,codec,262144,b['raw'][codec]['bytes'],d['bytes'],d['ratio']])
diagnostics=json.loads((P/'diagnostics-summary.json').read_text());fixtures=json.loads((P/'fixtures.json').read_text());tail=[]
for r in diagnostics['fixed4']['severe']:
    fixture=fixtures[r['i']];edge=fixture['edge'];lat=(edge['from'][1]+edge['to'][1])/2;lon=(edge['from'][0]+edge['to'][0])/2
    # Same equirectangular local frame as the painter's geometry helpers.
    mlat=111320;mlon=111320*math.cos(math.radians(lat))
    def xy(lng,lat1):return [(lng-lon)*mlon,(lat1-lat)*mlat]
    a=math.radians(r['azimuthNorthDeg']-180);alt=math.radians(r['altitudeDeg']);sweeps=[];footprints=[]
    for b in fixture['prisms']['prisms']:
        pts=[xy(*p) for p in b['ring']];footprints.append(Polygon(pts));dist=b['heightM']/math.tan(alt);shift=[math.sin(a)*dist,math.cos(a)*dist]
        sweeps.append(MultiPoint(pts+[[p[0]+shift[0],p[1]+shift[1]] for p in pts]).convex_hull)
    shadow=unary_union(sweeps).difference(unary_union(footprints));boundary=shadow.boundary
    polygons=list(shadow.geoms) if shadow.geom_type=='MultiPolygon' else [shadow];segments=[]
    for poly in polygons:
        for ring in [poly.exterior,*poly.interiors]:
            coords=list(ring.coords);segments.extend(LineString([aa,bb]) for aa,bb in zip(coords,coords[1:]) if aa!=bb)
    bad=[]
    for p in r['points']:
        if not p['valid'] or p['candidate']==p['reference']:continue
        pos=Point(xy(p['lng'],p['lat']));closest=min(segments,key=lambda s:s.distance(pos));aa,bb=closest.coords;angle=(math.degrees(math.atan2(bb[0]-aa[0],bb[1]-aa[1]))+360)%180;edgeAngle=r['edgeBearingDeg']%180;difference=abs(angle-edgeAngle);difference=min(difference,180-difference)
        bad.append({**p,'shadowBoundaryDistanceM':boundary.distance(pos),'nearestShadowBoundaryBearingDeg':angle,'boundaryToEdgeAcuteDeg':difference})
    tail.append({**{k:v for k,v in r.items() if k!='points'},'mismatchingPoints':bad})
(P/'tail-geometry.json').write_text(json.dumps(tail,indent=2))
for r in tail:
    print(r['i'],r['side'],'shadowDistance',[round(p['shadowBoundaryDistanceM'],3) for p in r['mismatchingPoints']],'edgeAngle',[round(p['boundaryToEdgeAcuteDeg'],2) for p in r['mismatchingPoints']])
with (P/'tile-table.md').open('w') as f:
    f.write('| Area / z18 x/y | Buildings / canopy | G range, m | Interleaved gzip B | Planar-delta gzip B (ratio) | zstd B (ratio) | Brotli B (ratio) |\n|---|---:|---:|---:|---:|---:|---:|\n')
    for r in rows:
        d=r['layouts']['planarDelta'];cells=[]
        for c in ['gzip6','zstd3','brotli5']:cells.append(f"{d[c]['bytes']:,} ({d[c]['ratio']:.1f}:1)")
        f.write(f"| {r['city']} {r['x']}/{r['y']} | {r['buildingFraction']*100:.1f}% / {r['canopyFraction']*100:.1f}% | {r['groundMinM']:.2f}–{r['groundMaxM']:.2f} | {r['layouts']['interleaved']['gzip6']['bytes']:,} | "+' | '.join(cells)+' |\n')
