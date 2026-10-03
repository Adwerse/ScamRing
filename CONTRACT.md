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

Raw phone numbers, emails, payment handles and IBANs are **never stored**, logged or returned by any API. `identifierHints` carries only a masked, human-readable hint (e.g. `+353 ** *** 4821`).

## Collections (database `scamring`)

| Collection | Holds |
| --- | --- |
| `reports` | `Report`: one per checked or seeded listing |
| `photos` | `Photo`: perceptual hash (`dhash`) + LSH bands `b0..b3` per photo, `clusterId` for near-duplicates |
| `scam_patterns` | `ScamPattern`: known scam scripts, matched against listing text |
| `rent_baseline` | `RentBaseline`: average rents per location / bedrooms / property type / quarter |
| `checks` | `Check`: which session checked which report |
| `alerts` | `Alert`: live alerts for sessions that checked a linked listing |
| `moderation_events` | `ModerationEvent`: audit log of moderator actions |
| `meta` | Key/value bookkeeping (e.g. worker resume tokens, seed version) |

## API

All routes run on `runtime = 'nodejs'` with `dynamic = 'force-dynamic'`. `POST /api/check`, `GET /api/reports/[id]` and `GET /api/reports/[id]/ring` currently return fixtures (see below). The other routes are stubs returning HTTP 501 `{ "error": "not_implemented", "route": "<METHOD path>" }`.

| Route | Purpose |
| --- | --- |
| `POST /api/check` | Submit a pasted listing (text, source, optional photos); stores a `Report` and a `Check`, returns the `Verdict` |
| `GET /api/reports/[id]` | Fetch a report with its verdict and signals |
| `GET /api/reports/[id]/ring` | Graph (nodes/links) of reports linked to this one via shared identifiers, photo clusters |
| `GET /api/moderation/queue` | Pending reports for moderators, highest score first |
| `POST /api/moderation/[id]` | Moderator action `confirm` / `reject` / `legit`; writes a `ModerationEvent` and, on confirm, triggers alerts |
| `GET /api/stream` | Server-sent events: live alerts for the current session (`sr_sid` cookie) |
| `GET /api/under-the-hood` | Debug/explain data: counts, indexes and pipelines used by the checker |


## Session

Middleware sets cookie `sr_sid` (uuid v4, path `/`, 30 days, `SameSite=Lax`) when missing. It is the `sessionId` on `Check` and `Alert`.

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

// lib/signals/{ringLink,photoReuse,textClone,scriptMatch,priceLow}.ts
// each file exports one function named after the file:
export async function <fileName>(report: Report): Promise<Signal | null>;

// lib/signals/index.ts
export const signals = [ringLink, photoReuse, textClone, scriptMatch, priceLow];
```

### Rule

Changing a signature or a fixture shape needs an announcement in chat. A updates CONTRACT.md and the stub in the same commit.

## Environment

`DB_NAME` selects the database (default `scamring`, the shared one). Personal sandboxes: `scamring_a`, `scamring_b`, `scamring_c`, `scamring_d`.
