'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import outline from '@/public/demo/ireland-outline.json';
import { mapRiskLabels, type MapListing } from './propertyMapData';
import { clusterMapAreas, constrainCamera, fitMap, locatedMapAreas, mapScale, MAX_MAP_ZOOM, MIN_MAP_ZOOM, worldPoint, zoomMapAt, type MapCamera, type MapSize } from './mapViewport';

const fallbackPath = outline.polygons.map(polygon => polygon.map(ring => ring.map(([lon, lat], index) => { const p = worldPoint(lon, lat); return `${index ? 'L' : 'M'}${p.x},${p.y}`; }).join(' ') + ' Z').join(' ')).join(' ');
const initialCamera = { ...worldPoint(-7.8, 53.4), zoom: 7 };
interface Props { listings: MapListing[]; query: string; focusArea: string; selectedIds: string[]; onSelect: (ids: string[], label: string) => void; onVisible: (ids: string[]) => void }

export default function SlippyPropertyMap({ listings, query, focusArea, selectedIds, onSelect, onVisible }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<MapCamera>(initialCamera);
  const [camera, setCamera] = useState<MapCamera>(initialCamera);
  const [size, setSize] = useState<MapSize>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [failedTiles, setFailedTiles] = useState<Set<string>>(new Set());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ camera: MapCamera; centre: { x: number; y: number }; distance: number } | undefined>(undefined);
  const autoFit = useRef(false);
  const previousQuery = useRef(query);
  const areas = useMemo(() => locatedMapAreas(listings), [listings]);
  const clusters = useMemo(() => clusterMapAreas(areas, camera, size), [areas, camera, size]);
  const scale = mapScale(camera.zoom);
  const left = camera.x * scale - size.width / 2, top = camera.y * scale - size.height / 2;
  const updateCamera = (next: MapCamera) => { const bounded = constrainCamera(next); cameraRef.current = bounded; setCamera(bounded); };
  const fitIreland = () => updateCamera(fitMap([], size));
  const fitReports = () => updateCamera(fitMap(areas, size));
  const zoom = (amount: number, point = { x: size.width / 2, y: size.height / 2 }) => updateCamera(zoomMapAt(cameraRef.current, Math.round(cameraRef.current.zoom) + amount, point, size));

  useEffect(() => {
    const area = areas.find(value => value.name === focusArea);
    if (!area || !size.width) return;
    const next = constrainCamera({ x: area.x, y: area.y, zoom: 14 });
    cameraRef.current = next; setCamera(next);
  }, [focusArea, areas, size.width]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: node.clientWidth, height: node.clientHeight }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size.width) return;
    if ((!autoFit.current && areas.length) || previousQuery.current !== query) {
      const next = fitMap(areas, size); cameraRef.current = next; setCamera(next);
      autoFit.current = areas.length > 0; previousQuery.current = query;
    }
  }, [areas, size, query]);
  useEffect(() => {
    const value = mapScale(camera.zoom);
    onVisible(areas.filter(area => Math.abs((area.x - camera.x) * value) <= size.width / 2 && Math.abs((area.y - camera.y) * value) <= size.height / 2).flatMap(area => area.reports.map(report => report.id)));
  }, [areas, camera, size, onVisible]);
  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || !event.deltaY) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const next = zoomMapAt(cameraRef.current, cameraRef.current.zoom + (event.deltaY < 0 ? 1 : -1), { x: event.clientX - rect.left, y: event.clientY - rect.top }, size);
      cameraRef.current = next; setCamera(next);
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [size]);

  const tileZoom = Math.floor(camera.zoom), tileSize = 256 * 2 ** (camera.zoom - tileZoom);
  const tiles: { key: string; x: number; y: number; url: string }[] = [];
  // Only the current viewport is requested. Native images preserve browser caching
  // and Referer headers required by OSM; no proxy, bulk download or prefetch.
  if (size.width) for (let y = Math.floor(top / tileSize); y <= Math.floor((top + size.height) / tileSize); y++) {
    for (let x = Math.floor(left / tileSize); x <= Math.floor((left + size.width) / tileSize); x++) {
      if (x < 0 || y < 0 || x >= 2 ** tileZoom || y >= 2 ** tileZoom) continue;
      const key = `${tileZoom}/${x}/${y}`;
      tiles.push({ key, x: x * tileSize - left, y: y * tileSize - top, url: `https://tile.openstreetmap.org/${key}.png` });
    }
  }
  const missingTiles = tiles.some(tile => failedTiles.has(tile.key));
  const startGesture = () => {
    const values = [...pointers.current.values()];
    if (!values.length) { gesture.current = undefined; return; }
    const first = values[0], second = values[1] ?? first;
    gesture.current = { camera: cameraRef.current, centre: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: values.length > 1 ? Math.hypot(second.x - first.x, second.y - first.y) : 0 };
  };
  const localPoint = (event: PointerEvent<HTMLDivElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    startGesture(); setDragging(pointers.current.size > 0);
  };
  const activateCluster = (cluster: (typeof clusters)[number]) => {
    const names = cluster.areas.map(area => area.name);
    onSelect(cluster.reports.map(report => report.id), names.length === 1 ? names[0] : `${names.length} nearby areas`);
    if (names.length > 1 && camera.zoom < MAX_MAP_ZOOM) {
      const target = fitMap(cluster.areas, size, MAX_MAP_ZOOM);
      updateCamera({ ...target, zoom: Math.max(Math.min(MAX_MAP_ZOOM, camera.zoom + 1), target.zoom) });
    }
  };
  return <>
    <div className="slippy-toolbar"><div><button type="button" className="button secondary" onClick={fitIreland}>Ireland</button><button type="button" className="button secondary" disabled={!areas.length} onClick={fitReports}>Fit reports</button><button type="button" className="button secondary" onClick={() => updateCamera(fitMap([worldPoint(-6.5, 53.64), worldPoint(-6.05, 53.245)], size, 11))}>Dublin</button></div><span className="muted">Zoom {camera.zoom.toFixed(0)}</span></div>
    <p id="slippy-map-help" className="map-gesture-help">Drag to move · +/− to zoom · Ctrl/⌘ + scroll or pinch · Select a cluster to explore its areas.</p>
    <div ref={viewport} className={`slippy-map${dragging ? ' is-dragging' : ''}`} role="region" aria-label="Interactive rental report map" aria-describedby="slippy-map-help" tabIndex={0} data-zoom={camera.zoom.toFixed(2)} data-centre={`${camera.x.toFixed(7)},${camera.y.toFixed(7)}`}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button, a')) return;
        pointers.current.set(event.pointerId, localPoint(event)); event.currentTarget.setPointerCapture(event.pointerId); startGesture(); setDragging(true);
      }}
      onPointerMove={event => {
        if (!pointers.current.has(event.pointerId) || !gesture.current) return;
        pointers.current.set(event.pointerId, localPoint(event));
        const values = [...pointers.current.values()], first = values[0], second = values[1] ?? first;
        const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const base = gesture.current;
        const distance = Math.hypot(second.x - first.x, second.y - first.y);
        const nextZoom = base.camera.zoom + (base.distance > 0 && distance > 0 ? Math.log2(distance / base.distance) : 0);
        const next = zoomMapAt(base.camera, nextZoom, base.centre, size);
        updateCamera({ ...next, x: next.x - (centre.x - base.centre.x) / mapScale(next.zoom), y: next.y - (centre.y - base.centre.y) / mapScale(next.zoom) });
      }} onPointerUp={releasePointer} onPointerCancel={releasePointer}
      onLostPointerCapture={event => { if (pointers.current.delete(event.pointerId)) { startGesture(); setDragging(pointers.current.size > 0); } }}
      onDoubleClick={event => { if (!(event.target as Element).closest('button, a')) { const rect = event.currentTarget.getBoundingClientRect(); zoom(1, { x: event.clientX - rect.left, y: event.clientY - rect.top }); } }}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['+', '=', '-', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(1);
        else if (event.key === '-') zoom(-1);
        else if (event.key === 'Home') fitIreland();
        else if (event.key.startsWith('Arrow')) { const amount = 80 / mapScale(cameraRef.current.zoom); updateCamera({ ...cameraRef.current, x: cameraRef.current.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0), y: cameraRef.current.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0) }); }
      }}>
      {!!size.width && <svg className="slippy-fallback" viewBox={`${left / scale} ${top / scale} ${size.width / scale} ${size.height / scale}`} preserveAspectRatio="none" aria-hidden="true"><path d={fallbackPath} fill="#E0ECE5" stroke="#7A9588" strokeWidth={1 / scale} fillRule="evenodd" /></svg>}
      <div className="slippy-tiles" aria-hidden="true">{tiles.map(tile => (
        // Native tile images intentionally bypass Next's image proxy and optimization.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={tile.key} src={tile.url} alt="" draggable={false} referrerPolicy="strict-origin-when-cross-origin" width={256} height={256} style={{ left: tile.x, top: tile.y, width: tileSize, height: tileSize, visibility: failedTiles.has(tile.key) ? 'hidden' : 'visible' }} onError={() => setFailedTiles(current => { if (current.has(tile.key)) return current; const next = new Set(current); next.add(tile.key); return next; })} />
      ))}</div>
      {clusters.map(cluster => {
        const level = cluster.reports.some(report => report.level === 'HIGH') ? 'HIGH' : cluster.reports.some(report => report.level === 'MEDIUM') ? 'MEDIUM' : 'LOW';
        const names = cluster.areas.map(area => area.name), name = names.length === 1 ? names[0] : `${names.length} areas`;
        const selected = selectedIds.length === cluster.reports.length && cluster.reports.every(report => selectedIds.includes(report.id));
        return <button key={names.join('|')} type="button" className={`slippy-marker slippy-marker-${level.toLowerCase()}`} style={{ left: cluster.x, top: cluster.y }} data-place={names.join('|')} data-count={cluster.reports.length} data-areas={names.length} aria-label={`${cluster.reports.length} reports in ${names.join(', ')}; highest ${mapRiskLabels[level].toLowerCase()}.${names.length > 1 ? ' Zoom to separate areas.' : ' View evidence.'}`} aria-pressed={selected} onClick={() => activateCluster(cluster)}><span>{cluster.reports.length.toLocaleString('en-IE')}</span><small>{name}</small></button>;
      })}
      <div className="slippy-zoom" aria-label="Map zoom controls"><button type="button" aria-label="Zoom in" disabled={camera.zoom >= MAX_MAP_ZOOM} onClick={() => zoom(1)}>+</button><button type="button" aria-label="Zoom out" disabled={camera.zoom <= MIN_MAP_ZOOM} onClick={() => zoom(-1)}>−</button></div>
      {missingTiles && <p className="slippy-tile-error" role="status">Street tiles unavailable. Area outline and reports still work.</p>}
      <div className="slippy-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Map issue</a></div>
    </div>
    <p className="map-list-status" role="status">{clusters.length} marker{clusters.length === 1 ? '' : 's'} in view · Nearby areas separate as you zoom. Reports sharing an area remain grouped at its approximate centre.</p>
  </>;
}
