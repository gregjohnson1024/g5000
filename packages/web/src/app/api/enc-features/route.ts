import { parseBbox, type Bbox } from '../../../lib/enc-features-bbox';
import { parsePrimaryColour } from '../../../lib/enc-colours';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ENC_DIRECT_BASE =
  'https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/enc_coastal/MapServer';
const BUOY_LAYER_IDS = [4, 5, 6, 7] as const;
const USER_AGENT = 'g5000-marine-router/1.0 (https://g5000.sulabassana.net)';
const FETCH_TIMEOUT_MS = 12_000;

interface GeoJsonFeature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, unknown> & { colourCode?: number };
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

function buildQueryUrl(layerId: number, bbox: Bbox): string {
  const geom = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`;
  const params = new URLSearchParams({
    where: '1=1',
    geometry: geom,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '1000',
    f: 'geojson',
  });
  return `${ENC_DIRECT_BASE}/${layerId}/query?${params.toString()}`;
}

async function fetchLayer(layerId: number, bbox: Bbox): Promise<GeoJsonFeature[]> {
  const url = buildQueryUrl(layerId, bbox);
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`upstream layer ${layerId} → ${res.status}`);
  }
  const body = (await res.json()) as Partial<FeatureCollection>;
  return Array.isArray(body.features) ? body.features : [];
}

function annotate(features: GeoJsonFeature[]): GeoJsonFeature[] {
  return features.map((f) => {
    const raw = f.properties?.COLOUR;
    const colourCode = parsePrimaryColour(typeof raw === 'string' ? raw : undefined);
    return { ...f, properties: { ...f.properties, colourCode } };
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const klass = url.searchParams.get('class');
  if (klass !== 'buoys') {
    return new Response(JSON.stringify({ error: 'unknown class' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const bbox = parseBbox(url.searchParams.get('bbox'));
  if (!bbox) {
    return new Response(JSON.stringify({ error: 'bad bbox' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  const layers = await Promise.all(BUOY_LAYER_IDS.map((id) => fetchLayer(id, bbox)));
  const features = annotate(layers.flat());
  const body: FeatureCollection = { type: 'FeatureCollection', features };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/geo+json',
      'cache-control': 'public, max-age=300',
    },
  });
}
