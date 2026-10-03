# ScamRing

ScamRing is a hackathon project (MongoDB Builder Day Dublin, ~4h of coding).
1. Students paste a suspicious rental listing from Facebook, WhatsApp or Telegram.
2. We check it against a shared, privacy-preserving graph of reports.
3. Signals: reused photos, shared phone/email/payment handles, cloned text, known scam scripts, prices far below market.
4. Each listing gets a verdict (score, LOW/MEDIUM/HIGH, signals with evidence).
5. A moderator confirms or rejects reports; on confirmation everyone who checked a linked listing gets a live alert.
6. MongoDB Atlas (M0) is the database, the vector search engine and the event bus (change streams).
7. Stack: Next.js 15 App Router, TypeScript, Tailwind, native `mongodb` driver, sharp (photo hashes), zod, optional Claude for summaries, and an optional AI moderator (TensorX chat model plus a read-only MongoDB MCP server, `lib/agent`).
8. Layout: `app/` pages + API routes, `lib/` shared code (db, types, signals, agent), `scripts/` (setup-db, load-rents, seed-patterns, gen-seed, import-seed, worker, calibrate, smoke, moderator-agent, ping).
9. The worker (`npm run worker`) watches change streams and writes alerts; `npm run dev:all` runs web + worker.
10. Identifiers are 'kind:value' strings, value = HMAC-SHA256 hex (or 'img:<clusterId>'). See CONTRACT.md.
11. Contract for types, collections and APIs: CONTRACT.md. Config: `.env.local`, with `.env` as a fallback for the worker, calibrate and smoke (see `.env.example` and README).
12. Sessions are anonymous: cookie `sr_sid` set in middleware.ts.

## Rules
- Native MongoDB driver only. No Mongoose.
- Every API route exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.
- Never store raw phone numbers, emails, payment handles or IBANs. HMAC them first.
- Never change lib/types.ts without updating CONTRACT.md.
- Prefer aggregation pipelines over application-side joins.
- Keep functions small and typed.
- Each signal catches its own errors and returns null.
- DB_NAME selects the database.
- Scripts that delete data must refuse DB_NAME=scamring unless run with --shared.
- Vector search always goes through lib/vector.ts.
- Raw identifiers also stay out of `Report.text`: ingestReport stores the redacted text from extractIdentifiers.
- Tests that write to the database refuse DB_NAME=scamring; run them with DB_NAME=scamring_<letter>.
