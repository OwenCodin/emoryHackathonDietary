import { llm } from '@livekit/agents';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
// This is the only file that imports renal/ and actions/.
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
  nothing_seen: 'Show me your fridge or the food you have first, and then I can suggest a meal.',
  nothing_to_log: 'Tell me or show me what you ate first, and then I can log it.',
  nothing_to_buy: "I don't have anything on a shopping list yet. Tell me what you need, or ask me for a meal idea first.",
  cart_busy: "A cart is already being filled. I can tell you how it's going.",
  no_cart_link: "The cart isn't ready yet, so there's no link to send. I can check on it for you.",
  no_phone: "I don't have a phone number to text, so I can't send the link.",
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
  phone = process.env.PATIENT_PHONE,
} = {}) {
  let lastFoods = []; // names from the last look or check
  let lastVerdicts = [];
  let lastMissing = []; // CartItems the last meal suggestion said are missing
  const phoneOk = typeof phone === 'string' && /^\+[1-9]\d{6,14}$/.test(phone);
  const cut = v => String(v ?? '').trim().slice(0, 80);
  const three = o => ({ sodiumMg: o?.sodiumMg, potassiumMg: o?.potassiumMg, phosphorusMg: o?.phosphorusMg });

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
        lastFoods = [String(name)];
        lastVerdicts = [v];
        return { ok: true, ...row(v) };
      }, timeoutMs),
    }),
    suggest_meal: llm.tool({
      description: 'Suggest meals to cook from the foods the caller last showed on camera, within their limits.',
      execute: guard(async () => {
        if (lastFoods.length === 0) return fail('nothing_seen');
        const got = await renal.getProfile({ patientId });
        if (!got?.ok) return fail('profile_unavailable');
        const r = await renal.suggestMeals({ foods: lastFoods, profile: got.profile, count: 2 });
        const meals = Array.isArray(r?.meals) ? r.meals : [];
        if (!r?.ok || meals.length === 0) return fail('check_failed');
        const seen = new Map();
        for (const m of meals) for (const item of m.missing ?? []) {
          const key = String(item?.name ?? '').trim().toLowerCase();
          if (key && !seen.has(key)) seen.set(key, { name: String(item.name), quantity: String(item.quantity ?? '') });
        }
        lastMissing = [...seen.values()];
        return { ok: true, meals: meals.map((m, i) => ({
          title: m.title, minutes: m.minutes, why: m.why,
          missing: (m.missing ?? []).map(x => x.name),
          ...(i === 0 ? { steps: (m.steps ?? []).slice(0, 3) } : {}),
        })) };
      }, timeoutMs),
    }),
    log_meal: llm.tool({
      description: 'Log what the caller just ate: the foods from the last look or food check.',
      execute: guard(async () => {
        if (lastVerdicts.length === 0) return fail('nothing_to_log');
        for (const verdict of lastVerdicts) {
          const r = await renal.logFood({ patientId, verdict });
          if (!r?.ok) return fail('tool_failed');
        }
        const logged = lastVerdicts.map(v => String(v.food));
        lastVerdicts = [];
        return { ok: true, logged };
      }, timeoutMs),
    }),
    todays_totals: llm.tool({
      description: 'How much sodium, potassium and phosphorus the caller has had today and how much is left.',
      execute: guard(async () => {
        const r = await renal.getToday({ patientId });
        if (!r?.ok) return fail('tool_failed');
        return { ok: true, totals: three(r.totals), remaining: three(r.remaining) };
      }, timeoutMs),
    }),
    start_cart: llm.tool({
      description: 'Start filling an online grocery cart with items the caller needs. Pass an empty list to use the missing items from the last meal suggestion. This never pays or checks out.',
      parameters: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.string() })) }),
      execute: guard(async ({ items }) => {
        let list = (Array.isArray(items) ? items : []).map(i => ({ name: cut(i?.name), quantity: cut(i?.quantity) })).filter(i => i.name);
        if (list.length === 0) list = lastMissing.map(i => ({ name: cut(i.name), quantity: cut(i.quantity) })).filter(i => i.name);
        list = list.slice(0, 12);
        if (list.length === 0) return fail('nothing_to_buy');
        const r = await actions.startCart({ items: list });
        if (r?.error === 'busy') return fail('cart_busy');
        if (!r?.ok) return fail('tool_failed');
        return { ok: true, started: true, items: list.map(i => i.name) };
      }, timeoutMs),
    }),
    cart_status: llm.tool({
      description: 'How the grocery cart is going.',
      execute: guard(async () => {
        const s = await actions.getCartStatus();
        if (!s?.ok) return fail('tool_failed');
        return { ok: true, state: s.state, step: s.step, added: (s.added ?? []).map(a => a.name), missing: s.missing ?? [], total: s.total };
      }, timeoutMs),
    }),
    text_cart_link: llm.tool({
      description: 'Text the caller a link to their filled cart so they can review it and check out themselves.',
      execute: guard(async () => {
        if (!phoneOk) return fail('no_phone');
        const s = await actions.getCartStatus();
        if (!s?.ok) return fail('tool_failed');
        if (!s.cartUrl) return fail('no_cart_link');
        const r = await actions.sendText({ phone, text: `Your grocery cart from your renal dietitian is ready to review: ${s.cartUrl} Nothing has been paid; please check it and check out yourself.` });
        if (!r?.ok) return fail('tool_failed');
        return { ok: true, sent: true };
      }, timeoutMs),
    }),
  };
}
