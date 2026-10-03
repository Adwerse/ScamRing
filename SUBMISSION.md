# ScamRing submission

## Description (120 words)

ScamRing helps students assess suspicious rental listings before paying a deposit. Users paste a listing or upload photos and receive an explained risk verdict. MongoDB links reports through hashed contact identifiers, reused photos and similar descriptions. Five signals combine those connections with known scam scripts and Irish rent references. Moderators record decisions and audit events in one transaction. A worker watches confirmations, recomputes linked verdicts and creates session alerts. Server-sent events deliver these session alerts, with polling as a fallback. The prototype uses MongoDB Atlas, Next.js and synthetic demo listings. Contact details are redacted and pending reports expire. We aim to help students recognise repeated scam activity and give student union moderators evidence they can review before a student pays.

## Links and team

- Repository: https://github.com/Adwerse/ScamRing
- Backup video: [ADD VIDEO LINK]
- Team name: [ADD TEAM NAME]
- A / Core: Adam [ADD FULL NAME]
- B / Data and signals: [ADD NAME]
- C / Frontend: [ADD NAME]
- D / Realtime and release: [ADD NAME]
- Browser slides: [docs/pitch.html](docs/pitch.html)
- PDF slides: [docs/ScamRing-pitch.pdf](docs/ScamRing-pitch.pdf)

The description describes implemented prototype capabilities. Complete the integration gates below before submitting it as the demonstrated end-to-end result. Risk levels indicate evidence, not proof of fraud.

## Before submission

- [ ] Fill in the team names and video link here and in the slides.
- [x] AlertToast is mounted in the layout and report state refreshes on matching alerts.
- [ ] A verifies the shared vector indexes are queryable.
- [ ] B prepares and imports the shared seed with the shared identifier secret and photo files.
- [ ] D runs calibration: every ring at least MEDIUM, at least 95% of legitimate seed listings LOW.
- [ ] D runs real HTTP smoke with --shared and gets all PASS.
- [ ] C and D rehearse the two-browser confirmation: toast and HIGH verdict within two seconds.
- [ ] Verify the proof page shows actual index and query evidence.
- [ ] Rehearse the three-minute flow twice, then record the two-minute backup video.
- [ ] B reseeds after smoke/rehearsals and before the final demo.
- [ ] Keep private env files out of commits and handle any previously committed secrets.
- [ ] A tags the agreed demo-ready revision after the team completes acceptance.
- [ ] Submit the repo and video links through the organisers' form. The plan targets 15:50 Dublin time on 3 October 2026.

## Demo run (3 minutes)

| Time | Screen | Speaker cue |
| --- | --- | --- |
| 0:00–0:25 | Slides 1–2 | Student rental scams repeat across listings. Introduce the verified Garda figures. |
| 0:25–0:55 | Check page, payment-handle preset | Show the actual MEDIUM verdict and explain the evidence. |
| 0:55–1:20 | Second browser /moderate, then first browser | Confirm a linked report. Show the toast and HIGH verdict. |
| 1:20–1:50 | Reused-photo preset and ring | Show how new contact details can still connect through photos. |
| 1:50–2:30 | Slide 3 and /under-the-hood | Explain indexed traversal, vector search, transaction and change streams. Show actual query evidence. |
| 2:30–3:00 | Slide 4 | Introduce the team and the next step: student-union moderators and messaging intake. |

For the backup video, shorten the introduction and proof explanation while keeping the real check, confirmation and alert visible. If the team uses inline fan-out or polling, describe that path accurately. Do not claim the untested delivery target or real-world detection accuracy.
