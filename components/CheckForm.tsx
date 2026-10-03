'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ReportView } from './ReportView';
import { errorMessage, isVerdict, requestJson, type CheckResponse, type Source } from './contracts';

const areas = ['Rathmines', 'Ranelagh', 'Drumcondra', 'Phibsborough', 'Glasnevin', 'Dublin 8', 'Smithfield', 'Rialto', 'Whitehall', 'Santry', 'Maynooth', 'Athlone', 'Galway City', 'Cork City', 'Limerick City'];
const presets = [
  { title: 'Same payment handle', subtitle: 'A new post, a familiar detail', text: 'Room available in Glasnevin for €550 per month. Group viewing Saturday at 2pm. Contact @dublinroomsnow on Revolut to reserve your spot.', area: 'Glasnevin', kind: 'room', price: '550', bedrooms: '', source: 'facebook' },
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
  const resultAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const urls = resources.current;
    return () => { urls.forEach(URL.revokeObjectURL); presetRequest.current?.abort(); };
  }, []);
  function removePhotos() { photos.forEach(photo => { URL.revokeObjectURL(photo.url); resources.current.delete(photo.url); }); setPhotos([]); }
  function addPhotos(files: File[]) {
    setPhotoError('');
    if (files.length + photos.length > 6) { setPhotoError('Choose up to six photos in total.'); return; }
    const invalid = files.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || file.size === 0);
    if (invalid) { setPhotoError(`${invalid.name}: choose a JPEG, PNG or WebP image up to 5 MB.`); return; }
    if (files.length > 0) setPresetMissing(false);
    setPhotos(previous => [...previous, ...files.map(file => { const url = URL.createObjectURL(file); resources.current.add(url); return { file, url, key: crypto.randomUUID() }; })]);
  }
  async function loadPreset(index: number) {
    presetRequest.current?.abort();
    const controller = new AbortController(); presetRequest.current = controller;
    const preset = presets[index];
    setText(preset.text); setArea(preset.area); setKind(preset.kind); setPrice(preset.price); setBedrooms(preset.bedrooms); setSource(preset.source);
    removePhotos(); setPhotoError(''); setError(''); setResult(undefined); setPresetMissing(false); setPresetBusy(index === 1);
    if (index !== 1) return;
    try {
      const response = await fetch('/demo/reuse.jpg', { signal: controller.signal });
      if (!response.ok) throw new Error('The demo photo is missing. Run the photo preparation script, then select “Reused photos” again.');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/') || blob.size === 0) throw new Error('The demo photo could not be loaded. Select the preset again after restoring /demo/reuse.jpg.');
      if (!controller.signal.aborted) addPhotos([new File([blob], 'reuse.jpg', { type: 'image/jpeg' })]);
    } catch (err) { if (!controller.signal.aborted) { setPhotoError(errorMessage(err)); setPresetMissing(true); } }
    finally { if (!controller.signal.aborted) setPresetBusy(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || presetBusy || presetMissing) return;
    if (!text.trim()) { setError('Paste a listing or message first.'); return; }
    setBusy(true); setError(''); setResult(undefined);
    try {
      const body = new FormData(); body.set('text', text.trim()); body.set('source', source); body.set('kind', kind);
      if (area) body.set('area', area);
      if (price) body.set('priceEur', price);
      if (bedrooms) body.set('bedrooms', bedrooms);
      photos.forEach(photo => body.append('photos', photo.file));
      const value = await requestJson<CheckResponse>('/api/check', { method: 'POST', body });
      if (!value || !/^[a-f\d]{24}$/i.test(value.reportId) || !isVerdict(value.verdict) || !value.ring || !Number.isFinite(value.ring.size) || !Number.isFinite(value.ring.confirmedCount)) throw new Error('The checker returned an incomplete result. Please try again after the backend is updated.');
      setResult(value);
      requestAnimationFrame(() => resultAnchor.current?.focus());
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }
  return <>
    {demoEnabled && <section className="demo-panel" aria-labelledby="demo-title"><div className="section-heading"><p id="demo-title" className="eyebrow">Try a demo listing</p><span className="chip">Demo mode</span></div><div className="demo-grid">{presets.map((preset, i) => <button key={preset.title} className="demo-button" type="button" disabled={busy || presetBusy} onClick={() => void loadPreset(i)}><span className="demo-number">0{i + 1}</span><strong>{preset.title}</strong><span>{preset.subtitle}</span><span className="demo-arrow" aria-hidden="true">↗</span></button>)}</div><p className="muted demo-note">Presets fill the form. Every verdict comes from the checker.</p></section>}
    <form className="panel check-form" onSubmit={submit}>
      <div className="section-heading"><h2>Let’s take a closer look.</h2><span className="chip">No account needed</span></div>
      <fieldset disabled={busy || presetBusy}>
        <label htmlFor="listing">Paste the listing or chat message <span className="required">*</span></label>
        <textarea id="listing" name="text" required maxLength={20000} value={text} onChange={event => setText(event.target.value)} placeholder="Room in Dublin, €650 a month. Landlord is abroad and asks for a deposit before viewing…" rows={6} aria-describedby="listing-help" />
        <p id="listing-help" className="field-help">Include the description and any contact or payment details you want checked.</p>
        <div className="form-grid"><div><label htmlFor="source">Found on</label><select id="source" value={source} onChange={e => setSource(e.target.value as Source)}><option value="other">Other / unspecified</option><option value="facebook">Facebook</option><option value="whatsapp">WhatsApp</option><option value="telegram">Telegram</option><option value="daft">Daft</option></select></div><div><label htmlFor="area">Area <span className="optional">optional</span></label><select id="area" value={area} onChange={e => setArea(e.target.value)}><option value="">Unspecified</option>{areas.map(a => <option key={a}>{a}</option>)}</select></div><div><label htmlFor="kind">Property</label><select id="kind" value={kind} onChange={e => setKind(e.target.value)}><option value="room">Room</option><option value="whole">Whole property</option></select></div><div><label htmlFor="price">Monthly rent (€)</label><input id="price" type="number" min="1" step="1" value={price} placeholder="Unspecified" onChange={e => setPrice(e.target.value)} /></div><div><label htmlFor="bedrooms">Bedrooms</label><input id="bedrooms" type="number" min="1" max="30" step="1" value={bedrooms} placeholder="Unspecified" onChange={e => setBedrooms(e.target.value)} /></div></div>
        <label htmlFor="photos">Listing photos <span className="optional">optional</span></label>
        <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy && !presetBusy) addPhotos(Array.from(e.dataTransfer.files)); }}>
          <span className="upload-icon" aria-hidden="true">＋</span><strong>Look familiar? Add the photos.</strong><span>Drag photos here or choose files</span><input id="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" aria-describedby="photo-help photo-errors" onChange={e => { addPhotos(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div><p id="photo-help" className="field-help">Up to 6 photos · JPEG, PNG or WebP · 5 MB each</p>
        <div id="photo-errors">{photoError && <p className="notice error" role="alert">{photoError}</p>}</div>
        {photos.length > 0 && <ul className="photo-previews">{photos.map(photo => <li key={photo.key}><Image unoptimized width={112} height={80} src={photo.url} alt={`Attachment: ${photo.file.name}`} /><span>{photo.file.name}</span><button type="button" className="remove-photo" aria-label={`Remove ${photo.file.name}`} onClick={() => { URL.revokeObjectURL(photo.url); resources.current.delete(photo.url); setPhotos(previous => previous.filter(p => p.key !== photo.key)); }}>×</button></li>)}</ul>}
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div className="submit-row"><p>We connect the dots.<br /><strong>You decide your next step.</strong></p><button className="button primary" type="submit" disabled={busy || presetBusy || presetMissing}>{busy ? 'Checking the evidence…' : presetBusy ? 'Loading demo photo…' : <>Check it <span aria-hidden="true">→</span></>}</button></div>
      <p className="sr-only" role="status">{busy ? 'Checking your listing. Please wait.' : presetBusy ? 'Loading the demo photo.' : result ? 'Check complete. Your verdict is below.' : ''}</p>
    </form>
    {result && <div ref={resultAnchor} tabIndex={-1} className="result-anchor"><ReportView key={result.reportId} reportId={result.reportId} initial={result} /></div>}
  </>;
}
