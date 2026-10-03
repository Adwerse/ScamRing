// Lane C. Run from the repo: node public/demo/prepare-photos.mjs
// Downloads the 40 fixed free Unsplash sources, validates and resizes them,
// then derives reuse.jpg from p01. Does not change the database or seed JSON.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

async function downloadPhoto(source, filename) {
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(source.download, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) throw new Error('The response was not an image');
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise(done => setTimeout(done, 500 * (attempt + 1)));
    }
  }
  throw new Error(`Could not download ${filename} from the Unsplash image CDN (${failure}). Source: ${source.page}. Existing photos were kept; rerun to resume.`);
}

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const photosDirectory = resolve(root, 'seed/photos');
const sources = JSON.parse(await readFile(resolve(directory, 'photo-sources.json'), 'utf8'));
if (sources.photos.length !== 40 || new Set(sources.photos.map(source => source.download)).size !== 40) throw new Error('Expected exactly 40 unique photo sources.');
await mkdir(photosDirectory, { recursive: true });
for (let index = 0; index < sources.photos.length; index++) {
  const source = sources.photos[index];
  const file = resolve(photosDirectory, `p${String(index + 1).padStart(2, '0')}.jpg`);
  let exists = false;
  try { await access(file); exists = true; } catch { /* Download only missing assets. */ }
  if (!exists) {
    const bytes = await downloadPhoto(source, source.file);
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || metadata.width < 800) throw new Error(`Source p${index + 1} is less than 800px wide.`);
    await writeFile(file, await sharp(bytes).rotate().resize({ width: 1200, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer());
  }
  const metadata = await sharp(file).metadata();
  if (!metadata.width || metadata.width < 800) throw new Error(`${file} is less than 800px wide. Replace it with an eligible photo.`);
  console.log(`${exists ? 'Kept' : 'Downloaded'} p${String(index + 1).padStart(2, '0')}.jpg · ${metadata.width}px`);
}
const first = await sharp(resolve(photosDirectory, 'p01.jpg')).metadata();
const resized = await sharp(resolve(photosDirectory, 'p01.jpg')).resize({ width: Math.round(first.width * .8) }).toBuffer();
const scaled = await sharp(resized).metadata();
const crop = Math.round(scaled.width * .02);
await writeFile(resolve(directory, 'reuse.jpg'), await sharp(resized).extract({ left: crop, top: 0, width: scaled.width - crop, height: scaled.height }).jpeg({ quality: 75 }).toBuffer());
console.log('Prepared 40 seed photos and public/demo/reuse.jpg. Tell Lane B to use these assets before importing seed data.');
