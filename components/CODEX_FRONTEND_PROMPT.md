# Frontend task prompt for Codex

Open the `ScamRing` repository as the Codex project. Its root `AGENTS.md`
provides the persistent frontend guidance. Start a new session to load new
instruction files; in an existing session, explicitly ask Codex to read them.
Replace the bracketed task below with the change you want. This prompt is for
editing the real project, rather than generating an isolated HTML demo.

```text
Read AGENTS.md, CLAUDE.md, CONTRACT.md and the relevant fixtures first.
If local .knowledge-base design/integration notes exist, consult them too.

Task: [describe the user-visible change and which page it affects].

Work in Lane C and preserve other lanes' files and all existing local edits.
Briefly state the intended visual direction, then implement the change.
Use ScamRing's calm investigative style: light evidence surfaces, dark ink,
MongoDB palette roles and a clear contrast between headings and interface text.
Keep the listing input prominent and use the connection map to explain evidence.
Make deliberate decisions about typography, colour, motion, background and
composition where those dimensions help this specific task. Preserve approved
design decisions and favour clarity over decoration.

Keep real API-driven verdicts, frozen payloads, protected manual rent edits,
weekly/yearly-to-monthly conversion, photo handling and honest link behaviour.
Cover loading, empty, error and success states affected by the change.
Preserve keyboard use, labels, visible focus, reduced motion and graph fallback.

Verify changed behaviour and inspect 390 px and 1440 px browser views when
available. Run TypeScript, lint and production build after code changes.
Use fixtures only in explicit isolated tests; do not reset shared demo data.
Finish with what changed, what passed and any unverified integration behaviour.
```

For a focused pass, append one of these scopes:

- Typography: improve heading/evidence hierarchy within the approved font pair;
  preserve layout and interaction behaviour.
- Composition: improve first-screen input access or verdict/evidence grouping;
  preserve palette and API contracts.
- Interaction: improve one loading, disclosure, refresh or evidence-selection
  state; use purposeful motion with a reduced-motion alternative.
- Audit: inspect the rendered pages, fix concrete frontend bugs within Lane C
  and report remaining issues by owner. Avoid an unrelated redesign.

The shared knowledge base remains ignored by Git; this prompt and `AGENTS.md`
can travel with the repository without requiring local notes or extra packages.
