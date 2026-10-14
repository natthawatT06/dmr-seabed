"""Point-in-polygon sediment lookup; no suitability/survival prediction."""
import json
import math
from pathlib import Path
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

DEFAULT_DATASET = Path(__file__).resolve().parents[1]/'public/data/habitat/regional-seabed/dmr-sediment.geojson'


class DMRDataset:
    def __init__(self, path=DEFAULT_DATASET):
        data = json.loads(Path(path).read_text(encoding='utf-8'))
        if data.get('type') != 'FeatureCollection': raise ValueError('Dataset must be a FeatureCollection')
        self.features = data['features']
        self.metadata = data['datasetMetadata']
        if len(self.features) != self.metadata['featureCount']:
            raise ValueError('Dataset feature count does not match its manifest')
        self.coverage = shape(self.metadata['coverage']['geometry'])
        self.geometries = [shape(feature['geometry']) for feature in self.features]
        if any(not geom.is_valid for geom in self.geometries):
            raise ValueError('Dataset contains invalid geometries')
        self.index = STRtree(self.geometries)

    def lookup(self, longitude, latitude):
        for value in (longitude,latitude):
            if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):
                raise ValueError('Coordinates must be finite numeric longitude/latitude')
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError('Longitude/latitude outside WGS84 range')
        point = Point(longitude,latitude)
        matches = []
        inside = self.coverage.covers(point)
        if inside:
            for index in self.index.query(point):
                if self.geometries[int(index)].covers(point):
                    properties = self.features[int(index)]['properties']
                    matches.append({key:properties.get(key) for key in
                        ['id','OBJECTID','classKey','SS_NAME_T','SS_NAME_E','PROVINCE_T','SS_CODE','geometryRepaired']})
        matches.sort(key=lambda row:row['id'])
        native_classes = {row['SS_NAME_E'] for row in matches}
        if not inside: status = 'outside-coverage'
        elif not matches: status = 'unmapped'
        elif len(native_classes)>1: status = 'ambiguous'
        elif any(row['classKey']=='unknown' for row in matches): status = 'unrecognized-class'
        else: status = 'mapped'
        return {'longitude':longitude,'latitude':latitude,'status':status,
                'classKey':matches[0]['classKey'] if status=='mapped' else None,
                'sedimentNameTh':matches[0]['SS_NAME_T'] if status=='mapped' else None,
                'matches':matches,'source':'กรมทรัพยากรธรณี (DMR)',
                'sourceFetchedAt':self.metadata['fetchedAt'],'sourceSha256':self.metadata['sourceSha256'],
                'mapScale':self.metadata.get('mapScale'),'fieldVerified':False,
                'habitatSuitability':'unknown','survivalProbability':None}
