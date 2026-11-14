import { llm } from '@livekit/agents';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
// This is the only file that imports renal/ and actions/. The remaining tools (suggest_meal, log_meal,
// todays_totals, start_cart, cart_status, text_cart_link) arrive in plan 03-02.
import * as renalModule from '../renal/index.mjs';
import * as actionsModule from '../actions/index.mjs';

const WORDS = { ok: 'Yes', avoid: 'No', limit: 'Small portion' };

// One spoken sentence per food: the verdict word first, then the module's say, at most two sentences.
export function spokenVerdict(verdict) {
  const word = WORDS[verdict?.verdict] ?? "I can't tell";
  const say = typeof verdict?.say === 'string' ? verdict.say.trim() : '';
  if (!say) return `${word}.`;
  let text = say.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  // Lower-case the first letter, except for "I", "I'm" and acronyms such as USDA.
  if (!/^I(?![A-Za-z])/.test(text) && !/^[A-Z][A-Z]/.test(text)) text = text[0].toLowerCase() + text.slice(1);
  let out = `${word}, ${text}`;
  if (out.length > 240) {
    out = out.slice(0, 240);
    const cut = out.lastIndexOf(' ');
    if (cut > 0) out = out.slice(0, cut);
  }
  return out;
}

// Our own short codes and plain sentences. A module's error text is never copied into a result.
const FAILS = {
  no_camera_picture: "I can't see your camera right now. Please turn your camera on and hold the food still in front of it.",
  unclear_picture: "I couldn't make that out. Please hold it a little closer and keep it still.",
  profile_unavailable: "I can't reach your care plan right now, so I won't guess. Let's try again in a moment.",
  check_failed: "I couldn't check that just now. Let's try again in a moment.",
  tool_failed: "I couldn't check that just now. Let's try again in a moment.",
  timeout: "That is taking too long. Let's try again in a moment.",
};
const fail = error => ({ ok: false, error, say: FAILS[error] });

function shrink(value) {
  if (typeof value === 'string') return value.slice(0, 200);
  if (Array.isArray(value)) return value.slice(0, 3).map(shrink);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v)]));
  return value;
}
function fit(result) {
  if (JSON.stringify(result).length <= 600) return result;
  const small = shrink(result);
  return JSON.stringify(small).length <= 600 ? small : fail('tool_failed');
}

function guard(fn, timeoutMs) {
  return async (...args) => {
    let timer;
    try {
      const timedOut = new Promise(resolve => { timer = setTimeout(() => resolve(fail('timeout')), timeoutMs); });
      const result = await Promise.race([fn(...args), timedOut]);
      if (!result || typeof result !== 'object') return fail('tool_failed');
      return fit(result);
    } catch {
      return fail('tool_failed');
    } finally {
      clearTimeout(timer);
    }
  };
}

const row = v => ({ food: v.food, verdict: v.verdict, spoken: spokenVerdict(v), swap: v.swap ?? null });

export function buildTools({
  camera,
  patientId = 'demo',
  renal = renalModule,
  actions = actionsModule,
  debugFrameDir = process.env.AGENT_DEBUG_FRAME_DIR,
  timeoutMs = 12000,
} = {}) {
  let lastFoods = []; // names from the last look, for plan 03-02
  let lastVerdicts = [];
  void actions;
  void lastFoods;
  void lastVerdicts;

  return {
    // Anonymous tools: the object key is the tool name.
    look_at_camera: llm.tool({
      description: 'Look at what the caller is showing on camera right now (a food label, plate, fridge or shelf) and judge it against their limits. Call this every time they ask about something in view; each call takes a new picture.',
      execute: guard(async () => {
        const picture = camera ? await camera.jpeg() : null;
        if (!picture) return fail('no_camera_picture');
        if (typeof debugFrameDir === 'string' && debugFrameDir) {
          try {
            await mkdir(debugFrameDir, { recursive: true });
            await writeFile(join(debugFrameDir, `frame-${Date.now()}.jpg`), picture);
            console.log('[agent] debug frame saved');
          } catch { /* a failed debug write never fails the tool */ }
        }
        const seen = await renal.describeImage({ jpeg: picture });
        if (!seen?.ok || seen.kind === 'unclear') return fail('unclear_picture');
        const got = await renal.getProfile({ patientId });
        if (!got?.ok) return fail('profile_unavailable');
        const foods = seen.label?.product
          ? [{ name: seen.label.product, label: seen.label }]
          : (Array.isArray(seen.foods) ? seen.foods : []).slice(0, 6);
        if (foods.length === 0) return fail('unclear_picture');
        const verdicts = await Promise.all(foods.map(async food => {
          try { return await renal.checkFood({ food, profile: got.profile }); } catch { return null; }
        }));
        const results = [];
        const good = [];
        verdicts.forEach((v, i) => {
          if (v?.ok === true) { results.push(row(v)); good.push(v); }
          else results.push({ food: String(foods[i].name), verdict: 'unknown', spoken: "I can't tell, I couldn't check that one just now." });
        });
        if (good.length === 0) return fail('check_failed');
        lastFoods = foods.map(f => f.name);
        lastVerdicts = good;
        return { ok: true, kind: seen.kind, results };
      }, timeoutMs),
    }),
    check_food: llm.tool({
      description: 'Judge a food the caller names without showing it.',
      parameters: z.object({ name: z.string(), grams: z.number().nullable() }),
      execute: guard(async ({ name, grams }) => {
        const got = await renal.getProfile({ patientId });
        if (!got?.ok) return fail('profile_unavailable');
        const v = await renal.checkFood({ food: { name, grams }, profile: got.profile });
        if (v?.ok !== true) return fail('check_failed');
        lastVerdicts = [v];
        return { ok: true, ...row(v) };
      }, timeoutMs),
    }),
  };
}
