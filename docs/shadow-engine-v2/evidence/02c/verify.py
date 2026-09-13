import pathlib,json,gzip,hashlib,re,subprocess
p=pathlib.Path(__file__).resolve().parent
root=p.parents[3]
def read(name):
    f=p/name
    return json.loads(f.read_text() if f.exists() else gzip.decompress((p/(name+'.gz')).read_bytes()))
meta=read('run-metadata.json')
for name,want in meta['inputs'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest()==want,name
print('Settled inputs and recorded application source hashes unchanged.')
for name in ['app/lib/shadowField/__tests__/agreement/agreement.test.ts','app/lib/shadowField/__tests__/agreement/harness.ts','app/lib/shadowField/__tests__/agreement/fixtures.ts','app/lib/shadowSampling.ts']:
    committed=subprocess.check_output(['git','show','HEAD:'+name],cwd=root)
    assert committed==(root/name).read_bytes(),name
print('Assertion file, original harness/painter, fixture source and pixel sampler match HEAD.')
gpu=read('gpu-raw.json')
for z in [17,18,19]:
    rows=read(f'raw-z{z}.json')['runs'][0]
    assert len(rows)==150
    for g in (g for g in gpu['rows'] if g['z']==z):
        r=rows[g['i']]
        assert g['cpu']==r['answer']==g['gpu']
        for i,pt in enumerate(r['referenceSamples']['points']):
            assert pt['valid']==(g['cpuValues'][i] is not None)
            assert g['cpuValues'][i]==g['gpuValues'][i]
        for side,pts in [('left',r['referenceSamples']['points'][:len(g['cpuValues'])//2]),('right',r['referenceSamples']['points'][len(g['cpuValues'])//2:])]:
            valid=[pt for pt in pts if pt['valid']]
            def blue(pt):
                a,b,c=pt['rgb'];avg=(a+b)/2
                return a+b+c<600 and c-avg>18 and c>avg*1.15
            ref=sum(blue(pt) for pt in valid)/len(valid) if valid else None
            assert ref==r['reference'][side]
print('450 Node/browser/GPU answers, 6060 validity classifications, and valid-only pixel averages verified.')
doc=root/'docs/shadow-engine-v2/02c-lattice.md'
for target in re.findall(r'\]\(([^)]+)\)',doc.read_text()):
    if '://' not in target and not target.startswith('#'):
        assert (doc.parent/target.split('#')[0]).exists(),target
print('All relative document links resolve.')
assert subprocess.check_output(['git','diff','--','app/'],cwd=root)==b''
assert subprocess.check_output(['git','branch','--show-current'],cwd=root).strip()==b'main'
print('No app/ diff; branch remains main.')
