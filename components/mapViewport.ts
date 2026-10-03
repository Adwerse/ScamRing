import { mapPlaceForArea, type MapListing } from './propertyMapData';

export interface MapCamera { x: number; y: number; zoom: number }
export interface MapSize { width: number; height: number }
export const MIN_MAP_ZOOM = 6;
export const MAX_MAP_ZOOM = 16;
export function worldPoint(lon: number, lat: number) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return { x: (lon + 180) / 360, y: (1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 };
}
export function mapScale(zoom: number) { return 256 * 2 ** zoom; }
export function constrainCamera(camera: MapCamera): MapCamera {
  // Keep exploration around Ireland and adjacent coastline.
  const west = worldPoint(-12, 57), east = worldPoint(-4, 50);
  return { x: Math.max(west.x, Math.min(east.x, camera.x)), y: Math.max(west.y, Math.min(east.y, camera.y)), zoom: Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, camera.zoom)) };
}
export function fitMap(points: { x: number; y: number }[], size: MapSize, maxZoom = 12): MapCamera {
  const fallback = [worldPoint(-10.8, 55.5), worldPoint(-5.4, 51.35)];
  const entries = points.length ? points : fallback;
  const xs = entries.map(p => p.x), ys = entries.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const zoom = Math.min(maxZoom, Math.floor(Math.log2(Math.min(Math.max(100, size.width - 110) / (256 * Math.max(maxX - minX, .00002)), Math.max(100, size.height - 110) / (256 * Math.max(maxY - minY, .00002))))));
  return constrainCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, zoom });
}
export function zoomMapAt(camera: MapCamera, zoom: number, point: { x: number; y: number }, size: MapSize) {
  const nextZoom = Math.max(MIN_MAP_ZOOM, Math.min(MAX_MAP_ZOOM, zoom));
  const offsetX = point.x - size.width / 2, offsetY = point.y - size.height / 2;
  return constrainCamera({ x: camera.x + offsetX / mapScale(camera.zoom) - offsetX / mapScale(nextZoom), y: camera.y + offsetY / mapScale(camera.zoom) - offsetY / mapScale(nextZoom), zoom: nextZoom });
}
export function locatedMapAreas(listings: MapListing[]) {
  const areas = new Map<string, { name: string; x: number; y: number; reports: MapListing[] }>();
  for (const report of listings) {
    const place = mapPlaceForArea(report.area);
    if (!place) continue;
    const existing = areas.get(place.name);
    if (existing) existing.reports.push(report);
    else areas.set(place.name, { name: place.name, ...worldPoint(place.lon, place.lat), reports: [report] });
  }
  return [...areas.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function clusterMapAreas(areas: ReturnType<typeof locatedMapAreas>, camera: MapCamera, size: MapSize) {
  const scale = mapScale(camera.zoom);
  const clusters: { x: number; y: number; areas: typeof areas; reports: MapListing[] }[] = [];
  for (const area of areas) {
    const x = (area.x - camera.x) * scale + size.width / 2, y = (area.y - camera.y) * scale + size.height / 2;
    if (x < -30 || y < -30 || x > size.width + 30 || y > size.height + 30) continue;
    const existing = clusters.find(cluster => Math.hypot(cluster.x - x, cluster.y - y) < 48);
    if (existing) { const count = existing.areas.length; existing.x = (existing.x * count + x) / (count + 1); existing.y = (existing.y * count + y) / (count + 1); existing.areas.push(area); existing.reports.push(...area.reports); }
    else clusters.push({ x, y, areas: [area], reports: [...area.reports] });
  }
  return clusters;
}
