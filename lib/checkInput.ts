// Parsing and validation of POST /api/check bodies (multipart/form-data or JSON).
import sharp from 'sharp';
import { z } from 'zod';

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 10000;
const MAX_PRICE = 100000;

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: unknown,
  ) {
    super(message);
  }
}

const fields = z.object({
  text: z.string().trim().min(1).max(MAX_TEXT),
  source: z.enum(['facebook', 'whatsapp', 'telegram', 'daft', 'other']).default('other'),
  area: z.string().trim().min(1).max(100).default('Unknown'),
  kind: z.enum(['room', 'whole']).default('room'),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  priceEur: z.coerce.number().positive().max(MAX_PRICE).optional(),
});

export type CheckInput = {
  text: string;
  source: z.infer<typeof fields>['source'];
  area: string;
  kind: 'room' | 'whole';
  bedrooms: number | null;
  priceEur: number | null;
  photos: Buffer[];
};

const EURO_BEFORE = /€\s?(\d[\d,.]*\d|\d)/;
const EURO_AFTER = /(\d[\d,.]*\d|\d)\s?(?:€(?!\s?\d)|eur(?:os?)?\b)/i;

function toAmount(raw: string): number | null {
  const plain = /^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replace(/\./g, '') : raw.replace(/,/g, '');
  const n = Number(plain);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE ? n : null;
}

/** The first EUR amount in the text ("€650", "€1,200", "650 euro", "700eur"), or null. */
export function parseEuro(text: string): number | null {
  const before = EURO_BEFORE.exec(text);
  const after = EURO_AFTER.exec(text);
  const first = [before, after].filter((m): m is RegExpExecArray => m !== null).sort((a, b) => a.index - b.index)[0];
  return first ? toAmount(first[1]) : null;
}

function validate(raw: Record<string, unknown>, photos: Buffer[]): CheckInput {
  const present = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  const parsed = fields.safeParse(present);
  if (!parsed.success) throw new RequestError('invalid_request', 400, parsed.error.issues);
  const f = parsed.data;
  return {
    text: f.text,
    source: f.source,
    area: f.area,
    kind: f.kind,
    bedrooms: f.bedrooms ?? null,
    priceEur: f.priceEur ?? parseEuro(f.text),
    photos,
  };
}

async function readPhotos(files: File[]): Promise<Buffer[]> {
  if (files.length > MAX_PHOTOS) throw new RequestError(`at most ${MAX_PHOTOS} photos`, 400);
  const photos: Buffer[] = [];
  for (const file of files) {
    if (file.size > MAX_PHOTO_BYTES) throw new RequestError('photo larger than 5 MB', 413);
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      await sharp(buffer).metadata();
    } catch {
      throw new RequestError('not a readable image', 400);
    }
    photos.push(buffer);
  }
  return photos;
}

export async function parseCheckRequest(req: Request): Promise<CheckInput> {
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const form = await req.formData().catch(() => {
      throw new RequestError('invalid form data', 400);
    });
    const raw: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) if (typeof value === 'string') raw[key] = value;
    const files = form.getAll('photos').filter((v): v is File => typeof v !== 'string');
    return validate(raw, await readPhotos(files));
  }
  if (type.includes('application/json')) {
    const body = await req.json().catch(() => {
      throw new RequestError('invalid JSON', 400);
    });
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new RequestError('invalid_request', 400);
    return validate(body as Record<string, unknown>, []);
  }
  throw new RequestError('send multipart/form-data or application/json', 415);
}
