"""DMR acquisition, clipping and provenance; no prediction or suitability model."""
import hashlib
import json
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from pyproj import Transformer
from shapely import make_valid, transform
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public/data/habitat/regional-seabed'
ARCHIVE = ROOT / 'data/source'
DMR = 'https://gisportal.dmr.go.th/arcgis/rest/services/ENVI/SEAFLOOR_SURFICIAL_SEDIMENT/MapServer/0'
SEDIMENTS = {
    'Marine Sand Sediment': ('sand', '#edca78'),
    'Muddy Sand Sediment': ('muddy_sand', '#c0a66b'),
    'Marine Mud Sediment': ('mud', '#8b8091'),
    'Sandy Mud Sediment': ('sandy_mud', '#aa9292'),
}

def now():
    return datetime.now(timezone.utc).isoformat()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    temporary.replace(path)


def get(url):
    with tempfile.TemporaryDirectory(prefix='crab-seabed-') as temporary:
        target = Path(temporary) / 'response'
        subprocess.run(['curl', '--fail', '--silent', '--show-error', '--max-time', '60',
                        '--max-filesize', '64000000', url, '-o', str(target)], check=True)
        return target.read_bytes()


def request_json(url, parameters):
    query = url + '?' + urlencode(parameters)
    raw = get(query)
    payload = json.loads(raw)
    if payload.get('error'):
        raise ValueError(f'Provider error: {payload["error"]}')
    return query, raw, payload


def polygons(geom):
    if geom.geom_type in ('Polygon', 'MultiPolygon'):
        return geom
    if geom.geom_type == 'GeometryCollection':
        return unary_union([polygons(g) for g in geom.geoms if g.geom_type in ('Polygon', 'MultiPolygon', 'GeometryCollection')])
    return unary_union([])


def download_dmr(coverage):
    print('DMR: fetching metadata and matching object IDs…', flush=True)
    meta_url, meta_raw, metadata = request_json(DMR, {'f': 'json'})
    aoi = shape(coverage['geometry'])
    west, south, east, north = coverage['bboxWgs84']
    params = {'f': 'json', 'where': '1=1', 'geometry': f'{west},{south},{east},{north}',
              'geometryType': 'esriGeometryEnvelope', 'inSR': '4326',
              'spatialRel': 'esriSpatialRelIntersects', 'returnIdsOnly': 'true'}
    ids_url, ids_raw, listing = request_json(DMR + '/query', params)
    object_ids = sorted(set(listing.get('objectIds') or []))
    if len(object_ids) > 2000:
        raise ValueError('DMR area exceeds bounded feature limit; reduce coverage')
    query_params = {'f': 'geojson', 'objectIds': ','.join(map(str, object_ids)),
                    'outFields': 'OBJECTID,SS_ID,SS_NAME_T,SS_NAME_E,PROVINCE_T,PROVINCE_E,SS_CODE',
                    'outSR': '4326', 'returnGeometry': 'true'}
    if object_ids:
        query_url, raw, data = request_json(DMR + '/query', query_params)
    else:
        query_url = ids_url
        data = {'type': 'FeatureCollection', 'features': []}
        raw = json.dumps(data).encode()
    if data.get('type') != 'FeatureCollection' or data.get('exceededTransferLimit'):
        raise ValueError('DMR response was incomplete')
    actual_ids = {int(f['properties']['OBJECTID']) for f in data['features']}
    if actual_ids != set(object_ids) or len(actual_ids) != len(data['features']):
        raise ValueError('DMR returned missing or duplicate object IDs')
    (ARCHIVE / ('dmr-source-' + sha(raw) + '.geojson')).write_bytes(raw)
    (ARCHIVE / 'dmr-layer-metadata.json').write_bytes(meta_raw)
    (ARCHIVE / 'dmr-object-ids.json').write_bytes(ids_raw)
    projector = Transformer.from_crs(4326, 32647, always_xy=True).transform
    output, repairs = [], []
    areas = defaultdict(list)
    class_info = {}
    for f in data['features']:
        properties = f['properties']
        original = shape(f['geometry'])
        if original.is_empty or original.geom_type not in ('Polygon', 'MultiPolygon'):
            raise ValueError('Invalid DMR feature geometry')
        fixed = not original.is_valid
        geometry = polygons(make_valid(original)) if fixed else original
        clipped = polygons(geometry.intersection(aoi))
        if clipped.is_empty:
            continue
        if not clipped.is_valid:
            raise ValueError('Invalid clipped DMR geometry')
        name = properties.get('SS_NAME_E') or ''
        key, color = SEDIMENTS.get(name, ('unknown', '#96a4aa'))
        class_info[key] = {'nameTh': properties.get('SS_NAME_T') or name or 'ไม่ระบุ', 'nameEn': name, 'color': color}
        projected = transform(clipped, projector, interleaved=False)
        areas[key].append(projected)
        feature_id = 'dmr-' + str(properties['OBJECTID'])
        if fixed:
            repairs.append(feature_id)
        output.append({'type': 'Feature', 'id': feature_id, 'geometry': mapping(clipped), 'properties': {
            **properties, 'id': feature_id, 'classKey': key, 'color': color,
            'clippedAreaM2': round(projected.area, 2), 'geometryRepaired': fixed,
            'source': 'กรมทรัพยากรธรณี', 'labelRole': 'published-sediment-map',
            'observedAt': None, 'fieldVerified': False, 'trainingEligible': False,
            'habitatSuitability': 'unknown'}})
    counts = Counter(f['properties']['classKey'] for f in output)
    manifest = {'source': 'กรมทรัพยากรธรณี (DMR)', 'product': 'ชนิดตะกอนพื้นท้องทะเล', 'status': 'available' if output else 'no-mapped-features',
                'fetchedAt': now(), 'coverage': coverage, 'featureCount': len(output),
                'providerMatchedInBoundingBox': len(object_ids), 'countsByClass': counts,
                'classes': class_info, 'areaM2ByClass': {k: round(unary_union(v).area, 2) for k, v in areas.items()},
                'mappedUnionAreaM2': round(unary_union([g for v in areas.values() for g in v]).area, 2),
                'geometryRepairs': repairs, 'queryUrl': query_url, 'idsQueryUrl': ids_url,
                'metadataUrl': meta_url, 'sourceSha256': sha(raw),
                'geojsonUrl': '/data/habitat/regional-seabed/dmr-sediment.geojson',
                'nominalResolutionMeters': None, 'surveyDate': None, 'mapScale': None,
                'license': 'Not specified in service metadata', 'attribution': 'กรมทรัพยากรธรณี · ชนิดตะกอนพื้นท้องทะเล',
                'locallyFieldVerified': False, 'trainingEligible': False, 'canRecommendCrabHabitat': False,
                'limitations': ['Published regional sediment map; not crab habitat observations.',
                    'Survey dates, nominal spatial resolution and mapping scale are not specified in the layer metadata.',
                    'Do not infer food, shelter, seagrass, C1 occurrence or survival from sediment alone.',
                    'Unmapped areas are unknown; broad polygons do not establish metre-scale substrate detail.',
                    'The service metadata does not specify a reuse licence; retain provider attribution.']}
    # Catalogue details were independently checked against its exact linked service.
    catalogue_path = ARCHIVE / 'dmr-catalogue-summary.json'
    if catalogue_path.exists():
        catalogue = json.loads(catalogue_path.read_text(encoding='utf-8'))
        if catalogue.get('linkedServiceUrl') == DMR.rsplit('/0', 1)[0]:
            manifest.update({'mapScale': catalogue['mapScale'], 'catalogueMetadata': catalogue,
                             'license': 'Creative Commons Attributions (catalogue; version not specified)'})
            manifest['limitations'] = [value for value in manifest['limitations']
                if not value.startswith('Survey dates,') and not value.startswith('The service metadata does not specify')]
            manifest['limitations'] += ['Publisher catalogue states 1:50,000 mapping scale, sampling and grain-size analysis; scale is not a per-point accuracy guarantee.',
                'Per-polygon survey dates and local thematic accuracy remain unverified; catalogue update dates are not survey dates.',
                'Catalogue lists Creative Commons Attributions without a licence version; preserve DMR attribution.']
    write_json(PUBLIC / 'dmr-sediment.geojson', {'type': 'FeatureCollection', 'features': output, 'datasetMetadata': manifest})
    write_json(PUBLIC / 'dmr-manifest.json', manifest)
    print(json.dumps({'DMR': len(output), 'counts': counts}, ensure_ascii=False), flush=True)


