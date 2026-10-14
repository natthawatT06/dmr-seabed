"""Join final predicted positions to the local DMR sediment snapshot."""
import argparse
import json
from pathlib import Path
from dmr_lookup import DMRDataset, DEFAULT_DATASET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True, help='JSON array of predicted point records')
    parser.add_argument('--output', type=Path, required=True, help='.json or .geojson output')
    parser.add_argument('--dataset', type=Path, default=DEFAULT_DATASET)
    args = parser.parse_args()
    points = json.loads(args.input.read_text(encoding='utf-8'))
    if not isinstance(points,list) or len(points)>1000000:
        raise ValueError('Input must be a JSON array with at most 1,000,000 points')
    dataset = DMRDataset(args.dataset)
    output = []
    for point in points:
        if not isinstance(point,dict) or 'longitude' not in point or 'latitude' not in point:
            raise ValueError('Each record needs longitude and latitude')
        output.append({'prediction':point,'dmr':dataset.lookup(point['longitude'],point['latitude'])})
    if args.output.suffix.lower()=='.geojson':
        result = {'type':'FeatureCollection','features':[{'type':'Feature',
            'geometry':{'type':'Point','coordinates':[row['dmr']['longitude'],row['dmr']['latitude']]},
            'properties':row} for row in output]}
    else:
        result = {'datasetSource':'DMR','sourceFetchedAt':dataset.metadata['fetchedAt'],
                  'sourceSha256':dataset.metadata['sourceSha256'],'points':output}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'points':len(output),'output':str(args.output)},ensure_ascii=False))


if __name__ == '__main__':
    main()
