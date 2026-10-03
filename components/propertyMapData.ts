import type { Level } from './contracts';

export const mapLevels: Level[] = ['LOW', 'MEDIUM', 'HIGH'];
export const mapRiskLabels: Record<Level, string> = { LOW: 'Low suspicion', MEDIUM: 'Medium suspicion', HIGH: 'High suspicion' };
export interface MapListing { id: string; area: string; priceEur: number | null; status: 'pending' | 'confirmed_scam' | 'legit'; score: number; level: Level }
export interface MapResponse { available: boolean; message?: string; listings?: MapListing[]; unscored?: number; truncated?: boolean; updatedAt?: string }
export function isMapResponse(value: unknown): value is MapResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as MapResponse;
  if (v.available === false) return typeof v.message === 'string';
  return v.available === true && Number.isInteger(v.unscored) && v.unscored! >= 0 && typeof v.truncated === 'boolean' && typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) && Array.isArray(v.listings) && v.listings.length <= 1000 && new Set(v.listings.map(r => r?.id)).size === v.listings.length && v.listings.every(r => r && /^[a-f\d]{24}$/i.test(r.id) && typeof r.area === 'string' && (r.priceEur === null || typeof r.priceEur === 'number' && Number.isFinite(r.priceEur) && r.priceEur > 0) && ['pending', 'confirmed_scam', 'legit'].includes(r.status) && mapLevels.includes(r.level) && typeof r.score === 'number' && Number.isFinite(r.score) && r.score >= 0 && r.score <= 100);
}

// Town centres from GeoNames (CC BY 4.0). These are NOT property coordinates.
// Sources and attribution are also visible on the map and in map-sources.json.
export const mapPlaces = [
  { name: 'Dublin', lat: 53.333, lon: -6.249 },
  { name: 'Cork', lat: 51.898, lon: -8.471 },
  { name: 'Limerick', lat: 52.665, lon: -8.623 },
  { name: 'Galway', lat: 53.272, lon: -9.051 },
  { name: 'Waterford', lat: 52.258, lon: -7.112 },
  { name: 'Drogheda', lat: 53.719, lon: -6.348 },
  { name: 'Dundalk', lat: 54, lon: -6.417 },
  { name: 'Navan', lat: 53.653, lon: -6.681 },
  { name: 'Bray', lat: 53.203, lon: -6.098 },
  { name: 'Athlone', lat: 53.422778, lon: -7.937222 },
  { name: 'Maynooth', lat: 53.385, lon: -6.5936111 },
  { name: 'Rathmines', lat: 53.320278, lon: -6.263333 },
  { name: 'Glasnevin', lat: 53.378509, lon: -6.280281 },
  { name: 'Phibsborough', lat: 53.358338, lon: -6.283665 },
  { name: 'Ranelagh', lat: 53.32703, lon: -6.25723 },
  { name: 'Drumcondra', lat: 53.37058, lon: -6.25298 },
  { name: 'Santry', lat: 53.398121, lon: -6.25268 },
  { name: 'Sandymount', lat: 53.328153, lon: -6.222243 },
  { name: 'Clontarf', lat: 53.362436, lon: -6.20822 },
  { name: 'Lucan', lat: 53.35736, lon: -6.44859 },
  { name: 'Crumlin', lat: 53.321544, lon: -6.314386 },
  { name: 'Raheny', lat: 53.386809, lon: -6.180668 },
  { name: 'Malahide', lat: 53.450833, lon: -6.154444 },
  { name: 'Inchicore', lat: 53.340867, lon: -6.330914 },
  { name: 'Blackrock', lat: 53.301, lon: -6.178 },
  { name: 'Donnybrook', lat: 53.313752, lon: -6.222739 },
  { name: 'Sandyford', lat: 53.2747, lon: -6.2253 },
  { name: 'Balbriggan', lat: 53.60846, lon: -6.1831 },
  { name: 'Dundrum', lat: 53.290668, lon: -6.257143 },
  { name: 'Terenure', lat: 53.309722, lon: -6.285278 },
  { name: 'Finglas', lat: 53.389167, lon: -6.296944 },
  { name: 'Clondalkin', lat: 53.324444, lon: -6.397222 },
  { name: 'Rathfarnham', lat: 53.300556, lon: -6.282778 },
  { name: 'Tallaght', lat: 53.286, lon: -6.373 },
  { name: 'Swords', lat: 53.46, lon: -6.218 },
  { name: 'Dún Laoghaire', lat: 53.294, lon: -6.136 },
  { name: 'Ballsbridge', lat: 53.330821, lon: -6.236433 },
  { name: 'Rialto', lat: 53.33625, lon: -6.29718 },
  { name: 'Smithfield', lat: 53.348502, lon: -6.272678 },
  { name: 'Whitehall', lat: 53.382996, lon: -6.240191 },
  // Additional coordinate facts: Getty TGN 7875460, Wikidata Q26882, and the Killiney Wikipedia record.
  { name: 'Leopardstown', lat: 53.2683, lon: -6.1997 },
  { name: 'Stillorgan', lat: 53.288806, lon: -6.195806 },
  { name: 'Killiney', lat: 53.2651, lon: -6.1137 },
  // Routing-area centres, not property positions. Citywest uses its wider D24 area.
  { name: 'Dublin 8', lat: 53.335, lon: -6.273 },
  { name: 'Dublin 24', lat: 53.285, lon: -6.371 },
];
const normalise = (area: string) => area.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dublinAreas = new Set(['sandymount', 'rathfarnham', 'clontarf', 'lucan', 'leopardstown', 'crumlin', 'raheny', 'malahide', 'inchicore', 'blackrock', 'killiney', 'donnybrook', 'sandyford', 'balbriggan', 'dundrum', 'terenure', 'finglas', 'clondalkin', 'drumcondra', 'santry', 'rathmines', 'stillorgan', 'ballsbridge', 'ranelagh', 'citywest', 'glasnevin', 'phibsborough', 'smithfield', 'rialto', 'whitehall']);
export function mapPlaceForArea(area: string) {
  const name = normalise(area);
  if (/^citywest(?: dublin(?: 24)?)?$/.test(name)) return mapPlaces.find(place => place.name === 'Dublin 24');
  const town = mapPlaces.find(place => name === normalise(place.name) || name === `${normalise(place.name)} city` || name === `${normalise(place.name)} dublin` || name === `${normalise(place.name)} dublin 24`);
  if (town) return town;
  const neighbourhood = name.replace(/ dublin(?: [0-9]{1,2}w?)?$/, '');
  const specific = mapPlaces.find(place => normalise(place.name) === neighbourhood);
  if (specific) return specific;
  if (/^dublin(?: (?:city|[0-9]{1,2}w?))?$/.test(name) || dublinAreas.has(neighbourhood)) return mapPlaces[0];
  return undefined;
}

// Equirectangular projection corrected for Ireland's latitude. SVG units, not metres.
export function projectIreland(lon: number, lat: number): [number, number] {
  return [(lon + 10.9) * 85, (55.65 - lat) * 142];
}
