'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ReportView } from './ReportView';
import { errorMessage, isCheckResponse, requestJson, type CheckResponse, type Source } from './contracts';

const areas = ['Rathmines', 'Ranelagh', 'Drumcondra', 'Phibsborough', 'Glasnevin', 'Dublin 8', 'Smithfield', 'Rialto', 'Whitehall', 'Santry', 'Maynooth', 'Athlone', 'Galway City', 'Cork City', 'Limerick City'];
const presets = [
  { title: 'Same payment handle', subtitle: 'A new post, a familiar detail', text: 'Room available in Glasnevin for €450 per month. Group viewing Saturday at 2pm. Contact @dublinroomsnow on Revolut to reserve your spot.', area: 'Glasnevin', kind: 'room', price: '450', bedrooms: '', source: 'facebook' },
  { title: 'Reused photos', subtitle: 'A different listing, the same room', text: 'Bright one-bedroom apartment in Rathmines for €1000 per month. Newly available, bills included. Contact +353 85 000 0199 for a viewing.', area: 'Rathmines', kind: 'whole', price: '1000', bedrooms: '1', source: 'whatsapp' },
  { title: 'An ordinary listing', subtitle: 'A viewing, a normal monthly rent', text: 'Double room in Phibsborough, €950 per month plus bills. Sharing with two postgraduate students. Viewing by appointment this week. Lease available to review at the viewing; no payment requested before viewing.', area: 'Phibsborough', kind: 'room', price: '950', bedrooms: '', source: 'daft' },
] as const;
type Photo = { file: File; url: string; key: string };

export default function CheckForm({ demoEnabled }: { demoEnabled: boolean }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState<Source>('other');
  const [area, setArea] = useState('');
  const [kind, setKind] = useState('room');
  const [bedrooms, setBedrooms] = useState('');
  const [price, setPrice] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [busy, setBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetMissing, setPresetMissing] = useState(false);
  const [result, setResult] = useState<CheckResponse>();
  const [dragging, setDragging] = useState(false);
  const resources = useRef(new Set<string>());
  const presetRequest = useRef<AbortController | null>(null);
  const checkRequest = useRef<AbortController | null>(null);
  const listingInput = useRef<HTMLTextAreaElement>(null);
  const resultAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const urls = resources.current;
    return () => { urls.forEach(URL.revokeObjectURL); presetRequest.current?.abort(); checkRequest.current?.abort(); };
  }, []);
  function removePhotos() { resources.current.forEach(URL.revokeObjectURL); resources.current.clear(); setPhotos([]); }
  function clearForm() {
    presetRequest.current?.abort();
    removePhotos(); setText(''); setSource('other'); setArea(''); setKind('room'); setBedrooms(''); setPrice('');
    setError(''); setPhotoError(''); setResult(undefined); setPresetBusy(false); setPresetMissing(false); setDragging(false);
    listingInput.current?.focus();
  }
  function addPhotos(files: File[]) {
    setPhotoError('');
    if (files.length + resources.current.size > 6) { setPhotoError('Choose up to six photos in total.'); return; }
    const invalid = files.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0);
    if (invalid) { setPhotoError(`${invalid.name}: choose a JPEG, PNG or WebP image up to 5 MB.`); return; }
    if (files.length > 0) setPresetMissing(false);
    const additions = files.map(file => { const url = URL.createObjectURL(file); resources.current.add(url); return { file, url, key: crypto.randomUUID() }; });
    setPhotos(previous => [...previous, ...additions]);
  }
  async function loadPreset(index: number) {
    presetRequest.current?.abort();
    const controller = new AbortController(); presetRequest.current = controller;
    const preset = presets[index];
    setText(preset.text); setArea(preset.area); setKind(preset.kind); setPrice(preset.price); setBedrooms(preset.bedrooms); setSource(preset.source);
    removePhotos(); setPhotoError(''); setError(''); setResult(undefined); setPresetMissing(false); setPresetBusy(index === 1);
    if (index !== 1) return;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20000);
    try {
      const response = await fetch('/demo/reuse.jpg', { signal: controller.signal });
      if (!response.ok) throw new Error('The demo photo is missing. Run the photo preparation script, then select “Reused photos” again.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size === 0) throw new Error('The demo photo could not be loaded. Select the preset again after restoring /demo/reuse.jpg.');
      if (!controller.signal.aborted) addPhotos([new File([blob], 'reuse.jpg', { type: 'image/jpeg' })]);
    } catch (err) {
      if (!controller.signal.aborted || timedOut) { setPhotoError(timedOut ? 'The demo photo took too long to load. Select the demo again to retry.' : errorMessage(err)); setPresetMissing(true); }
    } finally { clearTimeout(timer); if (!controller.signal.aborted || timedOut) setPresetBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || presetBusy || presetMissing) return;
    if (!text.trim() || text.trim().length > 10000) { setError('Paste a listing or message of up to 10,000 characters.'); listingInput.current?.focus(); return; }
    setBusy(true); setError(''); setResult(undefined);
    const controller = new AbortController(); checkRequest.current = controller;
    try {
      const body = new FormData(); body.set('text', text.trim()); body.set('source', source); body.set('kind', kind);
      if (area.trim()) body.set('area', area.trim());
      if (price) body.set('priceEur', price);
      if (bedrooms) body.set('bedrooms', bedrooms);
      photos.forEach(photo => body.append('photos', photo.file));
      const value = await requestJson<CheckResponse>('/api/check', { method: 'POST', body, signal: controller.signal });
      if (!isCheckResponse(value)) throw new Error('The checker returned an incomplete result. Please try again after the backend is updated.');
      setResult(value);
      requestAnimationFrame(() => resultAnchor.current?.focus());
    } catch (err) { if (!controller.signal.aborted) setError(errorMessage(err)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <>
    {demoEnabled && <section className="demo-panel" aria-labelledby="demo-title"><div className="section-heading"><p id="demo-title" className="eyebrow">Try a demo listing</p><span className="chip">Demo mode</span></div><div className="demo-grid">{presets.map((preset, i) => <button key={preset.title} className="demo-button" type="button" disabled={busy || presetBusy} onClick={() => void loadPreset(i)}><span className="demo-number">0{i + 1}</span><strong>{preset.title}</strong><span>{preset.subtitle}</span><span className="demo-arrow" aria-hidden="true">↗</span></button>)}</div><p className="muted demo-note">Presets fill the form. Every verdict comes from the checker.</p></section>}
    <form className="panel check-form" onSubmit={submit} aria-busy={busy || presetBusy}>
      <div className="section-heading"><h2>Let’s take a closer look.</h2><span className="chip">No account needed</span></div>
      <fieldset disabled={busy || presetBusy}>
        <label htmlFor="listing">Paste the listing or chat message <span className="required">*</span></label>
        <textarea ref={listingInput} id="listing" name="text" required maxLength={10000} value={text} onChange={event => setText(event.target.value)} placeholder="Room in Dublin, €650 a month. Landlord is abroad and asks for a deposit before viewing…" rows={6} aria-describedby="listing-help listing-count" />
        <div className="field-guidance"><p id="listing-help" className="field-help">Include the description and any contact or payment details you want checked.</p><span id="listing-count" className="field-help character-count">{text.length.toLocaleString('en-IE')} / 10,000</span></div>
        <div className="form-grid"><div><label htmlFor="source">Found on</label><select id="source" value={source} onChange={e => setSource(e.target.value as Source)}><option value="other">Other / unspecified</option><option value="facebook">Facebook</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="daft">Daft</option></select></div><div><label htmlFor="area">Area <span className="optional">optional</span></label><input id="area" list="suggested-areas" maxLength={100} value={area} placeholder="Type an area" onChange={e => setArea(e.target.value)} /><datalist id="suggested-areas">{areas.map(a => <option key={a} value={a} />)}</datalist></div><div><label htmlFor="kind">Property</label><select id="kind" value={kind} onChange={e => setKind(e.target.value)}><option value="room">Room</option><option value="whole">Whole property</option></select></div><div><label htmlFor="price">Monthly rent (€)</label><input id="price" type="number" min="0.01" max="100000" step="0.01" value={price} placeholder="Unspecified" onChange={e => setPrice(e.target.value)} /></div><div><label htmlFor="bedrooms">Bedrooms</label><input id="bedrooms" type="number" min="0" max="20" step="1" value={bedrooms} placeholder="Unspecified" aria-describedby="bedrooms-help" onChange={e => setBedrooms(e.target.value)} /><p id="bedrooms-help" className="field-help">Use 0 for a studio.</p></div></div>
        <label htmlFor="photos">Listing photos <span className="optional">optional</span></label>
        <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !presetBusy) addPhotos(Array.from(e.dataTransfer.files)); }}>
          <span className="upload-icon" aria-hidden="true">＋</span><strong>Look familiar? Add the photos.</strong><span>Drag photos here or choose files</span><input id="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help photo-errors" onChange={e => { addPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div><p id="photo-help" className="field-help">Up to 6 photos · JPEG, PNG or WebP · 5 MB each</p>
        <div id="photo-errors">{photoError && <p className="notice error" role="alert">{photoError}</p>}</div>
        {photos.length > 0 && <ul className="photo-previews">{photos.map(photo => <li key={photo.key}><Image unoptimized width={112} height={80} src={photo.url} alt={`Attachment: ${photo.file.name}`} /><span>{photo.file.name}</span><button type="button" className="remove-photo" aria-label={`Remove ${photo.file.name}`} onClick={() => { URL.revokeObjectURL(photo.url); resources.current.delete(photo.url); setPhotos(previous => previous.filter(p => p.key !== photo.key)); }}>×</button></li>)}</ul>}
      </fieldset>
      <button type="button" className="button secondary small clear-form" disabled={busy || presetBusy} onClick={clearForm}>Clear form</button>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="submit-row"><p>We connect the dots.<br /><strong>You decide your next step.</strong></p><button className="button primary" type="submit" disabled={busy || presetBusy || presetMissing}>{busy ? 'Checking the evidence…' : presetBusy ? 'Loading demo photo…' : <>Check it <span aria-hidden="true">→</span></>}</button></div>
      <p className="sr-only" role="status">{busy ? 'Checking your listing. Please wait.' : presetBusy ? 'Loading the demo photo.' : result ? 'Check complete. Your verdict is below.' : ''}</p>
    </form>
    {result && <div ref={resultAnchor} tabIndex={-1} className="result-anchor"><ReportView key={result.reportId} reportId={result.reportId} initial={result} /></div>}
  </>;
}
