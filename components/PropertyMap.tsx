'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import SlippyPropertyMap from './SlippyPropertyMap';
import { errorMessage, priceLabel, requestJson, statusLabel, type Level } from './contracts';
import { isMapResponse, mapLevels, mapPlaceForArea, mapPlaces, mapRiskLabels, type MapResponse } from './propertyMapData';

const riskColour = (level: Level) => `var(--risk-${level.toLowerCase()})`;

export default function PropertyMap() {
  const [data, setData] = useState<MapResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<Level[]>([...mapLevels]);
  const [place, setPlace] = useState('');
  const [query, setQuery] = useState('');
  const [pageSize, setPageSize] = useState(20);
  const [selection, setSelection] = useState<{ ids: string[]; label: string }>();
  const [viewIds, setViewIds] = useState<string[]>([]);
  const [onlyInView, setOnlyInView] = useState(false);
  const trackVisible = useCallback((ids: string[]) => setViewIds(ids), []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    requestJson<MapResponse>('/api/under-the-hood/map', { signal: controller.signal }).then(value => {
      if (!isMapResponse(value)) throw new Error('The map returned incomplete data. Try refreshing.');
      if (!controller.signal.aborted) {
        if (!value.available) throw new Error(value.message);
        setData(value);
      }
    }).catch(err => { if (!controller.signal.aborted) setError(errorMessage(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const filtered = useMemo(() => (data?.listings ?? []).filter(report => levels.includes(report.level) && report.area.toLocaleLowerCase('en-IE').includes(query.trim().toLocaleLowerCase('en-IE'))), [data, levels, query]);
  const unmapped = filtered.filter(report => !mapPlaceForArea(report.area));
  const areaReports = place === 'unmapped' ? unmapped : place ? filtered.filter(report => mapPlaceForArea(report.area)?.name === place) : selection ? filtered.filter(report => selection.ids.includes(report.id)) : filtered;
  const visible = onlyInView ? areaReports.filter(report => viewIds.includes(report.id)) : areaReports;
  const selectPlace = (value: string) => { setPlace(value); setSelection(undefined); setPageSize(20); if (value === 'unmapped') setOnlyInView(false); };
  const changeFilters = () => { setPlace(''); setSelection(undefined); setPageSize(20); };
  return <div className="property-map-page">
    <div className="section-heading"><p className="muted">Read-only view of saved MongoDB verdicts.</p><button className="button secondary" disabled={loading} onClick={() => setAttempt(a => a + 1)}>{loading ? 'Loading reports…' : 'Refresh map'}</button></div>
    {loading && <p className="notice" role="status">{data ? 'Refreshing saved verdicts…' : 'Loading saved verdicts…'}</p>}
    {error && <p className="notice error" role="alert">{data ? 'Refresh failed. Previously loaded verdicts remain below. ' : ''}{error}</p>}
    <section className="panel map-filters" aria-label="Filter rental reports">
      <fieldset><legend>Suspicion level</legend><div className="map-risk-options">{mapLevels.map(level => <label key={level}><input type="checkbox" checked={levels.includes(level)} onChange={() => { setLevels(current => current.includes(level) ? current.filter(value => value !== level) : [...current, level]); changeFilters(); }} /><span className="map-risk-dot" style={{ background: riskColour(level) }} aria-hidden="true" />{mapRiskLabels[level]}<span className="map-filter-count">{data?.listings?.filter(report => report.level === level).length ?? 0}</span></label>)}</div></fieldset>
      <div className="map-search"><label htmlFor="map-area-search">Find an area</label><input id="map-area-search" type="search" placeholder="e.g. Rathmines or Galway" maxLength={150} value={query} onChange={event => { setQuery(event.target.value); changeFilters(); }} /></div>
    </section>
    <p className="map-explanation">Explore approximate town and neighbourhood centres. Zoom in to separate nearby areas; the marker colour shows the highest suspicion among its filtered reports. Green means few warning signs found, not a verified safe property. The current seed covers Dublin; other places appear when reports are added.</p>
    {data?.truncated && <p className="notice">Showing the latest 1,000 non-rejected reports. Older checks are outside this view.</p>}
    {!!data?.unscored && <p className="notice">{data.unscored} report{data.unscored === 1 ? '' : 's'} in this sample {data.unscored === 1 ? 'has' : 'have'} no usable saved verdict yet and {data.unscored === 1 ? 'is' : 'are'} not coloured on the map.</p>}
    {data && !data.listings?.length && <p className="notice" role="status">No scored reports yet. Check a listing with an area, then refresh this map. Seed data also needs saved verdicts before it can appear.</p>}
    <div className="property-map-grid">
      <section className="panel geographic-panel" aria-labelledby="ireland-map-title"><div className="section-heading"><div><p className="eyebrow">Area overview</p><h2 id="ireland-map-title">Follow the warning signs.</h2></div><span className="chip">Approximate locations</span></div>
        <SlippyPropertyMap listings={filtered} query={query} focusArea={place} selectedIds={selection?.ids ?? (place ? areaReports.map(report => report.id) : [])} onVisible={trackVisible} onSelect={(ids, label) => { setPlace(''); setSelection({ ids, label }); setPageSize(20); }} />
        <p className="map-attribution">Fallback outline: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> (public domain). Most area centres: <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>), rounded. <a href="/demo/map-sources.json">Additional coordinates and source details</a>.</p>
      </section>
      <section className="panel map-results" aria-labelledby="map-results-title"><p className="eyebrow">Reports behind the markers</p><h2 id="map-results-title">{place === 'unmapped' ? 'Areas to locate.' : place ? `${place} checks.` : selection ? `${selection.label} checks.` : 'The checked listings.'}</h2>
        <label htmlFor="map-town-select">Show reports in</label><select id="map-town-select" value={place} onChange={event => selectPlace(event.target.value)}><option value="">All areas</option>{mapPlaces.map(town => <option key={town.name} value={town.name}>{town.name}</option>)}<option value="unmapped">Areas without a map position</option></select>
        <label className="map-in-view"><input type="checkbox" checked={onlyInView} onChange={event => { setOnlyInView(event.target.checked); setPageSize(20); }} />Only reports in this map view</label>
        <p className="map-list-status" role="status">{visible.length} matching report{visible.length === 1 ? '' : 's'}{(place || selection) && <> · <button type="button" className="text-button" onClick={() => selectPlace('')}>Show all areas</button></>}</p>
        {!!unmapped.length && <p className="map-unmapped">{unmapped.length} matching report{unmapped.length === 1 ? '' : 's'} {unmapped.length === 1 ? 'has' : 'have'} an area we cannot place. <button type="button" className="text-button" onClick={() => selectPlace('unmapped')}>View these reports</button></p>}
        {!visible.length && !loading && <div className="map-empty"><h3>{data ? 'No matching checks.' : 'Waiting for saved reports.'}</h3><p>{data ? onlyInView ? 'Move the map, fit reports, or turn off the map-view filter.' : 'Try another area or suspicion filter, or check a new listing.' : 'Connect the database and refresh to load real verdicts.'}</p><Link href="/" className="button secondary">Check a listing</Link></div>}
        <ul className="map-report-list">{visible.slice(0, pageSize).map(report => <li key={report.id}><div className="map-report-heading"><Link href={`/report/${report.id}`}>{report.area || 'Unknown area'}</Link><span className={`map-level map-level-${report.level.toLowerCase()}`}>{mapRiskLabels[report.level]}</span></div><p>{priceLabel(report.priceEur)} <span>· Score {report.score}/100</span></p><p className="muted">{statusLabel[report.status]}{!mapPlaceForArea(report.area) && ' · Location unavailable'}</p><Link className="map-evidence-link" href={`/report/${report.id}`}>View evidence <span aria-hidden="true">→</span></Link></li>)}</ul>
        {visible.length > pageSize && <button type="button" className="button secondary" onClick={() => setPageSize(count => count + 20)}>Show 20 more reports</button>}
        {data?.updatedAt && <p className="map-updated">{error ? 'Previous snapshot' : 'Loaded'} at {new Date(data.updatedAt).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}. Refresh for newer checks and verdicts.</p>}
      </section>
    </div>
  </div>;
}
