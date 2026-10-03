# ScamRing instructions for Codex

Read `CLAUDE.md`, `CONTRACT.md` and the relevant fixtures before changing code.
Those files contain shared project contracts even when the coding agent is Codex.
Preserve existing working-tree changes and use the user's latest instructions.

## Frontend tasks: Lane C

Use these design instructions when changing frontend pages, components or CSS.
Implement and verify the requested feature in the existing Next.js/React project.
Do not turn a working app into a standalone HTML example.

Lane C owns `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `app/report/**`,
`app/under-the-hood/**`, `app/api/under-the-hood/**`, `components/**` except
`components/AlertToast.tsx`, `public/demo/**`, and the forty named seed photos.
Keep changes within the assigned lane. A owns dependencies, shared contracts
and core APIs; B owns signals, seeds and ring/photo APIs; D owns Live, Moderate,
alerts, hooks, the worker and AlertToast. Describe the exact required hand-off
when another lane's change is needed, and continue independent frontend work.

If present, read `.knowledge-base/DESIGN.md` and
`.knowledge-base/INTEGRATION.md` for local decisions. These ignored notes are
optional: a clean checkout must still work without them. A reusable frontend
task prompt is in `components/CODEX_FRONTEND_PROMPT.md`.

## Design direction

ScamRing is a calm investigative interface for students checking rental scams.
The design should explain the listing, the warning signs and their connections
quickly. Preserve the first-screen message input, optional detail disclosures,
desktop verdict/map columns and the accessible connection list.

- Typography: use a deliberate contrast between display headings and controls.
  The approved baseline is Georgia for prominent headings and Segoe UI/system
  sans-serif for interface text. Preserve readable evidence text and clear
  hierarchy. Change fonts only when it improves the task; any new font must
  have verified licensing and a reliable local delivery path.
- Colour: use the existing MongoDB palette roles and CSS variables in
  `app/globals.css`. Keep dark ink, light surfaces and green accents coherent.
  Reserve warning colours for risk and review status, paired with text labels.
- Motion: make an interaction or connection easier to understand. Prefer modest
  CSS transitions and respect `prefers-reduced-motion`. Evidence must remain
  understandable without animation. Use installed tools before adding packages.
- Backgrounds: choose depth or a subtle contextual pattern only when it helps
  grouping and readability. Keep long evidence text and form surfaces clear.
- Composition: adapt spacing, proportions and content order to this product.
  Prefer meaningful listing/identifier relationships to decorative graphics.
  Label explanatory illustrations so users do not mistake them for live data.

Use visual references to identify a concrete improvement, then implement an
original solution that fits this product. Preserve approved design decisions
across tasks instead of randomly changing themes. MongoDB component packages
must not be claimed as installed merely because their colours are used.

## Behaviour and accessibility

Keep API response shapes frozen. Verdicts and graph evidence come from the API;
never invent risk levels or silently substitute fixtures after a real failure.
Client components import browser-only helpers, not server modules from `lib/`.
Keep loading, empty, failure and success states explicit, with a retry where
useful. Retain successfully fetched evidence when an independent request fails,
and label retained data when a refresh fails.

Keep keyboard access, visible focus, labels and descriptions, text risk labels,
status announcements and a list equivalent for canvas graphs. Disclosures must
reveal invalid inputs during validation. Check phone, desktop and projector
readability. Preserve manual rent edits, monthly normalization for `priceEur`,
photo validation/cleanup and clear wording that posting links are not imported.

## Verification and delivery

After application code changes, run the appropriate checks:

```powershell
npx --no-install tsc --noEmit
npm run lint
npm run build
```

For layout or interaction changes, inspect a rendered page at about 390 px and
1440 px. Check overflow, keyboard use, form submission and changed states. Use
fixture-intercepted browser requests for isolated frontend checks and distinguish
them from shared-database tests. Report any check that could not be performed.
Do not reset or confirm shared data as part of visual verification. Keep dev
and build output directories separate, and stop temporary servers you start.
Documentation-only changes need link/path and whitespace checks, not a rebuild.

When a commit/push is requested, stage explicit owned paths. Keep `.env` edits,
secrets, local knowledge notes and browser artifacts out of the commit. Follow
the team's pull/rebase workflow, never force-push, and report the actual result.

## Reference provenance

Design dimensions adapted for this project from the
[frontend aesthetics cookbook](https://platform.claude.com/cookbook/coding-prompting-for-frontend-aesthetics).
Codex instruction discovery follows
[OpenAI's AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
This adaptation needs no Anthropic client, API key or model change.
