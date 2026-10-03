# ScamRing

ScamRing is a hackathon project (MongoDB Builder Day Dublin, ~4h of coding).
1. Students paste a suspicious rental listing from Facebook, WhatsApp or Telegram.
2. We check it against a shared, privacy-preserving graph of reports.
3. Signals: reused photos, shared phone/email/payment handles, cloned text, known scam scripts, prices far below market.
4. Each listing gets a verdict (score, LOW/MEDIUM/HIGH, signals with evidence).
5. A moderator confirms or rejects reports; on confirmation everyone who checked a linked listing gets a live alert.
6. MongoDB Atlas (M0) is the database, the vector search engine and the event bus (change streams).
7. Stack: Next.js 15 App Router, TypeScript, Tailwind, native `mongodb` driver, sharp (photo hashes), zod, optional Claude for summaries.
8. Layout: `app/` pages + API routes, `lib/` shared code (db, types), `scripts/` (setup-db, seed, worker, ping).
9. The worker (`npm run worker`) watches change streams and writes alerts; `npm run dev:all` runs web + worker.
10. Identifiers are 'kind:value' strings, value = HMAC-SHA256 hex (or 'img:<clusterId>'). See CONTRACT.md.
11. Contract for types, collections and APIs: CONTRACT.md. Config: `.env.local` (see `.env.example`).
12. Sessions are anonymous: cookie `sr_sid` set in middleware.ts.

## Rules
- Native MongoDB driver only. No Mongoose.
- Every API route exports `runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.
- Never store raw phone numbers, emails, payment handles or IBANs. HMAC them first.
- Never change lib/types.ts without updating CONTRACT.md.
- Prefer aggregation pipelines over application-side joins.
- Keep functions small and typed.
