"""Deterministic volume/cost scenarios, not ingestion performance measurements."""
import json, math, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
CIRCUMFERENCE = 2 * math.pi * 6378137

def xy(lon, lat, z=18):
    return ((lon + 180) / 360 * 2**z,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2**z)

bbox = [-3.720, 40.405, -3.690, 40.427]
x0, y0 = xy(bbox[0], bbox[3])
x1, y1 = xy(bbox[2], bbox[1])
nx, ny = math.ceil(x1) - math.floor(x0), math.ceil(y1) - math.floor(y0)
tiles = nx * ny
lat = 40.4168
spacing = CIRCUMFERENCE * math.cos(math.radians(lat)) / (256 * 2**18)
cells = tiles * 256**2
body_estimate = tiles * 26297.16  # 02d Madrid gzip + external recipe estimate
full_region = {
    'bbox': bbox, 'z': 18, 'tileColumns': nx, 'tileRows': ny, 'tiles': tiles,
    'cells': cells, 'spacingMetresAtCentre': spacing,
    'fullTileAreaKm2Approx': cells * spacing**2 / 1e6,
    'six32BitBandsBytes': cells * 24,
    'gzipWithRecipesBytesScenario': body_estimate,
    'leafBoundsFourFloat64Bytes': tiles * 4 * 8,
    'r2StorageUSDPerMonthScenario': body_estimate / 1e9 * .015,
    'r2ClassAUSDScenario': tiles / 1e6 * 4.5,
    'processingUSDPerHourScenarioFrom02b': 32.19 / 720,
    'runtime': 'UNMEASURED',
    'exclusions': 'Bounds expansion outside bbox, object metadata, masks/provenance tables, retries, raw source retention, geoid grids, scratch, labour, egress from compute provider.'
}
result = {
    'method': 'Spherical Web Mercator tile coverage; byte arithmetic. Prices are scenarios before account-wide free allowances.',
    'region': full_region,
    'terrainZooms': [{'z': z, 'projectedSpacingMetres': CIRCUMFERENCE / (256 * 2**z),
                       'madridGroundSpacingMetres': CIRCUMFERENCE * math.cos(math.radians(lat)) / (256 * 2**z)} for z in range(16)],
    'chm': {'baseDimension': 32768, 'baseU8Bytes': 32768**2,
            'packedBaseMaskBytes': 32768**2 // 8,
            'sampledMadridObjectBytes': 84604237,
            'projectedSpacingMetres': CIRCUMFERENCE / (2**10 * 32768),
            'madridGroundSpacingMetres': CIRCUMFERENCE * math.cos(math.radians(lat)) / (2**10 * 32768)}
}
(ROOT / 'calculations.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result['region'], indent=2))
