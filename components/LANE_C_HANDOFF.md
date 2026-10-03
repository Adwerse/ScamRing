# Lane C implementation and remaining integration

> Historical hand-off note: it describes lane C's state when the frontend was handed over. Since then the toast has been mounted and listens to server-sent events, the check endpoint is fully implemented, and all seed photos are committed. FRONTEND_SPEC.md was never committed. For the current state, see README.md and CONTRACT.md.

The latest team split overrides FRONTEND_SPEC.md: work on main, use A's frozen
fixtures, and C owns the proof endpoint and page. No shared backend files,
dependencies, contracts, D's toast, moderation or live pages were edited.

## Applied lane prompts

Kickoff: Read CLAUDE.md, CONTRACT.md and fixtures. Edit only Lane C's paths.
Use browser-only wire types; client components import no server modules. Keep
API shapes and signatures frozen. Never manufacture verdicts from demo inputs.

5b: Build a client-only force graph from the existing ring fixture shape, loaded
with SSR disabled. Colour reports by review status, outline the current report,
label area and price, and display masked identifiers or photo thumbnails. Copy
data before the graph library mutates it. Render statistics, a legend and an
always-visible accessible list. Fetch report and graph independently on the
report page; preserve a successful verdict if graph loading fails.

7: Implement a responsive check page, form, verdict card, app shell and three
demo presets. Submit FormData to /api/check. Validate required text and up to six
JPEG/PNG/WebP photos of at most 5 MB; preview and remove uploads. Show the server
level and evidence, plus loading and recoverable error states. Enable presets
only for DEMO=1; reused photos follow the same upload path as user attachments.
Never store user text or photos in browser persistence. Refresh open report data
through the existing HTTP endpoints while D's alert integration is pending.

8a: Implement only /api/under-the-hood and /under-the-hood. Read collection
counts, inspect actual index status, explain a stored report's identifier query,
and call getRing rather than copying traversal logic. Use reports_text_vec and
patterns_vec from the current CONTRACT.md. Do not create indexes or write data.
Provide friendly unconfigured/empty states and never manufacture IXSCAN.

Photos: Prepare 40 fixed free Unsplash interior sources as p01.jpg to p40.jpg,
at least 800px wide. Generate /demo/reuse.jpg from p01 with 80% resizing, a 2%
left crop and JPEG quality 75. Retain the source and license manifest.

## Running locally

From the repository directory:

```powershell
npm ci
node public/demo/prepare-photos.mjs
$env:DEMO = '1'
npm run dev
```

The photo command preserves existing valid photos, downloads missing files and
then derives reuse.jpg. It uses no API key and makes no database changes. Sources
and the Unsplash license link are in public/demo/photo-sources.json. Do not tell
B that photos have been delivered until all 40 files exist and are committed.

Before a push, run npm run build and npm run lint, pull with rebase, and stage
only the appropriate Lane C files. Keep generated assets with the photo commit;
graph/report, check/layout, and proof work can be committed separately.

## Current verification

- Thirteen Lane C TypeScript/TSX files passed TypeScript syntax transpilation.
- Browser response validators accepted the frozen check and ring fixtures.
- Malformed verdicts and graphs (including null nodes/signals) were rejected.
- All 40 source entries are unique; the photo script passed node --check.
- Photo preparation passed temporary-image integration checks for retrying an
  HTTP failure, downloading 40 images, producing the expected resize/crop and
  preserving existing seed assets on rerun. No test images were put in the repo.
- git diff --check passed.
- After local dependency installation, npx --no-install tsc --noEmit and
  npm run build passed, including Next's lint/type checks and page generation.
- Browser acceptance and checks against real backend data remain pending.
- Actual photo downloads remain pending: this environment cannot reach the image
  host. The source manifest now uses direct images.unsplash.com URLs instead of
  the website download endpoint. No placeholder photos were substituted.
- Changes are local; GitHub access prevented the required pull/push sequence.

## Owner hand-offs

Lane A: The form sends repeated `photos` multipart fields plus text, source,
kind, and nonempty area, bedrooms and priceEur. Empty optional metadata is omitted.
Please confirm these fields, accepted JPEG/PNG/WebP formats and six-file/5 MB
limits in your real check endpoint. It currently accepts and ignores the body.
Also getDb still defaults to the shared database when DB_NAME is missing; the
proof route guards against this, but the team split requires A to fix the helper.

Lane B: The payment preset now uses @dublinroomsnow to match gen-seed.ts. The
photo preset uses p01's transformed image. Coordinate before reseeding so the
same photo files are on every laptop. Demo MEDIUM/HIGH/LOW outcomes depend on
actual verdict logic, calibrated signals and current seed state.

Lane D: AlertToast.tsx is absent. The layout includes its mounting point. Open
reports currently poll every three seconds, using no SSE or change streams.
Mount your component and connect report refresh to your actual alert event/hook
once the export and notification contract are known; the two-second toast
acceptance is still pending.

Proof: Collection counts and scan evidence come from the database. Ring helper
results are checked against stored report IDs to avoid presenting stub IDs as
live data. Unconfigured connections and empty databases have explicit states.

## Manual acceptance after teammates' endpoints land

Frontend follow-up: text is limited to 10,000 characters, bedrooms to 0–20,
and rent to a positive amount up to EUR 100,000 to match the check API.
Area accepts custom text with suggestions. Clear form releases photo previews.
Report links can be copied (with a manual fallback) and reports printed with
the evidence list. Reports poll only in visible tabs and avoid overlapping
refreshes. Read requests time out after 20 seconds and submissions after 60
seconds; submissions never retry automatically because they may already have
been saved. Malformed report responses are shown as recoverable errors.

Check copy permissions/fallback, print preview, studio input (0 bedrooms),
custom area input, form clearing and hiding/restoring the report tab manually.

1. Test all three presets after a clean shared seed reset; expected MEDIUM,
   HIGH and LOW must come from the API.
2. Confirm a linked report in a second browser and observe a toast and a HIGH
   verdict update in the first. Test D's SSE and polling configurations.
3. Open a report with a missing price, a broken thumbnail, an invalid ID and a
   missing report. Interrupt the ring request; the verdict must remain readable.
4. Check keyboard navigation, a narrow phone viewport and a projector viewport.
5. Inspect /under-the-hood with no configuration, an empty database, and the
   shared seeded database. Verify actual scan/index output against Atlas.

Suggested chat messages after successful validation and push:

`[C] photos pushed`

`[C] pushed graph and report page, pull`

`[C] pushed check page and demo presets, pull`

`[C] pushed proof page, pull`

## Frontend audit follow-up

Fixed the stale upload count when a demo replaces six selected photos. Blob
URLs are allocated outside React state updater callbacks and released on clear.
Demo photo loading now times out and restores the form controls. Wire guards
reject duplicate graph nodes, missing link targets, invalid counts and malformed
proof tables. A report map must identify the requested report as current.
Manual refresh requests are aborted when the report unmounts. Proof refresh
failures label the retained inspection as previous data; proof copy describes
the actual shared traversal rather than claiming it still returns fixtures.

Validation: production build, full lint, TypeScript, whitespace checks and
focused fixture/malformed-response/timeout checks passed. A simulated form
interaction verified six-photo-to-demo replacement and URL cleanup. Browser
visual, clipboard and print-preview checks and shared-DB verdict/alert tests
remain integration checks; this audit did not change shared moderation data.
