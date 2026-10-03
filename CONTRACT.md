# ScamRing contract

Source of truth for shared types, collections and APIs. Types live in [lib/types.ts](lib/types.ts); keep both in sync.

## Types

```ts
type Source = 'facebook' | 'whatsapp' | 'telegram' | 'daft' | 'other';
type ReportStatus = 'pending' | 'confirmed_scam' | 'legit' | 'rejected';
type SignalCode = 'ring_link' | 'photo_reuse' | 'text_clone' | 'script_match' | 'price_low';

interface Signal {
  code: SignalCode;
  points: number;
  title: string;
  evidence: string;
  refs: string[];
}

interface Verdict {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  signals: Signal[];
  summary: string;
  computedAt: Date;
}

interface IdentifierHint {
  kind: 'phone' | 'email' | 'pay' | 'iban' | 'img';
  hint: string;
}

interface Report {
  _id: ObjectId;
  source: Source;
  text: string;
  area: string;
  kind: 'room' | 'whole';
  bedrooms: number | null;
  priceEur: number | null;
  photoIds: ObjectId[];
  identifiers: string[];
  identifierHints: IdentifierHint[];
  status: ReportStatus;
  seed: boolean;
  seedRing?: string;
  verdict?: Verdict;
  createdAt: Date;
  expiresAt?: Date;
}

interface Photo {
  _id: ObjectId;
  reportId: ObjectId;
  clusterId: string;
  dhash: string;
  b0: string;
  b1: string;
  b2: string;
  b3: string;
  createdAt: Date;
}

interface ScamPattern {
  _id: ObjectId;
  code: string;
  category:
    | 'absent_landlord' | 'mass_showing' | 'fake_agency'
    | 'advance_payment' | 'too_good' | 'identity_theft';
  title: string;
  text: string;
  advice: string;
  sourceUrl: string;
}

interface RentBaseline {
  location: string;
  bedrooms: string;
  propertyType: string;
  quarter: string;
  avgRent: number;
}

interface Check {
  _id: ObjectId;
  sessionId: string;
  reportId: ObjectId;
  createdAt: Date;
}

interface Alert {
  _id: ObjectId;
  sessionId: string;
  reportId: ObjectId;
  triggerReportId: ObjectId;
  message: string;
  seen: boolean;
  createdAt: Date;
}

interface ModerationEvent {
  _id: ObjectId;
  reportId: ObjectId;
  action: 'confirm' | 'reject' | 'legit';
  by: string;
  reason?: string;
  at: Date;
}
```

### Identifiers and privacy

`Report.identifiers` holds strings of the form `kind:value`:

- `phone:<hmac>`, `email:<hmac>`, `pay:<hmac>`, `iban:<hmac>`: `value` is the HMAC-SHA256 hex of the normalised raw value, keyed with `IDENTIFIER_SECRET`.
- `img:<clusterId>`: the id of a photo cluster (near-duplicate images).

Raw phone numbers, emails, payment handles and IBANs are **never stored**, logged or returned by any API. This includes `Report.text`: `ingestReport` replaces them there with `[phone]`, `[email]`, `[pay]` and `[iban]`. `identifierHints` carries only a masked, human-readable hint (e.g. `+353 ** *** 4821`).

## Collections (database `scamring`)

| Collection | Holds |
| --- | --- |
| `reports` | `Report`: one per checked or seeded listing |
| `photos` | `Photo`: perceptual hash (`dhash`) + LSH bands `b0..b3` per photo, `clusterId` for near-duplicates |
| `photos_blob` | Image bytes for photos, kept apart from `photos` so hash documents stay small |
| `scam_patterns` | `ScamPattern`: known scam scripts, matched against listing text |
| `rent_baseline` | `RentBaseline`: average rents per location / bedrooms / property type / quarter |
| `checks` | `Check`: which session checked which report |
| `alerts` | `Alert`: live alerts for sessions that checked a linked listing |
| `moderation_events` | `ModerationEvent`: audit log of moderator actions |
| `meta` | Key/value bookkeeping (e.g. worker resume tokens, seed version) |

### Indexes (created by `npm run setup-db`, idempotent, on the database named by `DB_NAME`)

- `reports`: `{ identifiers: 1 }` (`identifiers_1`, multikey), `{ status: 1, createdAt: -1 }`, `{ area: 1, kind: 1, bedrooms: 1 }`, TTL `{ expiresAt: 1 }` (`expireAfterSeconds: 0`)
- `photos`: `{ b0: 1 }`, `{ b1: 1 }`, `{ b2: 1 }`, `{ b3: 1 }`, `{ clusterId: 1 }`, `{ reportId: 1 }`
- `checks`: `{ reportId: 1 }`, `{ sessionId: 1 }`
- `alerts`: `{ sessionId: 1, createdAt: -1 }`
- `rent_baseline`: `{ location: 1, bedrooms: 1, propertyType: 1, quarter: -1 }`
- `moderation_events`: `{ reportId: 1, at: -1 }`

Vector search indexes (Automated Embedding, model `voyage-4`) exist **only in the shared database `scamring`**; sandboxes skip them. M0 allows 3 search indexes in total, so these are the only two:

| Index | Collection | Fields |
| --- | --- | --- |
| `reports_text_vec` | `reports` | `autoEmbed` on `text`; filter on `status` |
| `patterns_vec` | `scam_patterns` | `autoEmbed` on `text`; filter on `category` |

Definitions live in [scripts/setup-db.ts](scripts/setup-db.ts). Query them only through `vectorSearchStage` (see below).

## API

All routes run on `runtime = 'nodejs'` with `dynamic = 'force-dynamic'`. `POST /api/check` and `GET /api/reports/[id]` are implemented and match their fixtures. `GET /api/reports/[id]/ring` still returns its fixture. The other routes are stubs returning HTTP 501 `{ "error": "not_implemented", "route": "<METHOD path>" }`.

| Route | Purpose |
| --- | --- |
| `POST /api/check` | Submit a pasted listing; stores a `Report` and a `Check`, returns `{ reportId, verdict, ring }` (see below) |
| `GET /api/reports/[id]` | The report as in `fixtures/report.json`: no `identifiers` (only `identifierHints`), no `seedRing`/`expiresAt`, with its `verdict`. 404 for an unknown or malformed id |
| `GET /api/reports/[id]/ring` | Graph (nodes/links) of reports linked to this one via shared identifiers, photo clusters |
| `GET /api/moderation/queue` | Pending reports for moderators, highest score first |
| `POST /api/moderation/[id]` | Moderator action `confirm` / `reject` / `legit`; writes a `ModerationEvent` and, on confirm, triggers alerts |
| `GET /api/stream` | Server-sent events: live alerts for the current session (`sr_sid` cookie) |
| `GET /api/under-the-hood` | Debug/explain data: counts, indexes and pipelines used by the checker |


## Session

Middleware sets cookie `sr_sid` (uuid v4, path `/`, 30 days, `SameSite=Lax`) when missing. It is the `sessionId` on `Check` and `Alert`.

### `POST /api/check`

- Body: `multipart/form-data` (fields below, plus up to 6 `photos` files of at most 5 MB each) or `application/json` (no photos). Anything else: 415.
- Fields: `text` (required, at most 10,000 chars), `source` (default `other`), `area` (default `Unknown`), `kind` (`room`|`whole`, default `room`), `bedrooms`, `priceEur`. Missing `priceEur` is read from the first EUR amount in the text (`€650`, `1,200 €`, `650 euro`).
- Flow: `ingestReport` → `computeVerdict` → insert a `Check` with `sessionId` from cookie `sr_sid` → `getRing`.
- 200: exactly the shape of `fixtures/check-response.json`. `ring.size` counts all ring members including this report (capped at 60 by `getRing`); `ring.confirmedCount` counts members with status `confirmed_scam`.
- 400 `{ error, issues? }` for invalid input or an unreadable image, 413 for a photo over 5 MB, 500 `{ error: 'internal_error' }` otherwise.

### Verdict

`computeVerdict` runs every function in `lib/signals/index.ts` with `Promise.allSettled`, sums the points (capped at 100) and maps the score: 70+ `HIGH`, 30 to 69 `MEDIUM`, below 30 `LOW`. Signals are sorted by points, highest first. The summary comes from `ANTHROPIC_MODEL` (at most 60 words, 3 second timeout, only signal titles and evidence are sent, never the listing text) when `ANTHROPIC_API_KEY` is set, otherwise from the signal titles. The verdict is saved on the report.

| Signal | Points | When |
| --- | --- | --- |
| `ring_link` | 45 | Another ring member is `confirmed_scam`. Title "Linked to a confirmed scam"; `refs` are the confirmed members |
| `ring_link` | 10 | No confirmed member, but 2+ other members. Title "Part of a cluster of N reports" (N includes this report); `refs` are the other members |
| `photo_reuse` | 35 | An `img:` identifier is shared with a non-rejected report in a different area, or at a price more than 15% different (`|a-b| / max(a,b)`, `PRICE_DIFF` in the file) |

Constants live at the top of each signal file.

## Frozen signatures

### Response contracts (fixtures)

The four JSON files in [fixtures/](fixtures/) are the response contracts. Ids are strings, dates are ISO strings.

| Fixture | Contract |
| --- | --- |
| `fixtures/report.json` | `GET /api/reports/[id]`: a `Report` without `identifiers` (only `identifierHints`), with a `Verdict` |
| `fixtures/check-response.json` | `POST /api/check`: `{ reportId, verdict, ring: { size, confirmedCount } }` |
| `fixtures/ring.json` | `GET /api/reports/[id]/ring`: `{ nodes, links, stats: { reports, confirmed, maxHops } }`. Report nodes `{ id, type: 'report', area, priceEur, status, hops, isCurrent }`, identifier nodes `{ id, type: 'identifier', kind, hint }` (for `img`, `hint` is a thumbnail URL), links `{ source: reportId, target: identifierId, kind }` |
| `fixtures/alert.json` | An `Alert` (ids as strings) |

### Functions

```ts
// lib/ring.ts
export type RingMember = {
  _id: string; area: string; priceEur: number | null;
  status: ReportStatus; hops: number; identifiers: string[];
};
export async function getRing(reportId: string):
  Promise<{ members: RingMember[]; sharedIdentifiers: string[] }>;

// lib/verdict.ts
export async function computeVerdict(reportId: string): Promise<Verdict>;

// lib/ingest.ts
export type IngestInput = {
  source: Source; text: string; area: string; kind: 'room' | 'whole';
  bedrooms: number | null; priceEur: number | null; photos: Buffer[];
  seed?: boolean; seedRing?: string; status?: ReportStatus;
};
export async function ingestReport(input: IngestInput): Promise<Report>;

// lib/vector.ts
export type VectorSearchOptions = {
  index: string; path: string; text: string; limit: number; filter?: Document;
};
export function vectorSearchStage(opts: VectorSearchOptions): Document; // a $vectorSearch stage

// lib/signals/{ringLink,photoReuse,textClone,scriptMatch,priceLow}.ts
// each file exports one function named after the file:
export async function <fileName>(report: Report): Promise<Signal | null>;

// lib/signals/index.ts
export const signals = [ringLink, photoReuse, textClone, scriptMatch, priceLow];
```

### Implemented libraries (additive, not part of the frozen set)

```ts
// lib/identifiers.ts: phones (Irish 08x, UK 07, +/00 international), emails, Revolut handles, IBANs
export function extractIdentifiers(text: string):
  { identifiers: string[]; hints: IdentifierHint[]; redactedText: string };
// identifiers: 'kind:<hmac-sha256 hex>' (key IDENTIFIER_SECRET); hint = last 2 chars of the normalised value

// lib/dhash.ts
export async function dhash(buffer: Buffer): Promise<string>;               // 16 hex chars (64 bits)
export function bands(hex: string): [string, string, string, string];
export function hamming(a: string, b: string): number;

// lib/photos.ts
export const PHOTO_THRESHOLD = 10;                                            // max Hamming distance to join a cluster
export async function clusterPhoto(buffer: Buffer, reportId: ObjectId):
  Promise<{ photoId: ObjectId; clusterId: string; matchedDistance: number | null }>;
```

Behaviour worth knowing:

- `ingestReport` inserts the report once, complete (identifiers include `img:<clusterId>` per photo, `identifierHints` include one `img` hint per cluster: `/api/photos/<photoId>/thumb`). Reports that are not seed and are `pending` get `expiresAt = now + 30 days`.
- `photos_blob` documents: `{ _id: <photoId>, reportId, contentType: 'image/jpeg', data: BinData }`, JPEG 640 px wide, at most 300 KB.
- `getRing` hops: `0` is the report itself, `1` shares an identifier with it, `2` shares one with a hop-1 report, and so on. The `$graphLookup` uses `maxDepth: 2`, so hops reach 3. Rejected reports are excluded, members are capped at 60.
- `npm test` runs `tests/*.test.ts`. Tests that write to the database refuse `DB_NAME=scamring`.

### Rule

Changing a signature or a fixture shape needs an announcement in chat. A updates CONTRACT.md and the stub in the same commit.

## Environment

`DB_NAME` selects the database (default `scamring`, the shared one). Personal sandboxes: `scamring_a`, `scamring_b`, `scamring_c`, `scamring_d`.
