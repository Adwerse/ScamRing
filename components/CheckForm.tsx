'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ReportView } from './ReportView';
import { errorMessage, isCheckResponse, requestJson, type CheckResponse, type Source } from './contracts';
import { detectRent, isLinkOnlyMessage, monthlyRent, postingUrl, type RentPeriod } from './rentInput';

const areas = ['Rathmines', 'Ranelagh', 'Drumcondra', 'Phibsborough', 'Glasnevin', 'Dublin 8', 'Smithfield', 'Rialto', 'Whitehall', 'Santry', 'Maynooth', 'Athlone', 'Galway City', 'Cork City', 'Limerick City'];
const presets = [
  { title: 'Same payment handle', subtitle: 'A new post, a familiar detail', text: 'Room available in Glasnevin for €450 per month. Group viewing Saturday at 2pm. Contact @dublinroomsnow on Revolut to reserve your spot.', area: 'Glasnevin', kind: 'room', price: '450', bedrooms: '', source: 'facebook' },
  { title: 'Reused photos', subtitle: 'A different listing, the same room', text: 'Bright one-bedroom apartment in Rathmines for €1000 per month. Newly available, bills included. Contact +353 85 000 0199 for a viewing.', area: 'Rathmines', kind: 'whole', price: '1000', bedrooms: '1', source: 'whatsapp' },
  { title: 'An ordinary listing', subtitle: 'A viewing, a normal monthly rent', text: 'Double room in Phibsborough, €950 per month plus bills. Sharing with two postgraduate students. Viewing by appointment this week. Lease available to review at the viewing; no payment requested before viewing.', area: 'Phibsborough', kind: 'room', price: '950', bedrooms: '', source: 'daft' },
] as const;
type Photo = { file: File; url: string; key: string };

export default function CheckForm({ demoEnabled, intro }: { demoEnabled: boolean; intro?: ReactNode }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<Source>('other');
  const [area, setArea] = useState('');
  const [kind, setKind] = useState('room');
  const [bedrooms, setBedrooms] = useState('');
  const [price, setPrice] = useState('');
  const [rentPeriod, setRentPeriod] = useState<RentPeriod>('monthly');
  const [rentManual, setRentManual] = useState(false);
  const [link, setLink] = useState('');
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetMissing, setPresetMissing] = useState(false);
  const [result, setResult] = useState<CheckResponse>();
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState(false);
  const resources = useRef(new Set<string>());
  const presetRequest = useRef<AbortController | null>(null);
  const checkRequest = useRef<AbortController | null>(null);
  const listingInput = useRef<HTMLTextAreaElement>(null);
  const propertyDetails = useRef<HTMLDetailsElement>(null);
  const photoDetails = useRef<HTMLDetailsElement>(null);
  const linkDetails = useRef<HTMLDetailsElement>(null);
  const rentInput = useRef<HTMLInputElement>(null);
  const detected = detectRent(text);
  const monthly = price ? monthlyRent(Number(price), rentPeriod) : undefined;
  const formatRent = (amount: number) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(amount);
  function invalidateResult() {
    checkRequest.current?.abort(); checkRequest.current = null;
    setBusy(false); setResult(undefined); setError(''); setAnnouncement('');
  }
  function returnToMessage() {
    requestAnimationFrame(() => {
      listingInput.current?.focus({ preventScroll: true });
      listingInput.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  function editRent() { if (propertyDetails.current) propertyDetails.current.open = true; rentInput.current?.focus(); }
  function useDetectedRent() {
    invalidateResult();
    setRentManual(false); setPrice(detected.rent ? String(detected.rent.amount) : ''); setRentPeriod(detected.rent?.period ?? 'monthly');
  }
  function updateMessage(value: string) {
    invalidateResult();
    setText(value); setSelectedPreset(null);
    if (!rentManual) { const detection = detectRent(value); setPrice(detection.rent ? String(detection.rent.amount) : ''); setRentPeriod(detection.rent?.period ?? 'monthly'); }
  }
  useEffect(() => {
    const urls = resources.current;
    return () => { urls.forEach(URL.revokeObjectURL); presetRequest.current?.abort(); checkRequest.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!result) return;
    const frame = requestAnimationFrame(() => {
      const heading = document.getElementById('verdict-title');
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(frame);
  }, [result]);
  function removePhotos() { resources.current.forEach(URL.revokeObjectURL); resources.current.clear(); setPhotos([]); }
  function clearForm() {
    invalidateResult();
    presetRequest.current?.abort();
    presetRequest.current = null;
    removePhotos(); setText(''); setSource('other'); setArea(''); setKind('room'); setBedrooms(''); setPrice('');
    setRentPeriod('monthly'); setRentManual(false); setLink('');
    setSelectedPreset(null);
    setError(''); setPhotoError(''); setResult(undefined); setPresetBusy(false); setPresetMissing(false); setDragging(false);
    if (propertyDetails.current) propertyDetails.current.open = false;
    if (photoDetails.current) photoDetails.current.open = false;
    if (linkDetails.current) linkDetails.current.open = false;
    listingInput.current?.focus();
  }
  function addPhotos(files: File[]) {
    setPhotoError('');
    if (files.length + resources.current.size > 6) { setPhotoError('Choose up to six photos in total.'); return; }
    const invalid = files.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0);
    if (invalid) { setPhotoError(`${invalid.name}: choose a JPEG, PNG or WebP image up to 5 MB.`); return; }
    if (files.length > 0) { invalidateResult(); setPresetMissing(false); }
    const additions = files.map(file => { const url = URL.createObjectURL(file); resources.current.add(url); return { file, url, key: crypto.randomUUID() }; });
    setPhotos(previous => [...previous, ...additions]);
  }
  async function loadPreset(index: number) {
    invalidateResult();
    presetRequest.current?.abort();
    const controller = new AbortController(); presetRequest.current = controller;
    const preset = presets[index];
    setSelectedPreset(index);
    setText(preset.text); setArea(preset.area); setKind(preset.kind); setPrice(preset.price); setBedrooms(preset.bedrooms); setSource(preset.source);
    setRentPeriod('monthly'); setRentManual(false); setLink('');
    removePhotos(); setPhotoError(''); setError(''); setResult(undefined); setPresetMissing(false); setPresetBusy(index === 1);
    if (photoDetails.current) photoDetails.current.open = index === 1;
    if (index !== 1) { setAnnouncement('Example loaded—review it, then check.'); returnToMessage(); return; }
    listingInput.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    let timedOut = false;
    let photoLoaded = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const response = await fetch('/demo/reuse.jpg', { signal: controller.signal });
      if (!response.ok) throw new Error('The demo photo is missing. Run the photo preparation script, then select “Reused photos” again.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size === 0) throw new Error('The demo photo could not be loaded. Select the preset again after restoring /demo/reuse.jpg.');
      if (!controller.signal.aborted && presetRequest.current === controller) {
        addPhotos([new File([blob], 'reuse.jpg', { type: 'image/jpeg' })]); photoLoaded = true;
      }
    } catch (err) {
      if (presetRequest.current === controller && (!controller.signal.aborted || timedOut)) { setPhotoError(timedOut ? 'The demo photo took too long to load. Select the demo again to retry.' : errorMessage(err)); setPresetMissing(true); }
    } finally {
      clearTimeout(timer);
      if (presetRequest.current === controller && (!controller.signal.aborted || timedOut)) {
        setPresetBusy(false);
        setAnnouncement(photoLoaded ? 'Example loaded—review it, then check.' : 'Example text loaded. The photo could not be loaded; select this example again before checking.');
        returnToMessage();
      }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || presetBusy || presetMissing) return;
    if (!text.trim() || text.trim().length > 10000) { setError('Paste a listing or message of up to 10,000 characters.'); listingInput.current?.focus(); return; }
    if (isLinkOnlyMessage(text)) { setError('Paste the listing description or chat message as well. A link alone cannot be checked yet.'); listingInput.current?.focus(); return; }
    const originalUrl = link.trim() ? postingUrl(link) : undefined;
    if (link.trim() && !originalUrl) { setError('Use a complete http:// or https:// posting link.'); if (linkDetails.current) linkDetails.current.open = true; return; }
    const message = originalUrl ? `${text.trim()}\n\nOriginal posting: ${originalUrl}` : text.trim();
    if (message.length > 10000) { setError('The message and posting link together must be at most 10,000 characters.'); return; }
    if ((detected.needsReview || detected.rent) && !price) { setError('Confirm the recurring rent amount and payment period before checking.'); editRent(); return; }
    if (price && (!Number.isFinite(monthly) || monthly! <= 0 || monthly! > 100000)) { setError('Enter a rent amount equivalent to more than €0 and at most €100,000 per month.'); editRent(); return; }
    setBusy(true); setError(''); setResult(undefined); setAnnouncement('');
    const controller = new AbortController(); checkRequest.current = controller;
    try {
      const body = new FormData(); body.set('text', message); body.set('source', source); body.set('kind', kind);
      if (area.trim()) body.set('area', area.trim());
      if (monthly !== undefined) body.set('priceEur', String(monthly));
      if (bedrooms) body.set('bedrooms', bedrooms);
      photos.forEach(photo => body.append('photos', photo.file));
      const value = await requestJson<CheckResponse>('/api/check', { method: 'POST', body, signal: controller.signal });
      if (controller.signal.aborted || checkRequest.current !== controller) return;
      if (!isCheckResponse(value)) throw new Error('The checker returned an incomplete result. Please try again after the backend is updated.');
      setResult(value);
    } catch (err) { if (!controller.signal.aborted && checkRequest.current === controller) setError(errorMessage(err)); }
    finally { if (checkRequest.current === controller) { setBusy(false); checkRequest.current = null; } }
  }
  return <>
    <div className="check-workspace">{intro}<div className="check-entry">
    <form className="panel check-form" onSubmit={submit} aria-busy={busy || presetBusy}>
      <div className="section-heading"><div><p className="eyebrow form-kicker">Start with what you have</p><h2>Check a listing</h2></div><span className="chip">No account needed</span></div>
      <fieldset disabled={busy || presetBusy}>
        <label htmlFor="listing">Paste the listing or chat message <span className="required">*</span></label>
        <textarea ref={listingInput} id="listing" name="text" required maxLength={10000} value={text} onChange={event => updateMessage(event.target.value)} placeholder="Room in Dublin, €650 a month. Landlord is abroad and asks for a deposit before viewing…" rows={5} aria-describedby="listing-help listing-count rent-detected" />
        <div className="field-guidance"><p id="listing-help" className="field-help">Include the description and any contact or payment details you want checked.</p><span id="listing-count" className="field-help character-count">{text.length.toLocaleString('en-IE')} / 10,000</span></div>
        <div id="rent-detected" className="rent-detection" aria-live="polite">
          {price && monthly !== undefined && Number.isFinite(monthly) && <><p><strong>{rentManual ? 'Rent set' : 'Detected rent'}: {formatRent(Number(price))} / {rentPeriod === 'weekly' ? 'week' : rentPeriod === 'yearly' ? 'year' : 'month'}</strong>{rentPeriod !== 'monthly' && <span>Equivalent to {formatRent(monthly)} / month for comparison.</span>}{!rentManual && detected.rent?.assumedMonthly && <span>No payment period found; monthly is assumed. Confirm or change it below.</span>}</p><button type="button" className="text-button" onClick={editRent}>Edit rent</button></>}
          {!price && detected.needsReview && <><p>We could not identify one recurring rent amount. Choose the rent and payment period below.</p><button type="button" className="text-button" onClick={editRent}>Add rent</button></>}
        </div>
        <details ref={linkDetails} className="form-details" onInvalidCapture={() => { if (linkDetails.current) linkDetails.current.open = true; }}><summary>Add original posting link <span>{link.trim() ? 'Link added' : 'Optional'}</span></summary><label htmlFor="posting-link">Posting URL</label><input id="posting-link" type="url" maxLength={2000} value={link} placeholder="https://www.daft.ie/..." aria-describedby="posting-link-help" onChange={event => { invalidateResult(); const value = event.target.value; setLink(value); const url = postingUrl(value); if (source === 'other' && url && /(^|\.)daft\.ie$/i.test(new URL(url).hostname)) setSource('daft'); }} /><p id="posting-link-help" className="field-help">The link is included with your submitted message. Paste the listing text and add photos too; we do not import the linked page.</p></details>
        <details ref={propertyDetails} className="form-details" onInvalidCapture={() => { if (propertyDetails.current) propertyDetails.current.open = true; }}><summary>Add rent and property details <span>{area || price || bedrooms || source !== 'other' || kind !== 'room' ? 'Details added' : 'Optional'}</span></summary><p className="field-help">A location and rent help compare the listing with local prices.</p><div className="form-grid"><div><label htmlFor="source">Found on</label><select id="source" value={source} onChange={e => { invalidateResult(); setSource(e.target.value as Source); }}><option value="other">Other / unspecified</option><option value="facebook">Facebook</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="daft">Daft</option></select></div><div><label htmlFor="area">Area <span className="optional">optional</span></label><input id="area" list="suggested-areas" maxLength={100} value={area} placeholder="Type an area" onChange={e => { invalidateResult(); setArea(e.target.value); }} /><datalist id="suggested-areas">{areas.map(a => <option key={a} value={a} />)}</datalist></div><div><label htmlFor="kind">Property</label><select id="kind" value={kind} onChange={e => { invalidateResult(); setKind(e.target.value); }}><option value="room">Room</option><option value="whole">Whole property</option></select></div><div><label htmlFor="price">Rent amount (EUR)</label><input ref={rentInput} id="price" type="number" min="0.01" max={rentPeriod === 'yearly' ? 1200000 : rentPeriod === 'weekly' ? 23076.92 : 100000} step="0.01" value={price} placeholder="Unspecified" aria-describedby="rent-period-help" onChange={e => { invalidateResult(); setPrice(e.target.value); setRentManual(true); }} /></div><div><label htmlFor="rent-period">Payment period</label><select id="rent-period" value={rentPeriod} aria-describedby="rent-period-help" onChange={e => { invalidateResult(); setRentPeriod(e.target.value as RentPeriod); setRentManual(true); }}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select><p id="rent-period-help" className="field-help">Weekly x 52 / 12; yearly / 12. Comparisons use monthly rent.</p>{rentManual && detected.rent && <button type="button" className="text-button" onClick={useDetectedRent}>Use detected rent</button>}</div><div><label htmlFor="bedrooms">Bedrooms</label><input id="bedrooms" type="number" min="0" max="20" step="1" value={bedrooms} placeholder="Unspecified" aria-describedby="bedrooms-help" onChange={e => { invalidateResult(); setBedrooms(e.target.value); }} /><p id="bedrooms-help" className="field-help">Use 0 for a studio.</p></div></div></details>
        <details ref={photoDetails} className="form-details"><summary>Add listing photos <span>{photos.length ? `${photos.length} attached` : 'Optional'}</span></summary>
        <label htmlFor="photos">Listing photos <span className="optional">optional</span></label>
        <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !presetBusy) addPhotos(Array.from(e.dataTransfer.files)); }}>
          <span className="upload-icon" aria-hidden="true">＋</span><strong>Look familiar? Add the photos.</strong><span>Drag photos here or choose files</span><input id="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help photo-errors" onChange={e => { addPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div><p id="photo-help" className="field-help">Up to 6 photos · JPEG, PNG or WebP · 5 MB each</p>
        <div id="photo-errors">{photoError && <p className="notice error" role="alert">{photoError}</p>}</div>
        {photos.length > 0 && <ul className="photo-previews">{photos.map(photo => <li key={photo.key}><Image unoptimized width={112} height={80} src={photo.url} alt={`Attachment: ${photo.file.name}`} /><span>{photo.file.name}</span><button type="button" className="remove-photo" aria-label={`Remove ${photo.file.name}`} onClick={() => { invalidateResult(); URL.revokeObjectURL(photo.url); resources.current.delete(photo.url); setPhotos(previous => previous.filter(p => p.key !== photo.key)); }}>×</button></li>)}</ul>}
        </details>
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="submit-row"><button type="button" className="button secondary small" disabled={busy || presetBusy} onClick={clearForm}>Clear form</button><button className="button primary" type="submit" disabled={busy || presetBusy || presetMissing}>{(busy || presetBusy) && <span className="inline-spinner" aria-hidden="true" />}{busy ? 'Checking the evidence…' : presetBusy ? 'Loading demo photo…' : <>Check listing <span aria-hidden="true">→</span></>}</button></div>
      <p className={announcement ? 'field-help example-status' : 'sr-only'} role="status">{busy ? 'Checking your listing. Please wait.' : presetBusy ? 'Loading the demo photo.' : result ? 'Check complete. Your verdict is below.' : announcement}</p>
    </form>
    {demoEnabled && <section className="demo-panel" aria-labelledby="demo-title"><div className="section-heading"><p id="demo-title" className="eyebrow">Or try a demo listing</p><span className="chip">Demo mode</span></div><div className="demo-grid">{presets.map((preset, i) => <button key={preset.title} className="demo-button" type="button" aria-pressed={selectedPreset === i} disabled={busy || presetBusy} onClick={() => void loadPreset(i)}><span className="demo-number">{selectedPreset === i ? 'Loaded' : `0${i + 1}`}</span><strong>{preset.title}</strong><span>{preset.subtitle}</span></button>)}</div><p className="muted demo-note">Presets fill the form. Every verdict comes from the checker.</p></section>}
    </div></div>
    {result && <div className="result-anchor"><ReportView key={result.reportId} reportId={result.reportId} initial={result} /></div>}
  </>;
}
