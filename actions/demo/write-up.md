# RenaLine: a renal dietitian over FaceTime

RenaLine is a FaceTime-based assistant for people managing kidney disease or
dialysis. A caller can show a food label, plate, fridge or store shelf and ask
whether a food fits the limits set by their care team. The assistant can also
suggest meals, prepare a grocery list, and send a mealtime reminder by text or
call. It is guidance within the caller's existing care-team limits, not a
replacement for that care team.

## How the actions work

The `actions/` module supplies the shopping and patient-contact functions used
by the agent:

- The cart opens a persistent Playwright browser and uses Gemini computer use
  to look for requested grocery items. It reports confirmed additions and
  prices, or items it could not find. If a store challenge is detected and an
  Instacart API key is configured, it can create a shopping-list link instead.
- Browser screenshots are converted to fixed-size RGBA frames for the agent's
  video track. The actions module returns frames; the calling agent publishes
  them.
- Text messages are restricted to the configured patient number. Requests use
  idempotency keys, and uncertain send outcomes are reported instead of being
  retried with a new key.
- Outbound calls prepare a LiveKit room, dispatch the agent, and request a
  Chert call. The module monitors call events and cleans up the room.

The cart is designed to stop before checkout or payment. Store navigation is
limited to supported HTTPS retailer domains, and sensitive account or payment
details must not be entered. Any model safety request for confirmation pauses
the cart for the patient.

## Demo approach

Generated footage may establish the setting, but it must not portray the
product working. Product behavior should be shown only in genuine recordings:
the agent responding to a label, the cart filling, and a reminder arriving.
Get consent before recording a person or call, use synthetic patient details,
keep credentials and health information off-screen, and stop cart recordings
before checkout. The shot list and context-shot prompts are in
[storyboard.md](./storyboard.md) and
[higgsfield-prompts.md](./higgsfield-prompts.md).

## Verification and remaining work

The repository's offline test suite passed **368 tests** on Node 24.22.3 in
this checkout. These tests use fakes; they do not prove that a store accepts
the browser automation, that a cart can be filled on a live call, or that
Chert will place an outbound call or deliver a live reminder.

Those flows remain unverified. A team member must sign in to a selected store
manually, then run the README's three-item cart check three times without
opening checkout. Chert staff must confirm the trial-line behavior, and a
consented scripted call or text test is still needed. Do not present any of
these flows as live-tested until those checks succeed.
