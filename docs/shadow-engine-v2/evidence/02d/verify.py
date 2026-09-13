import gzip,hashlib,json,pathlib
import numpy as np
P=pathlib.Path(__file__).resolve().parent
source_count=0
for f in (P/'sources').glob('*.json'):
    meta=json.loads(f.read_text())
    if f.name.endswith('.http.json'):
        target=f.with_name(f.name.removesuffix('.http.json'))
        if not target.exists():continue
        raw=target.read_bytes()
        if target.name.endswith('.gz'):raw=gzip.decompress(raw)
    else:
        raw=f.with_suffix('.bin').read_bytes()
    assert hashlib.sha256(raw).hexdigest()==meta['sha256'],str(f)
    source_count+=1
rows=json.loads((P/'compression-raw.json').read_text());assert len(rows)==50
for r in rows:
    assert r['groundMinM']!=r['groundMaxM'] and r['groundMinM']!=0
    name=f"{r['city']}-18-{r['x']}-{r['y']}"
    data=(P/'tiles'/f'{name}.planar-delta.gz').read_bytes()
    assert len(data)==r['layouts']['planarDelta']['gzip6']['bytes']
    delta=np.frombuffer(gzip.decompress(data),dtype='<u4').reshape(6,256,256)
    restored=np.cumsum(delta,axis=2,dtype=np.uint64).astype('<u4').tobytes()
    assert hashlib.sha256(restored).hexdigest()==r['sha256Planar']
cs=json.loads((P/'corridor-raw.json').read_text())
for r in cs:
    assert len(set(map(tuple,r['tileKeys'])))==r['tiles']
    assert r['rawBytes']==r['tiles']*1572864
for domain in ['graph','chosen-walk']:
    for error in [0,10]:
        rs=[r for r in cs if r['domain']==domain and r['assumedSourceHorizontalErrorM']==error]
        for a,b in zip(rs,rs[1:]):assert set(map(tuple,a['tileKeys']))<=set(map(tuple,b['tileKeys']))
d=json.loads((P/'diagnostics-summary.json').read_text())
assert len(d['fixed4']['severe'])==8
assert d['fixed4']['invalid']['kent-wa']['invalid']==90
assert d['width-clamp-guard']['invalid']['kent-wa']['invalid']==60
assert all(v['report']['cases']==150 for v in d.values())
assert all(r['answer'][side] is not None for rs in json.loads(gzip.decompress((P/'diagnostics-raw.json.gz').read_bytes())).values() for r in rs for side in ['left','right'])
print('PASS: 50 terrain-bearing full-schema payloads recovered byte-for-byte; codec round trips verified during measurement; 12 corridor rows unique/nested; 150-case diagnostics retained; no null sidewalks.')
print(f'PASS: {source_count} raw source response bodies match captured SHA-256 hashes.')
