"""Download DMR sediment polygons and keep an immutable processed snapshot."""
import argparse
import json
import math
import shutil
from pyproj import Geod
from shapely.geometry import Polygon, mapping
from dmr_download import ROOT, PUBLIC, ARCHIVE, download_dmr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--radius-km', type=float, default=100)
    parser.add_argument('--center', type=float, nargs=2, default=[100.8125,13.155], metavar=('LON','LAT'))
    args = parser.parse_args()
    if not math.isfinite(args.radius_km) or not 1 <= args.radius_km <= 250:
        parser.error('Radius must be between 1 and 250 km')
    if not all(math.isfinite(v) for v in args.center) or not (99 <= args.center[0] <= 103 and 10 <= args.center[1] <= 15):
        parser.error('Centre must be in the supported Gulf of Thailand region')
    geod = Geod(ellps='WGS84')
    circle = Polygon([geod.fwd(*args.center,bearing,args.radius_km*1000)[:2] for bearing in range(360)])
    coverage = {'kind':'radius','centerWgs84':args.center,'radiusKm':args.radius_km,
                'bboxWgs84':list(circle.bounds),'geometry':mapping(circle),
                'purpose':'sediment-map-search-area'}
    PUBLIC.mkdir(parents=True,exist_ok=True); ARCHIVE.mkdir(parents=True,exist_ok=True)
    download_dmr(coverage)
    manifest = json.loads((PUBLIC/'dmr-manifest.json').read_text(encoding='utf-8'))
    name = manifest['fetchedAt'].replace(':','-').replace('+','_')+'-'+manifest['sourceSha256'][:12]
    snapshot = ROOT/'data/snapshots'/name
    snapshot.mkdir(parents=True,exist_ok=False)
    for filename in ['dmr-sediment.geojson','dmr-manifest.json']:
        shutil.copy2(PUBLIC/filename,snapshot/filename)
    for filename in ['dmr-layer-metadata.json','dmr-object-ids.json','dmr-catalogue-summary.json']:
        if (ARCHIVE/filename).exists(): shutil.copy2(ARCHIVE/filename,snapshot/filename)
    print('Saved snapshot:',snapshot.relative_to(ROOT))


if __name__ == '__main__':
    main()
