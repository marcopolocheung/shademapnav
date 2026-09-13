"""Read-only public documentation capture; reruns retain existing observations."""
import concurrent.futures, datetime, gzip, hashlib, json, pathlib
import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(__file__).resolve().parent
SOURCES = {
    'aws-terrain': 'https://registry.opendata.aws/terrain-tiles/',
    'joerd-sources': 'https://raw.githubusercontent.com/tilezen/joerd/0b86765156d0612d837548c2cf70376c43b3405c/docs/data-sources.md',
    'joerd-attribution': 'https://raw.githubusercontent.com/tilezen/joerd/0b86765156d0612d837548c2cf70376c43b3405c/docs/attribution.md',
    'joerd-formats': 'https://raw.githubusercontent.com/tilezen/joerd/0b86765156d0612d837548c2cf70376c43b3405c/docs/formats.md',
    'usgs-datums': 'https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model',
    'usgs-accuracy': 'https://www.usgs.gov/faqs/what-vertical-accuracy-3d-elevation-program-3dep-dems',
    'usgs-gmted': 'https://www.usgs.gov/coastal-changes-and-impacts/gmted2010',
    'gmted-report': 'https://pubs.usgs.gov/of/2011/1073/pdf/of2011-1073.pdf',
    'eudem-validation': 'https://ec.europa.eu/eurostat/documents/7116161/7172326/Report-EU-DEM-statistical-validation-August2014.pdf',
    'egg2008': 'https://www.isgeoid.polimi.it/Geoid/Europe/europe2008_g.html',
    'proj-nga': 'https://raw.githubusercontent.com/OSGeo/PROJ-data/master/us_nga/us_nga_README.txt',
    'proj-noaa': 'https://raw.githubusercontent.com/OSGeo/PROJ-data/master/us_noaa/us_noaa_README.txt',
    'copdem-aws': 'https://registry.opendata.aws/copernicus-dem/',
    'copdem-cog': 'https://copernicus-dem-30m.s3.amazonaws.com/readme.html',
    'copdem-product': 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
    'chm-aws': 'https://registry.opendata.aws/dataforgood-fb-forestsv2/',
    'chm-paper': 'https://arxiv.org/html/2603.06382v1',
    'chm-mirror': 'https://raw.githubusercontent.com/taylor-geospatial/meta-chm-v2/main/README.md',
    'chm-mirror-license': 'https://raw.githubusercontent.com/taylor-geospatial/meta-chm-v2/main/source_coop/LICENSE',
    'chm-stac': 'https://data.source.coop/tge-labs/meta-chm-v2/stac/collection.json',
    'overture-buildings': 'https://docs.overturemaps.org/guides/buildings/',
    'overture-schema': 'https://docs.overturemaps.org/schema/reference/buildings/building/',
    'overture-attribution': 'https://docs.overturemaps.org/attribution/',
    'osm-copyright': 'https://www.openstreetmap.org/copyright',
    'odbl': 'https://opendatacommons.org/licenses/odbl/1-0/',
    'ccby': 'https://creativecommons.org/licenses/by/4.0/legalcode.en',
    'overpass-limits': 'https://dev.overpass-api.de/overpass-doc/en/preface/commons.html',
    'maptiler-terms': 'https://www.maptiler.com/terms/cloud/',
    'maptiler-price': 'https://www.maptiler.com/cloud/pricing/',
    'microsoft-buildings': 'https://raw.githubusercontent.com/microsoft/GlobalMLBuildingFootprints/main/README.md',
    'google-buildings': 'https://sites.research.google/gr/open-buildings/',
    'google-temporal': 'https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1',
    'r2-price': 'https://developers.cloudflare.com/r2/pricing/',
    'srtm-product': 'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm-1',
    'arcticdem': 'https://www.pgc.umn.edu/data/arcticdem/',
}

def capture(item):
    key, url = item
    folder = ROOT / 'sources'
    folder.mkdir(exist_ok=True)
    meta_path = folder / (key + '.json')
    if meta_path.exists():
        return json.loads(meta_path.read_text())
    meta = {'id': key, 'url': url, 'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        r = requests.get(url, timeout=40, headers={'User-Agent': 'Umbra-data-source-research/03'})
        headers = {k: v for k, v in r.headers.items() if k.lower() != 'set-cookie'}
        meta.update(status=r.status_code, finalUrl=r.url, headers=headers, bytes=len(r.content), sha256=hashlib.sha256(r.content).hexdigest())
        (folder / (key + '.body.gz')).write_bytes(gzip.compress(r.content, mtime=0))
        if 'pdf' not in r.headers.get('content-type', ''):
            soup = BeautifulSoup(r.text, 'html.parser')
            for node in soup(['script', 'style', 'nav']):
                node.decompose()
            text = soup.get_text('\n', strip=True) if '<html' in r.text.lower() else r.text
            (folder / (key + '.txt')).write_text(text)
    except Exception as exc:
        meta['error'] = str(exc)
    meta_path.write_text(json.dumps(meta, indent=2) + '\n')
    return meta

if __name__ == '__main__':
    # Preserve adaptively discovered sources as well as the initial seed list.
    for existing in (ROOT / 'sources').glob('*.json'):
        record = json.loads(existing.read_text())
        SOURCES.setdefault(record['id'], record['url'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        rows = list(pool.map(capture, SOURCES.items()))
    (ROOT / 'source-manifest.json').write_text(json.dumps(rows, indent=2) + '\n')
    print(json.dumps([{'id': x['id'], 'status': x.get('status'), 'error': x.get('error')} for x in rows], indent=2))
