# FaceTime call UI

The call visual is rendered into the agent's LiveKit video track, not a browser component. It uses the existing 1280×720 frame and runs at 30 fps. A calm navy scene holds one teal-to-blue orb, one status strip, and one bottom-left information card; the lower-right safe area is left open for the caller's self-view tile.

## Design tokens

The source of truth is `UI_TOKENS` in `agent/card.mjs`.

- Colors: deep navy background, lighter blue-charcoal surface, soft teal/blue orb. Green, amber, and red are reserved for the verdict card.
- Spacing: 4/8/12/16/24/32/48 px scale; card radius 28 px; chip radius 14 px.
- Typography: one system sans-serif family, 22 px body, 30 px title, 52 px verdict word (sized to remain legible after safe-area scaling).
- Motion: 400 ms scene cross-fade; idle breathing, listening ring, looking sweep, slow thinking gradient, and smoothed audio-reactive speaking scale. Reduced motion disables rings, rotation, and ripples.

Set `AGENT_REDUCED_MOTION=1` to use the reduced-motion treatment. The video-agent host cannot read the caller device's `prefers-reduced-motion` setting, so this is a host-side accessibility override.

## Panel event contract

`agent/ui-state.mjs` defines the JSDoc `PanelEvent` union and validates every event before storing it. The store permits one visible panel:

```js
{ type: 'summary', meters: [{ key, label, used, limit, unit }] }
{ type: 'verdict', verdict: 'yes' | 'caution' | 'no', food, reason, alternative?, nutrients?: [{ label, level, note? }] }
{ type: 'note', heading, body, icon? }
{ type: 'cart', items: [{ name, qty? }], estimatedTotal?, status: 'draft' | 'confirming' | 'ordered' }
```

Summary values and verdict explanations must come from the agent/backend; the renderer does not calculate dietary limits or create judgments. Invalid payloads are ignored. Verdicts return to the last summary after 12 seconds by default; `AGENT_CARD_SECONDS` keeps its existing bounded override. Current food-check results are adapted from the existing renal tool display event; only the explanation returned by that result is shown as the reason. No patient budgets are fabricated when a summary event is unavailable.

Agent state is `idle`, `listening`, `looking`, `thinking`, or `speaking`. State and camera-tool activity reuse the existing LiveKit/tool events. Speaking amplitude is measured from PCM frames passed to the LiveKit audio output; if a host output cannot be wrapped, the orb uses a quiet non-rhythmic speaking fallback without ripples. The listening ring accepts a real microphone level through `setMicLevel`; the current call pipeline exposes no caller microphone amplitude, so it remains subtle and steady.

## Run the demo

From the repository root, run:

```sh
npm run ui:demo
```

Open the printed `http://127.0.0.1:4173` URL. The local-only preview cycles through every orb state and all panel types, including YES, CAUTION, and NO verdicts. Its sample nutrient values and reasons exist only in `agent/sim/ui-demo.mjs`; they are not used in the production call path. Set `UI_DEMO_PORT` to choose another local port.

Run the project tests with `npm test`.
