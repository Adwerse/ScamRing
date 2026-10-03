# ScamRing

**Before the deposit. Connect the dots.**

ScamRing checks a rental listing against every scam students have already reported. Paste a post from Facebook, WhatsApp, Telegram or Daft. ScamRing looks for reused photos, shared phone numbers, emails and payment handles, copied text, known scam scripts, and prices far below market. You get a LOW, MEDIUM or HIGH verdict with the evidence behind it, and a graph of every listing it is connected to.

Built in one day at MongoDB Builder Day Dublin, 3 October 2026, on MongoDB Atlas.

![The ScamRing check page: paste a listing or try one of three demo listings.](docs/screenshots/home.png)

> Rental fraud in Ireland: 399 reports to Gardaí in 2025, up 14% on 2024, with about €680,000 lost. 34% of victims are under 25, and about a third of reports come in August and September, when students look for housing. Sources in [`seed/patterns-sources.md`](seed/patterns-sources.md).

## How a check works

1. **Ingest.** Phone numbers, emails, Revolut handles and IBANs are pulled out of the text and stored only as HMAC-SHA256 hashes; the stored text keeps `[phone]`, `[email]` placeholders instead. Each photo gets a perceptual hash and joins a cluster of near-identical images.
2. **Ring.** One `$graphLookup` walks every report that shares a hashed contact or a photo cluster, up to 3 hops away.
3. **Signals.** Five independent checks run in parallel. Each one catches its own errors, so a slow service drops one signal instead of failing the check.
4. **Verdict.** Points are summed and capped at 100: **70+ HIGH**, **30 to 69 MEDIUM**, below 30 LOW. An optional Claude summary explains it in plain words, using only the signals, never the listing text.
5. **Alerts.** When a moderator confirms a scam, everyone who checked a linked listing gets a live alert within about 2 seconds, through MongoDB change streams, and their verdict updates on screen.

| A verdict with its evidence | The ring behind it |
| --- | --- |
| ![A HIGH verdict of 80: linked to a confirmed scam and the same photo in other listings.](docs/screenshots/verdict.png) | ![The ring graph: 14 linked reports, 2 confirmed scams, connected through shared phones, emails and photos.](docs/screenshots/ring-graph.png) |

![A moderator confirms a scam, and a student who checked a linked listing gets a live alert.](docs/screenshots/moderation-alert.png)

| Signal | Points | Fires when |
| --- | --- | --- |
| `ring_link` | 45 / 10 | The listing shares a contact or photo with a confirmed scam (45), or with a cluster of 2+ other reports (10) |
| `photo_reuse` | 35 | A photo matches one used in another area or at a price more than 15% different |
| `text_clone` | 20 / 25 | 60%+ of the wording (3-word phrases) matches other reported listings; 25 if one of them is a confirmed scam |
| `script_match` | 10 / 20 | The text follows one of 10 known scam scripts (vector search, with a keyword fallback) |
| `price_low` | 15 / 25 | The price is 35%+ below the RTB average for the same area and bedrooms; 25 if more than 50% below |

## Built on MongoDB Atlas

| Feature | Used for |
| --- | --- |
| Atlas Vector Search with automated embedding (Voyage `voyage-4`) | `script_match` finds the closest known scam script by meaning; Atlas embeds documents and queries itself |
| `$graphLookup` on a multikey index | The ring: every report linked through shared hashed identifiers, in one query on `identifiers_1` |
| Change streams | The worker turns a moderator's confirmation into alerts for every affected session |
| Aggregation pipelines | Rent baselines by area and district, photo clusters, proof page statistics |
| TTL index | Unconfirmed user reports expire after 30 days |

## The data

Rents and scam scripts come from real Irish sources. Contact details in the demo data are synthetic, so no real person's phone or email ends up in a scam ring.

![Data flow: each source, what we did to it, where it is stored, and what reads it.](seed/data-sources.png)

- **Rents:** the RTB Average Monthly Rent Report, CSO table [RIQ02](https://data.cso.ie/table/RIQ02), loaded live for the latest quarter (2025Q4: 3,199 values across 306 locations), with a 10-area offline backup.
- **Scam scripts:** 10 tactics paraphrased from An Garda Síochána, the CCPC, Daft.ie, AIB, BPFI FraudSMART and Irish press, with names and numbers removed.
- **Demo listings:** three scam rings (Courier, Revolut, WhatsApp) and 150 legit listings, generated from the real rents and scripts.

![Scam rings: the Courier ring linked through phones, an email and reused photos; the WhatsApp ring linked to it through C4's phone; the Revolut ring sharing one Revolut handle.](seed/rings.png)

| Ring | Tactic | Linked by | Verdict |
| --- | --- | --- | --- |
| **Courier** (A), 8 listings | Landlord abroad, keys sent by courier after the deposit | Two phones, an email and reused photos; 2 listings already confirmed as scams | HIGH |
| **Revolut** (B), 6 listings | Mass viewing, deposit by Revolut tonight | One Revolut handle and copied text, no reused photos | HIGH. A new post using the same handle starts at MEDIUM and rises when a moderator confirms one of these live in the demo |
| **WhatsApp** (C), 5 listings | Sob story, talks only on WhatsApp, wants ID up front | One email, plus one listing sharing a Courier phone | HIGH, through its link to Courier |

The 150 legit listings share nothing with anyone, so they never join a ring.

## Run it

Requirements: Node.js 22, a MongoDB Atlas cluster (M0 works).

```bash
npm install
cp .env.example .env.local          # set MONGODB_URI, IDENTIFIER_SECRET and DB_NAME
npm run setup-db                     # collections, indexes, vector indexes (shared DB only)
npm run load-rents -- --shared       # RTB rents from the CSO
npx tsx scripts/seed-patterns.ts --shared
npm run import-seed -- --shared --no-verdicts
npm run dev:all                      # web app and change-stream worker
```

Scripts that write or delete data refuse the shared database `scamring` unless run with `--shared`. Personal sandboxes (`scamring_a` to `scamring_d`) skip the vector indexes, because an M0 cluster allows only 3 search indexes in total.

| Page | What it shows |
| --- | --- |
| `/` | Paste a listing, get a verdict with evidence |
| `/report/[id]` | One report, its verdict and its ring graph |
| `/under-the-hood` | Collection counts, real query plans and the ring traversal |
| `/moderate` | Moderation queue: confirm, clear or reject reports (needs `MODERATOR_PIN`) |
| `/live` | This browser's alerts, as they arrive |

API contract: [`CONTRACT.md`](CONTRACT.md). Tests: `npm test`.

## Privacy

- Raw phone numbers, emails, payment handles and IBANs are never stored, logged or returned. Only HMAC hashes and short masked hints are kept.
- Sessions are anonymous: a random `sr_sid` cookie, no accounts.
- Verdicts say "risk", never "scam": the summary prompt rules out legal claims.
- Demo data uses invented contacts; real scam reports often carry spoofed numbers that belong to innocent people.

## Team

| Lane | Owns |
| --- | --- |
| A: Core | Database, ingest, identifiers, photo hashing, ring, verdict, check API |
| B: Data and signals | Rents, scam patterns, seed data, `price_low`, `script_match`, `text_clone`, ring and photo APIs |
| C: Frontend | Check page, verdict card, ring graph, proof page |
| D: Realtime and release | Moderation, change-stream alerts, calibration and smoke tests, submission |
