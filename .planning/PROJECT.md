# emoryHackathonDietary (working title)

## What This Is

A renal dietitian you can FaceTime. People with kidney disease or on dialysis call a number, show the agent their fridge, a plate, or a food label, and get spoken guidance that respects their sodium, potassium, phosphorus and fluid limits. There is no app to install: the whole product is a FaceTime call, which older patients already know how to make. The agent also calls the patient at mealtimes and can stay on the call while they shop in a store.

Built by a team of three for a hackathon with roughly 36 hours to submission, targeting the Chert, Gemini API and Rogue/Beginners tracks.

## Core Value

A kidney patient can FaceTime the agent, point the camera at food, and hear a correct, specific answer to "can I eat this?" based on their own limits.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Patient can FaceTime the agent's line and have a spoken conversation with an agent that can look at their camera on request (snapshot, not continuous video)
- [ ] Agent knows the patient's renal limits (sodium, potassium, phosphorus, fluid) and any goals, set up before the call
- [ ] Patient can show a food label, plate or fridge and get a yes / no / "this instead" answer tied to their limits
- [ ] Agent can propose a meal from what it sees in the fridge that fits the patient's limits
- [ ] Agent calls the patient by FaceTime at a mealtime to check in ("show me your plate") — twist 3
- [ ] Patient can stay on the call while shopping in a store, pointing at shelves and labels for guidance — twist 4
- [ ] Agent states on the call that it works within limits set by the patient's care team and is not a replacement for them
- [ ] Gemini drives a browser to fill a grocery cart for missing items, shown as the agent's video on the call, stopping before payment (avatar-only with narration is the fallback) — sequenced after the three twists
- [ ] Demo video: real recordings of the product, with Higgsfield-generated opening and closing shots

### Out of Scope

- Paying or checking out — the agent stops at a filled cart and asks; no payment automation
- Reading lab results from a held-up lab sheet (twist 2) — not selected; limits are entered at setup instead
- Other verticals (gestational diabetes, GLP-1 users, allergy parents, general dieting) — the Chert representative advised going deep on one group
- A mobile or web app for patients — "no app, just FaceTime" is the point (twist 1)
- Ordering from DoorDash or Uber Eats — no public consumer ordering API was found
- Diagnosing, changing prescriptions, or setting medical limits — the agent applies limits the care team set
- Walmart API — access needs approval and appears read-only

## Context

**How the idea evolved.** It started as a general personalised food agent (shopping, diet plans, recipes) with three entry points: fridge-first, goal-first and moment-first. A Chert representative advised picking one vertical of people who badly need dietitians and adding a twist for novelty. The team chose kidney disease with three twists: no app (1), the agent calls you (3), and in-aisle shopping (4).

**Why kidney disease.** The renal diet limits sodium, potassium, phosphorus and often fluids at once; foods usually thought of as healthy (bananas, beans, whole grains) can be wrong; phosphorus is not required on US nutrition labels and has to be spotted in ingredient lists. The rules are numeric, so an agent can track them. Many patients are older, which is what makes "no app, just FaceTime" matter.

**Chert (sponsor).** YC-backed; gives an agent a real Apple line for FaceTime audio/video and iMessage. Facts from the setup doc and `chert guide`:
- Agents are LiveKit agents connected with `chert dev`; both the agent and `chert dev` must stay running.
- The caller sees whatever video track the speaking participant publishes, so custom video (a browser screen) is feasible. Audio and video must come from the same participant; exactly one unmuted audio track.
- The agent must greet within 10 seconds of the `bridge_ready` signal or the call ends.
- Outbound FaceTime calls exist in the HTTP API (`POST /api/v1/calls`); on a shared line only phones verified for the project can be reached.
- Starter: `chert new <dir> --video`; examples `examples/video-agent` in the CLI repository.
- Onboarding is done: account and project exist, line +1 (628) 224-4223, this computer is signed in as project owner. Teammates can join by texting the join phrase to the line.

**Gemini.** Used for vision and conversation on the call, and (from memory, unverified) a computer-use model for driving the browser. Model names and access need checking in the current docs.

**Shopping options researched.** Instacart Developer Platform turns an ingredient list into a shoppable link with self-service development keys (official docs). Kroger's public API adds items to a logged-in customer's cart but needs user sign-in. Browser automation works on any store but is slow and hits logins and bot detection; use a pre-logged-in session on one store.

**Demo.** The team wants an impressive demo video using Higgsfield for cinematic story shots around real product footage. Generated footage must not stand in for the product working. Whether the demo is a submitted video, a live pitch or both is not yet known.

**Team split (decided 13 November).** Three tracks, one folder each, joined by the shared contract that opens `agent/README.md`, `renal/README.md` and `actions/README.md`: Track A the call (`agent/`), Track B the renal brain (`renal/`), Track C reaching out and shopping (`actions/`). This planning directory lives on the `agent` branch and its requirements and roadmap cover Track A only; Tracks B and C are built by teammates on their own branches and reach Track A through the contract's functions, stubbed until they merge.

**Findings from reading the installed packages and Chert's docs (13 November).**
- Chert's starter is Node (ES modules) on `@livekit/agents` 1.8.0, `@livekit/rtc-node` 0.13.35. Those versions are pinned.
- In `@livekit/agents-plugin-google` (1.8.0 and 1.10.0) the Gemini voice model discards video frames. The agent therefore reads the camera as snapshots: grab the caller's latest frame, send it to Gemini through Track B's `describeImage`.
- Seeing the caller ("caller capture") is a separate per-line opt-in at Chert. It must be confirmed with Chert staff for the team's line.
- The caller only sees video published by the participant that speaks, so the shopping browser is shown through the agent's own video track; Track C supplies frames.
- Outbound calls need a prepared LiveKit room with the agent already publishing, and a line enabled for outbound.

**Open questions.**
- Is caller capture enabled on the team's line?
- Which Gemini Live model works with plugin 1.8.0, including the greeting? Fallback is the starter's OpenAI Realtime voice.
- Does the free trial allow outbound calls, and to which numbers?
- Which Gemini model handles live video and speech inside a LiveKit agent?
- Trial validity: the CLI says 24 hours from activation, the setup doc says 48 hours for trials started by 18 November 2026.

## Constraints

- **Timeline**: about 36 hours from 8:00pm Friday 13 November 2026 — hackathon submission deadline
- **Team**: three people — work should split into parallel tracks
- **Hackathon rules**: the repository could not exist before 8:00pm; all code is written after that
- **Chert trial**: 50 FaceTime minutes in total, 5 minutes per call, one call at a time on the line — testing and demo recording must be rationed, and in-aisle shopping has to work in 5-minute calls
- **Chert line**: with no agent connected the line is held 3 hours (15 minutes when busy) and the number can change if released
- **Tech stack**: Chert FaceTime (required by the track) on LiveKit; Gemini API (required by the track)
- **Accounts needed**: a LiveKit project (the trial uses the team's own) and a Gemini API key; keys go in `.env.local`, never in chat or git
- **Safety**: health guidance for people with a serious condition — the agent applies care-team limits, says so, and never completes a purchase without being asked
- **Repository**: owned by a teammate (OwenCodin/emoryHackathonDietary); pushes affect the whole team

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| One vertical: kidney disease and dialysis patients | Chert representative's advice; hardest diet to follow alone, numeric rules, older users | — Pending |
| Twists 1, 3 and 4: no app, agent calls you, in-aisle shopping | Team's choice for novelty | — Pending |
| Use Chert's FaceTime API, not iMessage | Team requirement for the Chert track; camera is central to food | — Pending |
| Gemini for vision, conversation and browser control | Covers the Gemini track; replaces grocery store APIs for cart filling | — Pending |
| Custom video (browser on the call) is the goal; avatar only if too hard | Strongest demo; fallback keeps the build safe | — Pending |
| Agent stops at a filled cart and asks before buying | Safety and honesty; mirrors how consumer shopping agents behave | — Pending |
| Higgsfield for story shots only, real recordings for the product | Polished demo without faking functionality | — Pending |
| Limits entered at setup, not read from lab sheets | Twist 2 not selected | — Pending |
| Three tracks (agent, renal, actions) joined by a shared contract; this plan covers Track A | Three people working in parallel on separate branches | — Pending |
| Camera is read as on-demand snapshots, not live video | The Node Gemini voice plugin discards video frames | — Pending |
| Keep Chert's pinned LiveKit versions (1.8.0 / rtc-node 0.13.35) | Newer packages need rtc-node 1.x, untested with Chert's starter | — Pending |
| Browser frames go through the agent's video track | Chert shows video only from the speaking participant | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-13 after team split and Chert/LiveKit findings*
