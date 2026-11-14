<!-- GSD:project-start source:PROJECT.md -->
## Project

**emoryHackathonDietary (working title)**

A renal dietitian you can FaceTime. People with kidney disease or on dialysis call a number, show the agent their fridge, a plate, or a food label, and get spoken guidance that respects their sodium, potassium, phosphorus and fluid limits. There is no app to install: the whole product is a FaceTime call, which older patients already know how to make. The agent also calls the patient at mealtimes and can stay on the call while they shop in a store.

Built by a team of three for a hackathon with roughly 36 hours to submission, targeting the Chert, Gemini API and Rogue/Beginners tracks.

**Core Value:** A kidney patient can FaceTime the agent, point the camera at food, and hear a correct, specific answer to "can I eat this?" based on their own limits.

### Constraints

- **Timeline**: about 36 hours from 8:00pm Friday 13 November 2026 — hackathon submission deadline
- **Team**: three people — work should split into parallel tracks
- **Hackathon rules**: the repository could not exist before 8:00pm; all code is written after that
- **Chert trial**: 50 FaceTime minutes in total, 5 minutes per call, one call at a time on the line — testing and demo recording must be rationed, and in-aisle shopping has to work in 5-minute calls
- **Chert line**: with no agent connected the line is held 3 hours (15 minutes when busy) and the number can change if released
- **Tech stack**: Chert FaceTime (required by the track) on LiveKit; Gemini API (required by the track)
- **Accounts needed**: a LiveKit project (the trial uses the team's own) and a Gemini API key; keys go in `.env.local`, never in chat or git
- **Safety**: health guidance for people with a serious condition — the agent applies care-team limits, says so, and never completes a purchase without being asked
- **Repository**: owned by a teammate (OwenCodin/emoryHackathonDietary); pushes affect the whole team
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
