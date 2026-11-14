import { llm } from '@livekit/agents';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// This is the only file that imports renal/ and actions/.
import * as renalModule from '../renal/index.mjs';
import * as actionsModule from '../actions/index.mjs';
import { mergePantry, matchPantry, PANTRY_MAX } from './memory.mjs';

const WORDS = { ok: 'Yes', avoid: 'No', limit: 'Small portion' };
const RANK = { avoid: 0, limit: 1, unknown: 2, ok: 3 };
const PICK = { ok: 0, limit: 1, unknown: 2, avoid: 3 };
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Text that came from another track's module: plain characters only, no links, bounded length.
const clean = (value, max) => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return raw.replace(/https?:\/\/\S+/gi, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
};

const ABBREVIATIONS = new Set(['approx', 'appx', 'e.g', 'i.e', 'vs', 'st', 'dr', 'mr', 'mrs', 'ms', 'oz', 'tbsp', 'tsp', 'avg', 'est', 'incl', 'inc', 'co', 'fl']);

// Splits at a full stop only when it ends a sentence: not after an abbreviation such as "approx.",
// and only when the next sentence starts with a capital letter or a quote.
function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?]+["')\]]*\s+/g;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const lastWord = (text.slice(start, m.index).match(/([A-Za-z.]+)$/)?.[1] ?? '').toLowerCase();
    if (m[0][0] === '.' && ABBREVIATIONS.has(lastWord)) continue;
    if (!/[A-Z"'(\[]/.test(text[end] ?? '')) continue;
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

// Lower-case the first letter of the module's sentence so it follows "Yes, ", except for "I", acronyms,
// words with a capital inside (iPhone) and a first word that is capitalised in the food's name (a brand).
function lowerFirst(text, food) {
  const first = text.match(/^[A-Za-z][A-Za-z'’-]*/)?.[0];
  if (!first || !/^[A-Z]/.test(first)) return text;
  if (/^I(?![A-Za-z])/.test(text) || /^[A-Z]{2}/.test(first) || /^[A-Za-z][a-z]*[A-Z]/.test(first)) return text;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (typeof food === 'string' && new RegExp(`(^|[^A-Za-z])${escaped}([^A-Za-z]|$)`).test(food)) return text;
  return text[0].toLowerCase() + text.slice(1);
}

// One spoken sentence per food: the verdict word first, then the module's say, at most two sentences.
// max caps the length; text is shortened at a sentence or word boundary, never silently dropped as a food.
export function spokenVerdict(verdict, max = 240) {
  const word = WORDS[verdict?.verdict] ?? "I can't tell";
  // The module may already start with a verdict word; ours is the one that is said.
  const say = clean(verdict?.say, 1000).replace(/^(yes|no|small portion|i can't tell)\s*[,.:!;-]+\s*/i, '');
  if (!say || max <= word.length + 3) return `${word}.`;
  const sentences = splitSentences(say);
  for (const count of [2, 1]) {
    const text = sentences.slice(0, count).join(' ');
    const out = `${word}, ${lowerFirst(text, verdict?.food)}`;
    if (out.length <= max) return out;
  }
  const room = max - 1; // leave space for the closing full stop
  const out = `${word}, ${lowerFirst(sentences[0], verdict?.food)}`.slice(0, room);
  const cut = out.lastIndexOf(' ');
  if (cut <= word.length + 2) return `${word}.`;
  return `${out.slice(0, cut).replace(/[\s,;:-]+$/, '')}.`;
}

// Our own short codes and plain sentences. A module's error text is never copied into a result.
const FAILS = {
  no_camera_picture: "I can't see your camera right now. Please turn your camera on and hold the food still in front of it.",
  unclear_picture: "I couldn't make that out. Please hold it a little closer and keep it still.",
  vision_failed: "I couldn't look at that just now. Please hold it still and ask me again.",
  label_unreadable: "I can't read enough on that side of the package. Please show me the front of the package, or hold the nutrition panel a little closer.",
  no_food_seen: "I couldn't spot any food there. Please point the camera at the food and keep it still.",
  profile_unavailable: "I can't reach your care plan right now, so I won't guess. Let's try again in a moment.",
  check_failed: "I couldn't check that just now. Let's try again in a moment.",
  tool_failed: "I couldn't check that just now. Let's try again in a moment.",
  timeout: "That is taking too long. Let's try again in a moment.",
  bad_food: 'Tell me which food you mean, in a few words.',
  bad_amount: "I didn't catch the amount. Tell me roughly how much it is, or skip the amount.",
  nothing_seen: 'Show me your fridge or the food you have first, and then I can suggest a meal.',
  nothing_to_log: 'Tell me or show me what you ate first, and then I can log it.',
  nothing_to_buy: "I don't have anything on a shopping list yet. Tell me what you need, or ask me for a meal idea first.",
  cart_busy: "A cart is already being filled. I can tell you how it's going.",
  cart_unconfirmed: "I asked for the cart but haven't heard back yet. Let me check how it's going before we try again.",
  cart_failed: "The cart didn't work out. I can try again if you like.",
  no_cart_link: "The cart isn't ready yet, so there's no link to send. I can check on it for you.",
  link_already_sent: "I've already texted you that link. Please check your messages.",
  no_phone: "I don't have a phone number to text, so I can't send that.",
  no_recipe: "I haven't suggested a meal yet. Ask me for a meal idea first, and then I can text you the recipe.",
  which_recipe: 'Which meal should I text you? Tell me its name, or say the first or the second.',
  recipe_already_sent: "I've already texted you that recipe. Please check your messages.",
  text_unconfirmed: "I tried to text the recipe but couldn't confirm it went through. Please check your messages before we try again.",
  text_failed: "I couldn't send the recipe just now. I can try again if you like.",
  not_in_pantry: "I don't have that in what I remember from your kitchen.",
  memory_unavailable: "I can't keep a shopping list right now, but I can still check foods for you.",
  bad_items: 'Tell me the items you need, a few words each.',
  bad_item: 'Tell me which item you mean, in a few words.',
};
// renal/check.mjs composes "Okay, this product has about N milligrams of sodium." from this name.
const UNNAMED_PRODUCT = 'this product';
const TOO_LONG = "Done, but there's too much detail to read out. Ask me about one part at a time.";
const fail = (error, extra = {}) => ({ ok: false, error, say: FAILS[error], ...extra });

const RECIPE_CLOSING = 'This recipe follows the limits set by your care team and does not replace their advice.';

// Plain text for one suggested meal, built only from cleaned fields (see lastMeals in suggest_meal). Pure.
export function recipeText(meal) {
  const title = clean(meal?.title, 80) || 'your meal';
  const uses = (Array.isArray(meal?.uses) ? meal.uses : []).map(u => clean(u, 60)).filter(Boolean);
  const missing = (Array.isArray(meal?.missing) ? meal.missing : [])
    .map(m => ({ name: clean(m?.name, 80), quantity: clean(m?.quantity, 40) })).filter(m => m.name);
  const steps = (Array.isArray(meal?.steps) ? meal.steps : []).map(x => clean(x, 300)).filter(Boolean);
  const why = clean(meal?.why, 300);
  const minutes = Number.isInteger(meal?.minutes) && meal.minutes > 0 ? meal.minutes : null;
  const build = n => [
    `Recipe from your AI renal dietitian: ${title}`,
    `Uses from your kitchen: ${uses.length ? uses.join(', ') : 'nothing from your kitchen'}`,
    `Missing: ${missing.length ? missing.map(m => (m.quantity ? `${m.name} (${m.quantity})` : m.name)).join(', ') : 'nothing'}`,
    ...(minutes ? [`Time: about ${minutes} minutes`] : []),
    'Steps:',
    ...steps.slice(0, n).map((x, i) => `${i + 1}. ${x}`),
    ...(why ? [`Why it fits: ${why}`] : []),
    RECIPE_CLOSING,
  ].join('\n');
  let n = steps.length;
  let text = build(n);
  while (text.length > 4000 && n > 0) text = build(--n);
  return text.length > 4000 ? `${text.slice(0, 3999 - RECIPE_CLOSING.length).trimEnd()}\n${RECIPE_CLOSING}`.slice(0, 4000) : text;
}

const size = value => JSON.stringify(value).length;

// Shortens text and lists, and says how many list entries were left out; never drops them silently.
function shrink(value) {
  if (typeof value === 'string') return value.slice(0, 160);
  if (Array.isArray(value)) return value.slice(0, 3).map(shrink);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = shrink(v);
      if (Array.isArray(v) && v.length > 3) out[`${k}Omitted`] = v.length - 3;
    }
    return out;
  }
  return value;
}
function fit(result, limit) {
  if (size(result) <= limit) return result;
  const small = shrink(result);
  if (size(small) <= limit) return small;
  // A short safe summary: a successful action stays successful, a failure stays a failure.
  return result.ok === true ? { ok: true, say: TOO_LONG } : fail('tool_failed');
}

// fn receives a per-call token first. When the call times out, token.timedOut becomes true and the
// work that is still running must not change remembered state or start anything new.
function guardTool(fn, { timeoutMs, limit = 600, onTimeout = () => fail('timeout'), activity = () => {} }) {
  return async (...args) => {
    const call = { timedOut: false };
    let timer;
    try { activity(1); } catch { /* a hook never changes a result */ }
    try {
      const timedOut = new Promise(resolve => { timer = setTimeout(() => { call.timedOut = true; resolve(onTimeout()); }, timeoutMs); });
      const work = Promise.resolve().then(() => fn(call, ...args));
      work.catch(() => {}); // a late failure after the timeout is not reported twice
      const result = await Promise.race([work, timedOut]);
      if (!result || typeof result !== 'object') return fail('tool_failed');
      return fit(result, limit);
    } catch {
      return fail('tool_failed');
    } finally {
      clearTimeout(timer);
      try { activity(-1); } catch { /* a hook never changes a result */ }
    }
  };
}

const normalVerdict = v => (Object.hasOwn(RANK, v) ? v : 'unknown');

// Picks the best checked food: ok, then limit, then unknown; never avoid, never a failed check.
// Ties go to the lowest largest share of a daily limit, then to the order seen. Pure.
export function pickBest(verdicts, limits) {
  const share = n => {
    let worst = -Infinity;
    for (const k of ['sodiumMg', 'potassiumMg', 'phosphorusMg']) {
      const have = n?.[k];
      const cap = limits?.[k];
      if (Number.isFinite(have) && have >= 0 && Number.isFinite(cap) && cap > 0) worst = Math.max(worst, have / cap);
    }
    return worst === -Infinity ? Infinity : worst;
  };
  const rows = (Array.isArray(verdicts) ? verdicts : [])
    .map((v, i) => ({ v, i, rank: PICK[normalVerdict(v?.verdict)], share: share(v?.nutrients) }))
    .filter(r => r.v?.ok === true && r.rank !== PICK.avoid);
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.rank - b.rank || (a.share === b.share ? 0 : a.share < b.share ? -1 : 1) || a.i - b.i);
  return rows[0].v;
}

const NONE_FIT = 'No, none of the items in view fit your limits. Want me to look at another shelf?';
function shelfSpoken(best, fallbackName) {
  if (!best) return { name: null, spoken: NONE_FIT };
  const name = clean(best.food ?? fallbackName, 60);
  const lead = { ok: `Yes, the ${name} is the best choice here.`, limit: `Small portion, the ${name} is the best choice here.` }[normalVerdict(best.verdict)]
    ?? `I can't tell for sure, but the ${name} looks like the best choice here.`;
  const say = clean(best.say, 400).replace(/^(yes|no|small portion|i can't tell)\s*[,.:!;-]+\s*/i, '');
  let why = splitSentences(say)[0] ?? '';
  if (why.length > 110) {
    why = why.slice(0, 109);
    const cut = why.lastIndexOf(' ');
    why = (cut > 0 ? why.slice(0, cut) : why).replace(/[\s,;:.-]+$/, '') + '.';
  }
  return { name, spoken: (lead + (why ? ' ' + why : '')).slice(0, 200) };
}
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// Debug frames hold what the patient showed; keep them private and out of the repository.
async function saveDebugFrame(dir, picture) {
  const target = resolve(dir);
  if (isInside(REPO_ROOT, target)) { console.error('[agent] debug frame folder is inside the repository; refusing to write'); return; }
  await mkdir(target, { recursive: true, mode: 0o700 });
  if (isInside(REPO_ROOT, await realpath(target))) { console.error('[agent] debug frame folder resolves inside the repository; refusing to write'); return; }
  await writeFile(join(target, `frame-${Date.now()}-${randomBytes(4).toString('hex')}.jpg`), picture, { mode: 0o600, flag: 'wx' });
  console.log('[agent] debug frame saved');
}

const LOOK_LIMIT = 900;
const MEALS_LIMIT = 900;
const LIST_LIMIT = 900;

export function buildTools({
  camera,
  patientId = 'demo',
  renal = renalModule,
  actions = actionsModule,
  debugFrameDir = process.env.AGENT_DEBUG_FRAME_DIR,
  timeoutMs = 12000,
  phone = process.env.PATIENT_PHONE,
  onToolActivity = () => {},
  memory = null,
} = {}) {
  // Every tool reports start (+1) and end (-1) so the reply watchdog never nudges while one runs.
  const guard = (fn, opts) => guardTool(fn, { ...opts, activity: onToolActivity });
  let lastFoods = []; // food names from the last look only; suggest_meal cooks from these
  const candidates = new Map(); // judged foods log_meal may log: key -> { names, verdict }
  let lastMissing = []; // CartItems the last meal suggestion said are missing
  const sentLinks = new Set(); // cart links already texted during this call
  const sentRecipes = new Set(); // recipes already texted during this call
  let lastMeals = []; // cleaned meals from the last suggestion, for text_recipe
  let callPantry = []; // in-call copy of the pantry, so it works when memory is missing or unavailable
  const hidden = new Set(); // names forgotten this call even if the stored copy could not be changed
  const pantryNow = async () => {
    let stored = [];
    if (memory) { try { const l = await memory.load(); if (l?.ok) stored = l.state.pantry ?? []; } catch { /* the stored pantry is optional */ } }
    const all = mergePantry(stored, callPantry).list.filter(x => !hidden.has(x.toLowerCase()));
    return all.slice(-PANTRY_MAX);
  };
  const phoneOk = typeof phone === 'string' && /^\+[1-9]\d{6,14}$/.test(phone);
  const cut = v => String(v ?? '').trim().slice(0, 80);
  const three = o => {
    const v = { sodiumMg: o?.sodiumMg, potassiumMg: o?.potassiumMg, phosphorusMg: o?.phosphorusMg };
    return Object.values(v).every(Number.isFinite) ? v : null;
  };
  const remember = (verdict, inputName) => {
    const names = [norm(verdict?.food), norm(inputName)].filter(Boolean);
    if (names.length) candidates.set(names[0], { names, verdict });
  };
  if (typeof debugFrameDir === 'string' && debugFrameDir) console.log('[agent] debug frames are on; they hold what the caller shows');

  return {
    // Anonymous tools: the object key is the tool name.
    look_at_camera: llm.tool({
      description: 'Look at what the caller is showing on camera right now (a food label, plate, fridge or shelf) and judge it against their limits. Pass place home for the caller own fridge, pantry or cupboards, and place store in a shop. Call this every time they ask about something in view; each call takes a new picture. If the result has omitted, say that you only covered some of the foods and ask them to show the rest. For a store shelf the result has best and spoken: say spoken, which names the product to pick. If the result has unjudged true, say what you can see and that you could not check it against their limits right now; never guess a verdict. If the result has unnamed true, the product name was not visible: say each spoken sentence as given, then you may ask what the product is or to see the front of the package. If the result has online true, also say once that some of these numbers came from an online search, not their care team\'s list.',
      parameters: z.object({ place: z.enum(['home', 'store']).nullish() }),
      execute: guard(async (call, args = {}) => {
        const place = args?.place === 'home' || args?.place === 'store' ? args.place : null;
        // A new look replaces the last one, whether or not it works.
        lastFoods = [];
        let remembered = false;
        candidates.clear();
        const picture = camera ? await camera.jpeg() : null;
        if (!picture) return fail('no_camera_picture');
        if (typeof debugFrameDir === 'string' && debugFrameDir) {
          try { await saveDebugFrame(debugFrameDir, picture); } catch { /* a failed debug write never fails the tool */ }
        }
        const seen = await renal.describeImage({ jpeg: picture });
        if (!seen?.ok) return fail('vision_failed');
        if (seen.kind === 'unclear') return fail('unclear_picture');
        const named = f => f && typeof f.name === 'string' && f.name.trim();
        const label = seen.label && typeof seen.label === 'object' ? seen.label : null;
        const product = typeof label?.product === 'string' ? label.product.trim() : '';
        const namedFoods = (Array.isArray(seen.foods) ? seen.foods : []).filter(named);
        const nameless = !!label && !product && (seen.kind === 'label' || namedFoods.length === 0);
        const usable = !!label && (['sodiumMg', 'potassiumMg', 'phosphorusMg'].some(k => Number.isFinite(label[k]) && label[k] >= 0)
          || (typeof label.ingredients === 'string' && label.ingredients.trim() !== ''));
        if (nameless && !usable) return fail('label_unreadable');
        const all = product
          ? [{ name: seen.label.product, label: seen.label }]
          : nameless ? [{ name: UNNAMED_PRODUCT, label }] : namedFoods;
        const foods = all.slice(0, 6);
        const notChecked = all.length - foods.length;
        if (foods.length === 0) return fail('no_food_seen');
        // A profile problem never hides what was seen: nothing is judged and the foods are still remembered.
        const got = await renal.getProfile({ patientId });
        const profileOk = got?.ok === true;
        const verdicts = await Promise.all(foods.map(async food => {
          if (!profileOk) return null;
          try { return await renal.checkFood({ food, profile: got.profile }); } catch { return null; }
        }));
        const rows = [];
        const good = [];
        verdicts.forEach((v, i) => {
          if (v?.ok === true) {
            const verdict = normalVerdict(v.verdict);
            rows.push({ food: clean(v.food ?? foods[i].name, 80), verdict, swap: clean(v.swap, 40), speak: max => spokenVerdict({ ...v, verdict }, max) });
            good.push({ v, name: foods[i].name });
          } else {
            rows.push({ food: clean(foods[i].name, 80), verdict: 'unknown', swap: '', speak: () => "I can't tell, I couldn't check that one just now." });
          }
        });
        // Never invent nutrient numbers: renal/check.mjs falls back to a name lookup when a label has no numbers,
        // and 'this product' is not a real food, so only numbers printed on the label may reach the caller.
        if (nameless && good.some(g => g.v?.source === 'web' || ['sodiumMg', 'potassiumMg', 'phosphorusMg'].some(k => {
          const x = g.v?.nutrients?.[k];
          return Number.isFinite(x) && x !== label[k];
        }))) return fail('label_unreadable');
        const unjudged = good.length === 0;
        // The most serious verdicts come first, so a shortened result never hides an "avoid".
        rows.sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
        if (!call.timedOut && !nameless) {
          lastFoods = foods.map(f => clean(f.name, 80));
          good.forEach(g => remember(g.v, g.name));
          if ((seen.kind === 'fridge' || seen.kind === 'shelf') && !seen.label?.product && place !== 'store') {
            const names = all.slice(0, 20).map(f => clean(f.name, 80)).filter(Boolean);
            if (names.length) {
              callPantry = mergePantry(callPantry, names).list;
              for (const n of names) hidden.delete(n.toLowerCase());
              remembered = true;
              if (memory) {
                try { await memory.addPantry(names); } catch { /* a memory failure never changes the result */ }
              }
            }
          }
        }
        let shelf = null;
        if (!unjudged && seen.kind === 'shelf' && place !== 'home' && !seen.label?.product && !nameless && foods.length >= 2) {
          const best = pickBest(good.map(g => g.v), got.profile?.limits);
          const match = best ? good.find(g => g.v === best) : null;
          shelf = shelfSpoken(best, match?.name);
        }
        const build = (n, capBad, capOk, capFood) => {
          const results = rows.slice(0, n).map(r => ({
            food: r.food.slice(0, capFood),
            verdict: r.verdict,
            spoken: r.speak(r.verdict === 'ok' ? capOk : capBad),
            ...(r.swap ? { swap: r.swap.slice(0, 40) } : {}),
          }));
          const omitted = rows.length - n + notChecked;
          const omittedSay = omitted > 0 ? `I only covered ${n} of ${n + omitted} foods. Please show me the rest.` : '';
          // Never a verdict or a number here: only how many foods were seen and that they could not be checked.
          const seenCount = rows.length;
          const unjudgedSay = unjudged ? `I can see ${seenCount === 1 ? 'one food' : `${seenCount} foods`}, but I couldn't check ${seenCount === 1 ? 'it' : 'them'} against your limits just now.` : '';
          const say = [unjudgedSay, omittedSay].filter(Boolean).join(' ');
          return {
            ok: true,
            kind: seen.kind,
            ...(nameless ? { unnamed: true } : {}),
            ...(unjudged ? { unjudged: true } : {}),
            ...(good.some(g => g.v?.source === 'web') ? { online: true } : {}),
            ...(remembered ? { remembered: true } : {}),
            ...(shelf ? { best: shelf.name, spoken: shelf.spoken } : {}),
            results,
            ...(omitted > 0 ? { omitted } : {}),
            ...(say ? { say } : {}),
          };
        };
        for (const [capBad, capOk, capFood] of [[130, 60, 40], [90, 30, 30], [60, 0, 24]]) {
          const r = build(rows.length, capBad, capOk, capFood);
          if (size(r) <= LOOK_LIMIT) return r;
        }
        for (let n = rows.length - 1; n > 1; n--) {
          const r = build(n, 60, 0, 24);
          if (size(r) <= LOOK_LIMIT) return r;
        }
        return build(1, 60, 0, 24);
      }, { timeoutMs, limit: LOOK_LIMIT }),
    }),
    check_food: llm.tool({
      description: 'Judge a food the caller names without showing it. Pass null for grams when they gave no amount.',
      parameters: z.object({ name: z.string().trim().min(1).max(80), grams: z.number().positive().max(5000).nullish() }),
      execute: guard(async (call, args = {}) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name || name.length > 80) return fail('bad_food');
        const grams = args.grams ?? null;
        if (grams !== null && !(typeof grams === 'number' && Number.isFinite(grams) && grams > 0 && grams <= 5000)) return fail('bad_amount');
        const got = await renal.getProfile({ patientId });
        if (!got?.ok) return fail('profile_unavailable');
        const v = await renal.checkFood({ food: { name, grams }, profile: got.profile });
        if (v?.ok !== true) return fail('check_failed');
        if (!call.timedOut) remember(v, name);
        const verdict = normalVerdict(v.verdict);
        return { ok: true, food: clean(v.food ?? name, 80), verdict, spoken: spokenVerdict({ ...v, verdict }), swap: clean(v.swap, 60) || null };
      }, { timeoutMs }),
    }),
    suggest_meal: llm.tool({
      description: 'Suggest meals to cook from everything the caller showed from their kitchen (fridge, pantry, cupboards), within their limits.',
      execute: guard(async call => {
        let foods = await pantryNow();
        if (foods.length === 0) foods = lastFoods;
        if (foods.length === 0) return fail('nothing_seen');
        const got = await renal.getProfile({ patientId });
        if (!got?.ok) return fail('profile_unavailable');
        const r = await renal.suggestMeals({ foods, profile: got.profile, count: 2 });
        const meals = Array.isArray(r?.meals) ? r.meals : [];
        if (!r?.ok || meals.length === 0) return fail('check_failed');
        const seen = new Map();
        for (const m of meals) for (const item of Array.isArray(m?.missing) ? m.missing : []) {
          const key = clean(item?.name, 80).toLowerCase();
          if (key && !seen.has(key)) seen.set(key, { name: clean(item.name, 80), quantity: clean(item.quantity, 80) });
        }
        if (!call.timedOut) {
          lastMissing = [...seen.values()];
          lastMeals = meals.slice(0, 5).map(m => ({
            title: clean(m?.title, 80),
            uses: (Array.isArray(m?.uses) ? m.uses : []).slice(0, 12).map(u => clean(u, 60)).filter(Boolean),
            missing: (Array.isArray(m?.missing) ? m.missing : []).slice(0, 12)
              .map(x => ({ name: clean(x?.name, 80), quantity: clean(x?.quantity, 40) })).filter(x => x.name),
            ...(Number.isInteger(m?.minutes) && m.minutes > 0 && m.minutes <= 600 ? { minutes: m.minutes } : {}),
            steps: (Array.isArray(m?.steps) ? m.steps : []).slice(0, 12).map(x => clean(x, 300)).filter(Boolean),
            why: clean(m?.why, 300),
          }));
        }
        if (memory && !call.timedOut) {
          try { await memory.add([...seen.values()].map(i => i.name)); } catch { /* the list never changes this result */ }
        }
        return { ok: true, meals: meals.map((m, i) => ({
          title: clean(m?.title, 60),
          ...(Number.isFinite(m?.minutes) ? { minutes: m.minutes } : {}),
          why: clean(m?.why, 90),
          missing: (Array.isArray(m?.missing) ? m.missing : []).slice(0, 4).map(x => clean(x?.name, 40)).filter(Boolean),
          ...(i === 0 ? { steps: (Array.isArray(m?.steps) ? m.steps : []).slice(0, 3).map(s => clean(s, 70)) } : {}),
        })) };
      }, { timeoutMs, limit: MEALS_LIMIT }),
    }),
    log_meal: llm.tool({
      description: 'Log what the caller says they ate. Pass the names of only the foods they confirmed eating, as they were judged by look_at_camera or check_food.',
      parameters: z.object({ foods: z.array(z.string().trim().min(1).max(80)).min(1).max(6) }),
      execute: guard(async (call, args = {}) => {
        const asked = (Array.isArray(args.foods) ? args.foods : []).map(norm).filter(Boolean).slice(0, 6);
        const matched = [];
        const notFound = [];
        for (const want of asked) {
          const hit = [...candidates.values()].find(c => c.names.some(n => n === want || (want.length >= 3 && n.length >= 3 && (n.includes(want) || want.includes(n)))));
          if (!hit) notFound.push(want);
          else if (!matched.includes(hit)) matched.push(hit);
        }
        if (matched.length === 0) return fail('nothing_to_log');
        const logged = [];
        for (const c of matched) {
          if (call.timedOut) break; // the caller was told it failed: start nothing new
          const r = await renal.logFood({ patientId, verdict: c.verdict });
          if (!r?.ok) return fail('tool_failed');
          // Forget a food as soon as it is logged, so a retry never logs it twice.
          for (const [key, value] of candidates) if (value === c) candidates.delete(key);
          logged.push(clean(c.verdict.food, 80));
        }
        return { ok: true, logged, ...(notFound.length ? { notFound: notFound.map(n => clean(n, 40)) } : {}) };
      }, { timeoutMs }),
    }),
    todays_totals: llm.tool({
      description: 'How much sodium, potassium and phosphorus the caller has had today and how much is left.',
      execute: guard(async () => {
        const r = await renal.getToday({ patientId });
        if (!r?.ok) return fail('tool_failed');
        const totals = three(r.totals);
        const remaining = three(r.remaining);
        if (!totals || !remaining) return fail('tool_failed');
        return { ok: true, totals, remaining };
      }, { timeoutMs }),
    }),
    start_cart: llm.tool({
      description: 'Start filling an online grocery cart with items the caller needs. Pass an empty list to use the missing items from the last meal suggestion, or the remembered shopping list when that meal had nothing missing. This never pays or checks out. If it says it has not heard back, check cart_status before trying again.',
      parameters: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.string() })) }),
      execute: guard(async (call, args = {}) => {
        let list = (Array.isArray(args.items) ? args.items : []).map(i => ({ name: cut(i?.name), quantity: cut(i?.quantity) })).filter(i => i.name);
        if (list.length === 0) list = lastMissing.map(i => ({ name: cut(i.name), quantity: cut(i.quantity) })).filter(i => i.name);
        if (list.length === 0 && memory) {
          const l = await memory.load();
          if (l?.ok) list = l.state.needed.map(name => ({ name: cut(name), quantity: '1' })).filter(i => i.name);
        }
        list = list.slice(0, 12);
        if (list.length === 0) return fail('nothing_to_buy');
        const r = await actions.startCart({ items: list });
        if (r?.error === 'busy') return fail('cart_busy');
        if (!r?.ok) return fail('tool_failed');
        return { ok: true, started: true, items: list.slice(0, 5).map(i => i.name.slice(0, 50)), ...(list.length > 5 ? { more: list.length - 5 } : {}) };
        // A timeout cannot cancel startCart, which may still start: report it as unconfirmed, not as failed.
      }, { timeoutMs, onTimeout: () => fail('cart_unconfirmed') }),
    }),
    cart_status: llm.tool({
      description: 'How the grocery cart is going.',
      execute: guard(async () => {
        const s = await actions.getCartStatus();
        if (!s?.ok) return fail('tool_failed');
        const SAY = {
          idle: 'No cart is running.',
          running: 'The cart is still being filled.',
          waiting_for_patient: 'The cart is paused and waiting for you.',
          done: 'The cart is filled and ready for you to review. I can text you the link.',
        };
        if (s.state === 'failed') return fail('cart_failed', { state: 'failed' });
        if (typeof s.state !== 'string' || !Object.hasOwn(SAY, s.state)) return fail('tool_failed');
        const names = list => (Array.isArray(list) ? list : []).map(x => clean(typeof x === 'object' ? x?.name : x, 50)).filter(Boolean);
        const added = names(s.added);
        const missing = names(s.missing);
        return {
          ok: true, state: s.state, say: SAY[s.state],
          ...(clean(s.step, 60) ? { step: clean(s.step, 60) } : {}),
          added: added.slice(0, 5), ...(added.length > 5 ? { addedMore: added.length - 5 } : {}),
          missing: missing.slice(0, 5), ...(missing.length > 5 ? { missingMore: missing.length - 5 } : {}),
          ...(Number.isFinite(s.total) ? { total: s.total } : {}),
        };
      }, { timeoutMs }),
    }),
    text_cart_link: llm.tool({
      description: 'Text the caller a link to their filled cart so they can review it and check out themselves.',
      execute: guard(async () => {
        if (!phoneOk) return fail('no_phone');
        const s = await actions.getCartStatus();
        if (!s?.ok) return fail('tool_failed');
        let link = null;
        try {
          const u = new URL(String(s.cartUrl ?? ''));
          if ((u.protocol === 'https:' || u.protocol === 'http:') && u.href.length <= 500) link = u.href;
        } catch { /* not a link */ }
        if (s.state !== 'done' || !link) return fail('no_cart_link');
        if (sentLinks.has(link)) return fail('link_already_sent');
        // Marked before sending: if the send times out it may still arrive, and a repeat would duplicate it.
        sentLinks.add(link);
        let r;
        try { r = await actions.sendText({ phone, text: `Your grocery cart from your renal dietitian is ready to review: ${link} Nothing has been paid; please check it and check out yourself.` }); }
        catch { sentLinks.delete(link); return fail('tool_failed'); }
        if (!r?.ok) { sentLinks.delete(link); return fail('tool_failed'); }
        return { ok: true, sent: true };
      }, { timeoutMs }),
    }),
    add_to_shopping_list: llm.tool({
      description: 'Add things the caller wants to buy to their shopping list. The list is kept between calls. Pass short item names.',
      parameters: z.object({ items: z.array(z.string().trim().min(1).max(80)).min(1).max(20) }),
      execute: guard(async (call, args = {}) => {
        const items = Array.isArray(args.items) ? args.items : [];
        if (items.length < 1 || items.length > 20 || !items.every(x => typeof x === 'string' && x.trim().length >= 1 && x.trim().length <= 80)) return fail('bad_items');
        if (!memory || call.timedOut) return fail('memory_unavailable');
        const r = await memory.add(items.map(x => x.trim()));
        if (!r?.ok) return fail('memory_unavailable');
        return { ok: true, added: r.added.slice(0, 5).map(x => x.slice(0, 50)), ...(r.added.length > 5 ? { addedMore: r.added.length - 5 } : {}), left: r.state.needed.length };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    shopping_list: llm.tool({
      description: "What is on the caller's shopping list, kept between calls: still needed, approved and rejected items.",
      execute: guard(async () => {
        if (!memory) return fail('memory_unavailable');
        const r = await memory.load();
        if (!r?.ok) return fail('memory_unavailable');
        const part = (list, n) => ({ names: list.slice(0, n).map(x => x.slice(0, 40)), more: list.length - n });
        const { needed, approved, rejected } = r.state;
        const a = part(needed, 8), b = part(approved, 5), c = part(rejected, 3);
        return {
          ok: true,
          needed: a.names, ...(a.more > 0 ? { neededMore: a.more } : {}),
          approved: b.names, ...(b.more > 0 ? { approvedMore: b.more } : {}),
          rejected: c.names, ...(c.more > 0 ? { rejectedMore: c.more } : {}),
          ...(needed.length + approved.length + rejected.length === 0 ? { say: 'Your shopping list is empty.' } : {}),
        };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    mark_item: llm.tool({
      description: 'Record that the caller chose (approved) or turned down (rejected) an item or product, so the list stays right between calls.',
      parameters: z.object({ name: z.string().trim().min(1).max(80), status: z.enum(['approved', 'rejected']) }),
      execute: guard(async (call, args = {}) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        if (!name || name.length > 80 || (args.status !== 'approved' && args.status !== 'rejected')) return fail('bad_item');
        if (!memory || call.timedOut) return fail('memory_unavailable');
        const r = await memory.mark(name, args.status);
        if (r?.error === 'bad_item') return fail('bad_item');
        if (!r?.ok) return fail('memory_unavailable');
        return { ok: true, name: r.name.slice(0, 50), status: r.status, left: r.state.needed.length };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    pantry_list: llm.tool({
      description: 'Say what the agent remembers the caller has in their kitchen from what they showed on camera.',
      execute: guard(async () => {
        const list = await pantryNow();
        if (list.length === 0) return { ok: true, count: 0, names: [], say: "I don't remember anything from your kitchen yet. Show me your fridge or cupboards." };
        return { ok: true, count: list.length, names: list.slice(0, 12).map(x => x.slice(0, 40)), more: Math.max(0, list.length - 12) };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    remove_from_pantry: llm.tool({
      description: 'Forget items the caller says they no longer have or that were seen wrongly. Pass short item names.',
      parameters: z.object({ items: z.array(z.string().trim().min(1).max(80)).min(1).max(20) }),
      execute: guard(async (call, args = {}) => {
        const items = Array.isArray(args.items) ? args.items.map(x => (typeof x === 'string' ? x.trim() : '')) : [];
        if (items.length < 1 || items.length > 20 || !items.every(x => x.length >= 1 && x.length <= 80)) return fail('bad_items');
        const before = await pantryNow();
        const hits = new Set();
        for (const w of items) {
          for (const h of matchPantry(before, w)) hits.add(h);
          for (const h of matchPantry(lastFoods, w)) hits.add(h);
        }
        if (hits.size === 0) return fail('not_in_pantry');
        if (call.timedOut) return fail('timeout');
        const gone = new Set([...hits].map(x => x.toLowerCase()));
        callPantry = callPantry.filter(x => !gone.has(x.toLowerCase()));
        lastFoods = lastFoods.filter(x => !gone.has(x.toLowerCase()));
        for (const g of gone) hidden.add(g);
        let kept = true;
        if (memory) {
          try { const r = await memory.removePantry(items); kept = r?.ok === true; } catch { kept = false; }
        }
        const removed = [...hits];
        const left = (await pantryNow()).length;
        return {
          ok: true,
          removed: removed.slice(0, 5).map(x => x.slice(0, 40)),
          left,
          ...(kept ? {} : { say: "Done for this call, but I may not remember that next time." }),
        };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    clear_pantry: llm.tool({
      description: 'Forget everything the caller showed from their kitchen.',
      execute: guard(async call => {
        if (call.timedOut) return fail('timeout');
        const before = await pantryNow();
        for (const x of before) hidden.add(x.toLowerCase());
        callPantry = [];
        lastFoods = [];
        let kept = true;
        if (memory) {
          try { const r = await memory.clearPantry(); kept = r?.ok === true; } catch { kept = false; }
        }
        return { ok: true, say: kept ? "Okay, I've forgotten what you showed me from your kitchen." : "Okay, I've forgotten what you showed me from your kitchen for this call, but I may not remember that next time." };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    text_recipe: llm.tool({
      description: 'Text the caller one of the meals just suggested, as a recipe. Pass the title or the position (1 or 2) they chose. Only call it after they agree.',
      parameters: z.object({ title: z.string().trim().min(1).max(80).nullish(), position: z.number().int().min(1).max(5).nullish() }),
      execute: guard(async (call, args = {}) => {
        if (!phoneOk) return fail('no_phone');
        if (lastMeals.length === 0) return fail('no_recipe');
        const which = () => fail('which_recipe', { titles: lastMeals.slice(0, 5).map(m => m.title.slice(0, 60)) });
        let meal = null;
        const pos = args?.position;
        const asked = typeof args?.title === 'string' ? norm(args.title) : '';
        if (Number.isInteger(pos)) {
          meal = lastMeals[pos - 1] ?? null;
          if (!meal) return which();
        } else if (asked) {
          meal = lastMeals.find(m => norm(m.title) === asked) ?? null;
          if (!meal && asked.length >= 3) {
            const hits = lastMeals.filter(m => { const t = norm(m.title); return t.length >= 3 && (t.includes(asked) || asked.includes(t)); });
            if (hits.length === 1) meal = hits[0];
          }
          if (!meal) return which();
        } else if (lastMeals.length === 1) {
          meal = lastMeals[0];
        } else {
          return which();
        }
        const key = norm(meal.title);
        if (sentRecipes.has(key)) return fail('recipe_already_sent');
        // Marked before sending: a send that times out may still arrive, and a repeat would duplicate it.
        sentRecipes.add(key);
        let r;
        try { r = await actions.sendText({ phone, text: recipeText(meal) }); }
        catch { sentRecipes.delete(key); return fail('text_failed'); }
        if (r?.ok) return { ok: true, sent: true, title: meal.title.slice(0, 60) };
        if (typeof r?.error === 'string' && /outcome is unknown/i.test(r.error)) return fail('text_unconfirmed');
        sentRecipes.delete(key);
        return fail('text_failed');
      }, { timeoutMs, onTimeout: () => fail('text_unconfirmed') }),
    }),
  };
}

// Races a promise against a timer. Resolves to { ok } and never rejects.
export async function withTimeout(work, ms) {
  let timer;
  try {
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms); });
    const done = Promise.resolve().then(work).then(() => ({ ok: true }), error => ({ ok: false, error }));
    return await Promise.race([done, late]);
  } finally {
    clearTimeout(timer);
  }
}

// At call end: stop any cart so it cannot block or leak into the next call. Never throws.
export async function endCall({ actions = actionsModule, timeoutMs = 4000 } = {}) {
  const r = await withTimeout(() => actions.stopCart(), timeoutMs);
  if (!r.ok) console.error(`[agent] stopCart ${r.timedOut ? 'timed out' : 'failed'}`);
  return r;
}
