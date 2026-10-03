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

## Investigative layout

Landing page pairs the first-screen input with a labelled illustrative ring
trail on desktop; mobile prioritises the input. Metadata and photos use native
collapsible disclosures. Preset attachments open automatically; hidden invalid
fields reveal for browser validation. System typography adds no dependencies.
Verdict and connections are columns above 900 px and stack on smaller screens.
Build, lint, TypeScript and metadata/form regression checks passed. Chrome
checks at 1440 and 390 px verified report columns/stacking and no horizontal
overflow; a fixture-intercepted browser demo submission rendered the verdict.
Live and Moderate states remain with Lane D. No API shape changed.

## Rent periods and posting references

The form detects euro rent in message text, defaults an unspecified period to
monthly with a visible notice, and offers weekly/monthly/yearly controls.
Manual rent or period edits persist across message edits; Use detected rent
restores automatic extraction. Weekly rent is converted by 52 / 12 and yearly
by 1 / 12, rounded to cents, before posting priceEur to the frozen monthly API.
Clearly labelled deposits and bills are excluded from autofill. Conflicting
prices require confirmation rather than taking the first amount.

An optional original posting URL is appended to the submitted message. No page
is fetched or scraped, and the message remains required. Daft links infer source
daft when the source is unspecified; other sites use existing source choices.
URLs require HTTP(S), no credentials, and the combined message limit remains
10,000 characters. A dedicated sourceUrl field/import endpoint would need Lane
A to update the report/ingest/check contracts; none were changed here.

Lane A follow-up: direct API submissions still parse the first euro amount as
monthly when priceEur is omitted. Move rent-period normalization into backend
validation if callers outside this form need the same behaviour. This frontend
supplies the normalized monthly amount explicitly.

Validation: build/lint/TypeScript passed; helper tests cover formats, deposit and
bill exclusion, ambiguity and period conversion. Form tests cover manual edits,
link inclusion and validation. A real 390 px Chrome check verified typing a
weekly message fills rent, displays monthly equivalent and posts 1083.33 for
250/week; a fixture-intercepted verdict rendered without shared DB writes.

## Cookbook visual pass

Applied the reusable Codex typography/composition/interaction prompts to the
actual app: subtle page atmosphere and evidence-board texture, clearer form
hierarchy, loaded demo states, restrained loading indicator and illustration
reveal, numeric score typography, risk meter and signal count. Report selection
highlights the matching map node/edges and list entry; keyboard buttons provide
the same action as clicking a canvas report. Colours and API contracts remain
unchanged. Motion is limited to no-preference; reduced motion keeps all evidence
visible. No new font downloads or packages were added.

Build, full lint, TypeScript and CSS token/whitespace checks passed. Chrome
checks at 1440 and 390 px verified visible input/no overflow, loaded demo state,
fixture-based submission, keyboard highlighting/toggle, reduced-motion animation
and transition suppression, and no uncaught browser exceptions. API responses
were intercepted using fixtures and photo endpoints returned placeholder errors,
so these checks did not write to the shared database.

## Ireland listing map

`/report/map` adds a read-only geographic overview with suspicion filters, area
search, neighbourhood selection, paginated report links, refresh, and explicit
loading/empty/error/stale snapshot states. The street map supports dragging,
pinch zoom, +/- buttons, double-click, Ctrl/Command + scroll, arrow-key panning
and keyboard zoom/Home. Ireland, Dublin and Fit reports controls reposition it.
Cluster buttons zoom into multiple nearby areas and select their report evidence.
The list can optionally follow the visible map bounds. Counts are shown in full.
A cluster uses the highest saved verdict level among matching reports. Filtering
to LOW reveals green markers; green never verifies a property as safe.

The additive C-owned `/api/under-the-hood/map` projects only report ID, area,
monthly price, review status and stored verdict score/level. It reads at most
1,001 recent non-rejected reports and returns at most 1,000, with a truncation
notice. Reports lacking a usable verdict are counted without inventing a score.
Unknown/unrecognised areas remain in the list without coordinates. No reports
are ingested, recomputed, moderated or deleted by this feature.

Existing reports have area names, not property coordinates. Recognised Dublin
neighbourhoods now use distinct approximate centres. Citywest uses its wider
Dublin 24 routing area; unspecified Dublin reports retain a coarse city centre.
Nearby centres cluster by screen distance and separate as you zoom. Reports in
the same area stay grouped without fabricated individual positions. All 169
seed listings are in Dublin and resolve to 30 centres; this explains the lack
of reports elsewhere in the original map. New saved reports in supported towns
such as Cork or Galway appear automatically; seed data was not altered.

Visible street tiles load directly from OpenStreetMap with visible attribution,
normal browser caching and origin Referer. No tile prefetch/offline download or
proxy is used. Tile failures retain a bundled Natural Earth outline and markers.
GeoNames supplies most area centres under CC BY 4.0; additional coordinate facts
and source links are recorded in `public/demo/map-sources.json`. No map API key,
packages, geocoder, new indexes, shared types or environment variables are needed.

For exact property locations, ask Lane A for an explicit location contract and
Lane B for seed/geocoding coverage; do not infer addresses from listing text.

Zoom-map verification: build, lint, TypeScript and whitespace checks pass.
Seed-area checks locate all 169 reports across 30 centres, with 12 clusters at
the initial 600px map view. Chrome checks at 1440/390px cover cluster expansion,
complete counts, dragging, pinch, Ctrl+wheel, keyboard navigation, area focusing,
map-bound list filtering, unknown areas, a newly added Galway test report, and
stale/empty/malformed/tile failure states. Browser API and tile responses were
intercepted; no shared data was changed and no automated tile downloads ran.
Live database results and real street-tile availability remain unverified here.

## Public navigation

Removed Live and Moderate from the header at the user's request. Both pages
currently contain heading-only placeholders. Public navigation now focuses on
checking a listing, the Ireland map and the under-the-hood evidence page.
Lane D's routes and backend work remain available at their direct URLs so the
team can finish the moderator confirmation/alert flow independently.

## Mobile flow and evidence clarity

The mobile introduction is shorter, with the message starting around 337px and
the check button visible within an 844px viewport. Demo selection focuses and
scrolls to the message and announces that the example is ready for review.
Submission focuses and scrolls to the verdict heading. Refresh and sharing
controls follow the risk, evidence and connection list.

Editing the message, metadata, posting link or accepted photo attachments clears
the previous result. Aborted or superseded requests cannot restore an old result.
Warning-sign points and the score explanation sit in a native disclosure; the
explanation distinguishes an evidence score from a probability of fraud.
Connection distances use “connection steps”, and masked shared details appear
directly in the list, including on phones. Photo URLs remain hidden from labels.

Build, lint and TypeScript checks pass. Rendered Chrome checks at 390/1440px
verify first-screen access, demo focus/announcement, verdict focus, result
invalidation, scoring disclosure, visible masked details, keyboard highlighting,
overflow and reduced motion. API requests used fixtures; this does not verify
the shared database or Lane D's moderator/alert flow.
