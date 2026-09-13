"""Discover registered non-ballpark operations; do not transform or download grids."""
import json, pathlib, pyproj
from pyproj.aoi import AreaOfInterest
from pyproj.transformer import TransformerGroup

rows = []
for name, source, area in [
    ('kent', 5498, (-122.3, 47.3, -122.2, 47.5)),
    ('madrid', 7409, (-3.8, 40.3, -3.6, 40.5)),
    ('copdem', 9518, (-3.8, 40.3, -3.6, 40.5)),
]:
    group = TransformerGroup(source, 9707, always_xy=True,
        area_of_interest=AreaOfInterest(*area), allow_ballpark=False)
    missing = []
    for operation in group.unavailable_operations:
        missing.append({'name': operation.name, 'accuracy': operation.accuracy,
            'grids': [{'name': g.short_name, 'url': g.url,
                       'available': g.available, 'open_license': g.open_license}
                      for g in operation.grids]})
    rows.append({'name': name, 'source': pyproj.CRS(source).name,
        'target': pyproj.CRS(9707).name, 'best_available': group.best_available,
        'available': [{'name': t.description, 'accuracy': t.accuracy} for t in group.transformers],
        'unavailable': missing})
result = {'pyproj': pyproj.__version__, 'proj': pyproj.proj_version_str,
    'networkEnabled': pyproj.network.is_network_enabled(),
    'note': 'Discovery only, no heights transformed. EPSG:7409 is ETRS89+EVRF2000; absence of operations does not prove mathematical impossibility.',
    'rows': rows}
pathlib.Path(__file__).with_name('datum-operations.json').write_text(json.dumps(result, indent=2) + '\n')
