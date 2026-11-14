import { llm } from '@livekit/agents';
import { randomBytes } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
// This is the only file that imports renal/ and actions/.
import * as renalModule from '../renal/index.mjs';
import { CONDITIONS, LIMIT_BOUNDS, MAX_AVOID } from '../renal/index.mjs';
import * as actionsModule from '../actions/index.mjs';
import { mergePantry, matchPantry, PANTRY_MAX } from './memory.mjs';
import { VOICE_MENU, cleanCallName } from './prefs.mjs';

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
  const say = clean(verdict?.say, 1000).replace(/^(yes|no|small portion|i can't tell)\s*[,.:!;-]+\s*/i, '')
    // renal's own comma-form word ("Limit, banana has...") would double ours; "Avoid star fruit." has no comma and stays.
    .replace(/^(okay|limit|avoid)\s*,\s*/i, '');
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
  no_safe_meal: "I couldn't put together a meal I'm sure fits your limits right now. Tell me a food you have or want, and I'll check it for you.",
  not_enough_food: "I couldn't find a complete meal from what I've seen so far. Show me your cupboards or pantry and I'll try again.",
  nothing_to_log: 'Tell me or show me what you ate first, and then I can log it.',
  nothing_to_buy: 'Your list is empty. What would you like to buy?',
  dish_unknown: "I'm not sure what usually goes in that. Tell me the main ingredients and I'll check each one.",
  not_on_list: "That isn't on your list.",
  confirm_list: "Before I add anything to your Kroger cart, here is what's on your list. Shall I add these?",
  already_in_cart: 'Those are already in your Kroger cart from this call. I can text you the cart link.',
  nothing_to_text: "There's nothing on your list yet. Tell me a dish or the items you need first.",
  list_already_sent: "I've already texted you that list. Please check your messages.",
  list_text_unconfirmed: "I tried to text the list but couldn't confirm it went through. Please check your messages before we try again.",
  list_text_failed: "I couldn't send the list just now. I can try again if you like.",
  cart_busy: "A cart is already being filled. I can tell you how it's going.",
  cart_unconfirmed: "I asked for the cart but haven't heard back yet. Let me check how it's going before we try again.",
  cart_failed: "The cart didn't work out. I can try again if you like.",
  no_cart_link: "The cart isn't ready yet, so there's no link to send. I can check on it for you.",
  nothing_added: "I couldn't find those items at the store, so nothing was added to your cart and there's no link to send. Tell me another name for what you want and I'll try again.",
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
  setup_not_started: "Say 'update my setup' and I'll take you through setup.",
  bad_name: "I didn't catch the name. Tell me the first name you'd like me to use, or say skip.",
  limit_missing: "I need all four numbers from your care team: sodium, potassium, phosphorus and fluid. Read me the ones on their sheet, or tell me you don't have them.",
  bad_sodium: "That sodium number doesn't sound right; can you read it again from your care team's sheet?",
  bad_potassium: "That potassium number doesn't sound right; can you read it again from your care team's sheet?",
  bad_phosphorus: "That phosphorus number doesn't sound right; can you read it again from your care team's sheet?",
  bad_fluid: "That fluid number doesn't sound right; can you read it again from your care team's sheet?",
  no_proposal: "Read me your four limits first, and I'll repeat them back so you can check them.",
  limits_changed: "Those aren't the numbers I read back. Let me read the new ones back to you first.",
  limits_not_confirmed: 'Please tell me if the numbers I read back are right.',
  bad_foods: 'Tell me up to ten foods to avoid, a few words each.',
  bad_preference: 'I can use an upbeat, firm, warm or mature voice, give brief or detailed answers, and speak English or Spanish. Which would you like?',
  profile_unsaved: "I couldn't save that just now. You can finish it later by saying 'update my setup'.",
  prefs_unsaved: "I couldn't save that preference just now. We can try again on your next call.",
  bad_condition: 'Tell me which fits best: kidney disease without dialysis, hemodialysis, peritoneal dialysis, a kidney transplant, or not sure.',
  kroger_not_connected: "Your Kroger account isn't connected yet, so I can't fill your cart. Want me to text you a link to sign in?",
  kroger_sign_in_needed: "Your Kroger account isn't connected yet, and I can't text a sign-in link on this line, so I can't fill your cart.",
  kroger_sign_in_pending: "I'm still waiting for you to finish signing in to Kroger. Tap the link I texted you, then ask me again.",
  kroger_not_configured: "Kroger sign-in by text isn't set up on this line, so I can't send a link.",
  kroger_link_already_sent: "I've just texted you the Kroger sign-in link. Please check your messages.",
  kroger_texting_refused: "Your phone didn't accept the text. Please send any message to this number from your phone, then ask me again.",
  kroger_text_unconfirmed: "I tried to text the Kroger link but couldn't confirm it went through. Please check your messages before we try again.",
  kroger_text_failed: "I couldn't text you the Kroger link just now. I can try again if you like.",
  limits_needed: "I don't have your care team's limits yet, so I can't judge foods against them. When you have them, say 'update my setup' and read them to me.",
};
// renal/check.mjs composes "Okay, this product has about N milligrams of sodium." from this name.
const UNNAMED_PRODUCT = 'this product';
// Exact normalized names only. Salt is deliberately absent: a renal recipe should not call for salt, and hiding it
// would hide a bad recipe. Salt-free seasoning is a real shopping item.
const KITCHEN_BASICS = new Set(['water', 'tap water', 'ice', 'black pepper', 'pepper', 'cooking oil', 'oil', 'olive oil', 'vegetable oil']);
const TOO_LONG = "Done, but there's too much detail to read out. Ask me about one part at a time.";
const fail = (error, extra = {}) => ({ ok: false, error, say: FAILS[error], ...extra });

const RECIPE_CLOSING = 'This recipe follows the limits set by your care team and does not replace their advice.';
export const LIST_CLOSING = 'This list follows the limits set by your care team and does not replace their advice.';
// The Kroger public API can only add to a cart: it has no remove or read route. This sentence is fixed and said as given.
export const KROGER_NO_REMOVE = "Kroger doesn't let me take items out of your cart. I've taken it off your list so it won't be added again, and I can text you the cart link so you can remove it there.";

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

// Two food names mean the same thing: equal, or one holds the other as whole words ("deli ham" holds "ham").
const sameFood = (a, b) => {
  const x = norm(a), y = norm(b);
  return x.length > 0 && y.length > 0 && (x === y || ` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `));
};

const DISH_LIMIT = 900;
// Shorter and shorter forms of the dish result. An avoid row is never dropped, only shortened.
const DISH_LEVELS = [
  { qty: 20, name: 30, swap: 40, limit: true, unknown: true, okRows: true },
  { qty: 0, name: 30, swap: 40, limit: true, unknown: true, okRows: true },
  { qty: 0, name: 20, swap: 30, limit: true, unknown: true, okRows: true },
  { qty: 0, name: 16, swap: 24, limit: false, unknown: false, okRows: true },
  { qty: 0, name: 14, swap: 20, limit: false, unknown: false, okRows: false },
  // Last resort: the swap stays on its row, not in the sentence.
  { qty: 0, name: 12, swap: 16, limit: false, unknown: false, okRows: false, swapSay: false, dish: 20 },
];

// Said from names and verdict words only: no nutrient number ever appears in it.
function dishSay(dish, rows, caps) {
  const nm = r => r.name.slice(0, caps.name);
  const names = rows.map(nm);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? 'nothing');
  const swapBit = r => (r.swap && caps.swapSay !== false ? `; ${r.swap.slice(0, caps.swap)} is a good swap` : '');
  const parts = [`For ${dish.slice(0, caps.dish ?? 40)}, you usually need ${list}.`];
  for (const r of rows) if (r.verdict === 'avoid') parts.push(`${nm(r)} is a no for your limits${swapBit(r)}.`);
  if (caps.limit) for (const r of rows) if (r.verdict === 'limit') parts.push(`Keep ${nm(r)} to a small portion${swapBit(r)}.`);
  if (caps.unknown) for (const r of rows) if (r.verdict === 'unknown') parts.push(`I couldn't check ${nm(r)}.`);
  return parts.join(' ');
}

export function dishResult(dishName, rows, omitted) {
  const dish = clean(dishName, 40);
  const hasSwap = rows.some(r => r.swap);
  const ask = hasSwap ? 'Use the swap or keep the original, and shall I put these on your list?' : 'Shall I put these on your list?';
  let last = null;
  for (const caps of DISH_LEVELS) {
    const shown = caps.okRows ? rows : rows.filter(r => r.verdict !== 'ok');
    const result = {
      ok: true,
      dish,
      ingredients: shown.map(r => ({
        name: r.name.slice(0, caps.name),
        ...(caps.qty ? { quantity: r.quantity.slice(0, caps.qty) } : {}),
        verdict: r.verdict,
        ...(r.swap ? { swap: r.swap.slice(0, caps.swap) } : {}),
      })),
      ...(omitted > 0 ? { omitted } : {}),
      say: dishSay(dish, rows, caps),
      ask,
    };
    last = result;
    if (size(result) <= DISH_LIMIT) return result;
  }
  return last;
}

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
function guardTool(fn, { timeoutMs, limit = 600, onTimeout = () => fail('timeout'), activity = () => {}, display = () => {} }) {
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
      const fitted = fit(result, limit);
      // A card is shown only for a finished, successful verdict (never a timeout, a failure or the TOO_LONG summary).
      if (!call.timedOut && call.display && fitted?.ok === true && (typeof fitted.verdict === 'string' || Array.isArray(fitted.results) || Array.isArray(fitted.ingredients))) {
        try { display(call.display); } catch { /* a hook never changes a result */ }
      }
      return fitted;
    } catch {
      return fail('tool_failed');
    } finally {
      clearTimeout(timer);
      try { activity(-1); } catch { /* a hook never changes a result */ }
    }
  };
}

const normalVerdict = v => (Object.hasOwn(RANK, v) ? v : 'unknown');

// What the video screen may draw for one checked food: only fields the renal check returned, never its spoken text.
const displayItem = (v, fallbackName, verdict) => ({
  food: clean(v.food ?? fallbackName, 80),
  verdict,
  nutrients: v.nutrients && typeof v.nutrients === 'object'
    ? { sodiumMg: v.nutrients.sodiumMg ?? null, potassiumMg: v.nutrients.potassiumMg ?? null, phosphorusMg: v.nutrients.phosphorusMg ?? null }
    : null,
  portion: typeof v.portion === 'string' ? clean(v.portion, 60) : null,
  online: v.source === 'web',
});

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
  const say = clean(best.say, 400).replace(/^(yes|no|small portion|i can't tell)\s*[,.:!;-]+\s*/i, '')
    // renal's own comma-form word ("Limit, banana has...") would double ours; "Avoid star fruit." has no comma and stays.
    .replace(/^(okay|limit|avoid)\s*,\s*/i, '');
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

// Minimum time between reading the limits back and accepting the caller's yes. The read-back alone takes longer.
export const CONFIRM_MIN_MS = 2500;
export const KROGER_FINISH_LATER = "Kroger isn't connected yet; you can finish from the link I texted, or ask me for a new one on any call.";
const LIMIT_FIELDS = [['sodium', 'sodiumMg', 'sodium_mg'], ['potassium', 'potassiumMg', 'potassium_mg'], ['phosphorus', 'phosphorusMg', 'phosphorus_mg'], ['fluid', 'fluidMl', 'fluid_ml']];

// True when this caller still has to do first-call setup. Never throws; any trouble or delay gives false so the
// greeting is never held up and nobody is forced into setup by an error.
export async function setupStatus({ patientId = 'demo', renal = renalModule, timeoutMs = 1000 } = {}) {
  let timer;
  try {
    const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); });
    const got = await Promise.race([Promise.resolve().then(() => renal.getSavedProfile({ patientId })).catch(() => null), late]);
    if (!got || got.ok !== true) return { needsSetup: false };
    return { needsSetup: got.saved === null || got.saved === undefined || got.saved.setupDone !== true };
  } catch {
    return { needsSetup: false };
  } finally {
    clearTimeout(timer);
  }
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
  onDisplay = () => {},
  cartWaitMs = 8000,
  setupDue = false,
  callerHeardAfter = () => null,
  now = () => Date.now(),
} = {}) {
  // Every tool reports start (+1) and end (-1) so the reply watchdog never nudges while one runs.
  const guard = (fn, opts) => guardTool(fn, { ...opts, activity: onToolActivity, display: onDisplay });
  let lastFoods = []; // food names from the last look only; suggest_meal cooks from these
  const candidates = new Map(); // judged foods log_meal may log: key -> { names, verdict }
  let lastMissing = []; // CartItems the last meal suggestion said are missing
  const sentLinks = new Set(); // cart links already texted during this call
  const sentRecipes = new Set(); // recipes already texted during this call
  let krogerTextAt = null; // when the Kroger sign-in link was last texted during this call (by now())
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

  // Dish-to-cart state, for this call only. Quantities are not stored in memory (it keeps names only).
  const qty = new Map(); // lowercase name -> quantity text (at most 40 characters)
  let lastDish = null; // { name, items: [{ name, quantity }] } from the last dish_ingredients
  const avoidNames = new Set(); // lowercase names judged avoid this call (dish ingredients and judged foods)
  const heldNames = new Set(); // avoid names left off the list; keep_after_warning only works for these
  let listShownSig = ''; // the list as last handed back to the model (names and quantities)
  const sentToKroger = new Set(); // lowercase names sent to the Kroger cart this call
  const sentLists = new Set(); // list texts already sent this call
  const quantityOf = name => qty.get(name.toLowerCase()) || '1';
  const sig = list => list.map(i => `${i.name.toLowerCase()}|${i.quantity.toLowerCase()}`).join('\n');
  // The current shopping list as CartItems: the remembered list when memory works, else this call's missing items.
  const listNow = async () => {
    let names = null;
    if (memory) { try { const l = await memory.load(); if (l?.ok) names = l.state.needed; } catch { /* fall back to this call's items */ } }
    if (names === null) names = lastMissing.map(i => i.name);
    return names.map(cut).filter(Boolean).map(name => ({ name, quantity: quantityOf(name) }));
  };
  // Best effort and never awaited: the preview card is decoration, a failure never changes a result.
  const showList = (list, call) => {
    if (call?.timedOut || typeof actions.previewCart !== 'function') return;
    try { Promise.resolve(actions.previewCart({ items: list.slice(0, 12).map(i => ({ name: i.name, quantity: i.quantity })) })).catch(() => {}); } catch { /* ignore */ }
  };
  const listResult = (list, key = 'list') => {
    listShownSig = sig(list);
    return { [key]: list.slice(0, 8).map(i => i.name.slice(0, 40)), ...(list.length > 8 ? { listMore: list.length - 8 } : {}) };
  };
  const isSent = name => [...sentToKroger].some(s => sameFood(s, name));
  const three = o => {
    const v = { sodiumMg: o?.sodiumMg, potassiumMg: o?.potassiumMg, phosphorusMg: o?.phosphorusMg };
    return Object.values(v).every(Number.isFinite) ? v : null;
  };
  const remember = (verdict, inputName) => {
    const names = [norm(verdict?.food), norm(inputName)].filter(Boolean);
    if (names.length) candidates.set(names[0], { names, verdict });
  };
  if (typeof debugFrameDir === 'string' && debugFrameDir) console.log('[agent] debug frames are on; they hold what the caller shows');

  // First-call setup state, for this call only. The draft mirrors the saved profile; each setup tool saves at once.
  let setupActive = setupDue === true;
  let draft = null;
  let pending = null; // limits read back by propose_limits and waiting for the caller's yes
  const emptyDraft = () => ({ name: null, condition: null, limits: null, avoid: [], setupDone: false });
  const loadDraft = async () => {
    if (draft) return draft;
    let got = null;
    try { got = await renal.getSavedProfile({ patientId }); } catch { got = null; }
    if (got?.ok === true) {
      const s = got.saved;
      draft = s ? { name: s.name ?? null, condition: s.condition ?? null, limits: s.limits ? { ...s.limits } : null, avoid: Array.isArray(s.avoid) ? [...s.avoid] : [], setupDone: s.setupDone === true } : emptyDraft();
    } else {
      // Unknown saved state: never write over it with empty values.
      draft = { ...emptyDraft(), limitsUnknown: true };
    }
    return draft;
  };
  const saveDraft = async next => {
    const { limitsUnknown, ...profile } = next;
    let r = null;
    try { r = await renal.saveProfile({ patientId, profile }); } catch { r = null; }
    if (r?.ok === true) { draft = { ...profile }; return { ok: true }; }
    return { ok: false, refused: typeof r?.error === 'string' && r.error !== 'profile store unavailable' };
  };
  const needSetup = () => (setupActive ? null : fail('setup_not_started'));

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
        const limitsNeeded = got?.limitsNeeded === true;
        const verdicts = await Promise.all(foods.map(async food => {
          if (!profileOk) return null;
          try { return await renal.checkFood({ food, profile: got.profile }); } catch { return null; }
        }));
        const rows = [];
        const good = [];
        verdicts.forEach((v, i) => {
          if (v?.ok === true) {
            const verdict = normalVerdict(v.verdict);
            rows.push({ v, food: clean(v.food ?? foods[i].name, 80), verdict, swap: clean(v.swap, 40), speak: max => spokenVerdict({ ...v, verdict }, max) });
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
        call.display = {
          items: rows.slice(0, 6).map(r => (r.v
            ? displayItem(r.v, r.food, r.verdict)
            : { food: r.food, verdict: unjudged ? null : 'unknown', nutrients: null, portion: null, online: false })),
          more: notChecked + Math.max(0, rows.length - 6),
          unjudged,
          seen: rows.length,
          online: good.some(g => g.v?.source === 'web'),
        };
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
          const say = [unjudgedSay, limitsNeeded ? FAILS.limits_needed : '', omittedSay].filter(Boolean).join(' ');
          return {
            ok: true,
            kind: seen.kind,
            ...(nameless ? { unnamed: true } : {}),
            ...(unjudged ? { unjudged: true } : {}),
            ...(limitsNeeded ? { limitsNeeded: true } : {}),
            ...(good.some(g => g.v?.source === 'web') ? { online: true } : {}),
            ...(remembered ? { remembered: true } : {}),
            ...(shelf ? { best: shelf.name, spoken: shelf.spoken } : {}),
            results,
            ...(omitted > 0 ? { omitted } : {}),
            ...(say ? { say } : {}),
          };
        };
        // The first pass keeps every sentence whole (a cut sentence can lose the nutrient it names); the
        // tighter passes only run when the whole result would not fit in LOOK_LIMIT.
        for (const [capBad, capOk, capFood] of [[240, 240, 60], [130, 80, 40], [90, 30, 30], [60, 0, 24]]) {
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
        if (got?.limitsNeeded === true) return fail('limits_needed');
        if (!got?.ok) return fail('profile_unavailable');
        const v = await renal.checkFood({ food: { name, grams }, profile: got.profile });
        if (v?.ok !== true) return fail('check_failed');
        if (!call.timedOut) remember(v, name);
        const verdict = normalVerdict(v.verdict);
        call.display = { items: [displayItem(v, name, verdict)], more: 0, unjudged: false, seen: 1, online: v.source === 'web' };
        return { ok: true, food: clean(v.food ?? name, 80), verdict, spoken: spokenVerdict({ ...v, verdict }), swap: clean(v.swap, 60) || null };
      }, { timeoutMs }),
    }),
    dish_ingredients: llm.tool({
      description: 'Get the usual ingredients of a dish, with a quantity, a verdict for the caller\'s limits and a swap for each. Call it after look_at_camera when they showed the dish, or straight away when they name it, and for "what is in it", "get the ingredients" or "buy what it needs". Never list ingredients yourself. Say its say, then ask its ask.',
      parameters: z.object({ dish: z.string().trim().min(1).max(80) }),
      execute: guard(async (call, args = {}) => {
        const dish = typeof args.dish === 'string' ? args.dish.trim() : '';
        if (!dish || dish.length > 80) return fail('bad_food');
        const got = await renal.getProfile({ patientId });
        if (got?.limitsNeeded === true) return fail('limits_needed');
        if (!got?.ok) return fail('profile_unavailable');
        if (typeof renal.dishIngredients !== 'function') return fail('check_failed');
        const r = await renal.dishIngredients({ dish, profile: got.profile });
        if (r?.ok !== true) return fail('check_failed');
        const raw = Array.isArray(r.ingredients) ? r.ingredients : [];
        const rows = raw.slice(0, 8).map(i => ({
          name: clean(i?.name, 60),
          quantity: clean(i?.quantity, 40) || '1',
          verdict: normalVerdict(i?.verdict),
          swap: clean(i?.swap, 60),
          nutrients: i?.nutrients ?? null,
          portion: i?.portion ?? null,
          source: i?.source,
        })).filter(i => i.name);
        if (rows.length === 0) return fail('dish_unknown');
        if (!call.timedOut) {
          lastDish = { name: clean(r.dish ?? dish, 40) || clean(dish, 40), items: rows.map(i => ({ name: i.name, quantity: i.quantity })) };
          for (const i of rows) {
            qty.set(i.name.toLowerCase(), i.quantity.slice(0, 40));
            if (i.swap) qty.set(i.swap.toLowerCase(), i.quantity.slice(0, 40));
            if (i.verdict === 'avoid') avoidNames.add(i.name.toLowerCase());
          }
        }
        const sorted = [...rows].sort((a, b) => RANK[a.verdict] - RANK[b.verdict]);
        call.display = {
          items: sorted.slice(0, 6).map(i => displayItem({ food: i.name, nutrients: i.nutrients, portion: i.portion, source: i.source }, i.name, i.verdict)),
          more: Math.max(0, rows.length - 6),
          unjudged: false,
          seen: rows.length,
          online: rows.some(i => i.source === 'web'),
        };
        return dishResult(r.dish ?? dish, rows, Number.isInteger(r.omitted) ? r.omitted : 0);
      }, { timeoutMs, limit: DISH_LIMIT }),
    }),
    suggest_meal: llm.tool({
      description: "Suggest meals within the caller's limits. By default it cooks from everything the caller showed from their kitchen (fridge, pantry, cupboards). Set from_scratch true when the caller wants an idea without showing their kitchen, has nothing at home, or says to just suggest something; then every ingredient is a shopping item.",
      parameters: z.object({ from_scratch: z.boolean().nullish() }),
      execute: guard(async (call, args = {}) => {
        const fromScratch = args?.from_scratch === true;
        let foods = [];
        if (!fromScratch) {
          foods = await pantryNow();
          if (foods.length === 0) foods = lastFoods;
          if (foods.length === 0) return fail('nothing_seen');
        }
        const got = await renal.getProfile({ patientId });
        if (got?.limitsNeeded === true) return fail('limits_needed');
        if (!got?.ok) return fail('profile_unavailable');
        const r = fromScratch
          ? await renal.suggestMeals({ foods: [], profile: got.profile, count: 2, fromScratch: true })
          : await renal.suggestMeals({ foods, profile: got.profile, count: 2 });
        const meals = Array.isArray(r?.meals) ? r.meals : [];
        if (!r?.ok) return fail('check_failed');
        // Not a failure: the renal module found too little to cook a real, safe meal from.
        if (meals.length === 0) return fail(fromScratch ? 'no_safe_meal' : 'not_enough_food');
        const seen = new Map();
        for (const m of meals) for (const item of Array.isArray(m?.missing) ? m.missing : []) {
          const key = clean(item?.name, 80).toLowerCase();
          if (key && !KITCHEN_BASICS.has(key) && !seen.has(key)) seen.set(key, { name: clean(item.name, 80), quantity: clean(item.quantity, 80) });
        }
        if (!call.timedOut) {
          lastMissing = [...seen.values()];
          for (const i of lastMissing) if (i.quantity) qty.set(i.name.toLowerCase(), i.quantity.slice(0, 40));
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
        return { ok: true, ...(fromScratch ? { totalsAre: 'per serving, one typical portion of each ingredient' } : {}), meals: meals.map((m, i) => ({
          title: clean(m?.title, 60),
          ...(Number.isFinite(m?.minutes) ? { minutes: m.minutes } : {}),
          // From scratch the result carries the totals and the whole shopping list instead of the reason (the recipe text keeps it).
          ...(fromScratch ? {} : { why: clean(m?.why, 90) }),
          ...(three(m?.totals) ? { totals: three(m.totals) } : {}),
          missing: (Array.isArray(m?.missing) ? m.missing : []).slice(0, 6).map(x => clean(x?.name, fromScratch ? 30 : 40)).filter(Boolean),
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
        if (r?.limitsNeeded === true) return fail('limits_needed');
        if (!r?.ok) return fail('tool_failed');
        const totals = three(r.totals);
        const remaining = three(r.remaining);
        if (!totals || !remaining) return fail('tool_failed');
        return { ok: true, totals, remaining };
      }, { timeoutMs }),
    }),
    start_cart: llm.tool({
      description: 'Add exactly the caller\'s current shopping list to their online Kroger cart. Pass an empty list to use that list. Call it only after the caller has heard the list and clearly said to put it in their Kroger cart. If it fails with confirm_list, read the items back, ask, and call again only after they say yes. It says which items it is adding, and never pays or checks out. If it says it has not heard back, check cart_status before trying again.',
      parameters: z.object({ items: z.array(z.object({ name: z.string(), quantity: z.string() })) }),
      execute: guard(async (call, args = {}) => {
        let list = (Array.isArray(args.items) ? args.items : []).map(i => ({ name: cut(i?.name), quantity: cut(i?.quantity) })).filter(i => i.name);
        if (list.length === 0) {
          // Exactly the current list, and only after the caller has heard it in this call.
          const full = await listNow();
          if (full.length === 0) return fail('nothing_to_buy');
          const unsent = full.filter(i => !isSent(i.name));
          if (unsent.length === 0) return fail('already_in_cart');
          if (sig(full) !== listShownSig) return fail('confirm_list', listResult(full, 'items'));
          list = unsent;
        }
        list = list.slice(0, 12);
        // Kroger configured but nobody signed in: say so plainly and offer the texted link, instead of failing the cart.
        if (typeof actions.getKrogerStatus === 'function') {
          let ks = null;
          try { ks = await actions.getKrogerStatus(); } catch { ks = null; }
          if (ks?.ok === true && ks.configured === true && ks.connected === false) {
            return fail(ks.pending === true ? 'kroger_sign_in_pending' : ks.relay === true ? 'kroger_not_connected' : 'kroger_sign_in_needed');
          }
        }
        const r = await actions.startCart({ items: list });
        if (r?.error === 'busy') return fail('cart_busy');
        if (!r?.ok) return fail('tool_failed');
        if (!call.timedOut) for (const i of list) sentToKroger.add(i.name.toLowerCase());
        return { ok: true, started: true, items: list.slice(0, 5).map(i => i.name.slice(0, 50)), ...(list.length > 5 ? { more: list.length - 5 } : {}), say: "I'm adding these to your Kroger cart now." };
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
        if (s.state === 'failed') {
          const step = typeof s.step === 'string' ? s.step : '';
          if (/^(Sign in to Kroger first|Kroger sign-in expired)/.test(step)) return fail('kroger_not_connected', { state: 'failed' });
          return fail('cart_failed', { state: 'failed' });
        }
        if (typeof s.state !== 'string' || !Object.hasOwn(SAY, s.state)) return fail('tool_failed');
        const names = list => (Array.isArray(list) ? list : []).map(x => clean(typeof x === 'object' ? x?.name : x, 50)).filter(Boolean);
        const added = names(s.added);
        const missing = names(s.missing);
        const nothingAdded = s.state === 'done' && added.length === 0 && missing.length > 0;
        return {
          ok: true, state: s.state, say: nothingAdded ? FAILS.nothing_added : SAY[s.state],
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
        let s = await actions.getCartStatus();
        if (!s?.ok) return fail('tool_failed');
        // The model often asks for the link right after start_cart: give a running cart a short time to finish.
        const waitUntil = Date.now() + Math.max(0, Math.min(Number(cartWaitMs) || 0, 10000));
        while (s.state === 'running' && Date.now() < waitUntil) {
          await new Promise(resolve => setTimeout(resolve, 400));
          s = await actions.getCartStatus();
          if (!s?.ok) return fail('tool_failed');
        }
        let link = null;
        try {
          const u = new URL(String(s.cartUrl ?? ''));
          if ((u.protocol === 'https:' || u.protocol === 'http:') && u.href.length <= 500) link = u.href;
        } catch { /* not a link */ }
        // Done with no link means the store had none of the items: say that, not that the cart is not ready.
        if (s.state === 'done' && s.cartUrl == null && Array.isArray(s.added) && s.added.length === 0 && Array.isArray(s.missing) && s.missing.length > 0) return fail('nothing_added');
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
      description: 'Add things the caller wants to buy to their shopping list, which is kept between calls and shown on the video as not in the Kroger cart yet. Pass short item names (swap names if they chose swaps). A food that was judged a no for their limits is left off with a warning; pass keep_after_warning true only after they said to keep it anyway.',
      parameters: z.object({ items: z.array(z.string().trim().min(1).max(80)).min(1).max(20), keep_after_warning: z.boolean().nullish() }),
      execute: guard(async (call, args = {}) => {
        const items = Array.isArray(args.items) ? args.items : [];
        if (items.length < 1 || items.length > 20 || !items.every(x => typeof x === 'string' && x.trim().length >= 1 && x.trim().length <= 80)) return fail('bad_items');
        if (!memory || call.timedOut) return fail('memory_unavailable');
        for (const c of candidates.values()) if (c.verdict?.verdict === 'avoid') for (const n of c.names) avoidNames.add(n);
        const keep = args.keep_after_warning === true;
        const toAdd = [];
        const held = [];
        for (const raw of items) {
          const name = raw.trim();
          const isAvoid = [...avoidNames].some(a => sameFood(a, name));
          const wasHeld = [...heldNames].some(h => sameFood(h, name));
          if (isAvoid && !(keep && wasHeld)) { held.push(name); heldNames.add(name.toLowerCase()); } else toAdd.push(name);
        }
        for (const n of toAdd) if (!qty.get(n.toLowerCase())) qty.set(n.toLowerCase(), '1');
        let r = null;
        if (toAdd.length > 0) r = await memory.add(toAdd);
        else { const l = await memory.load(); r = l?.ok ? { ok: true, added: [], state: l.state } : null; }
        if (!r?.ok || !r.state) return fail('memory_unavailable');
        const list = await listNow();
        const shown = listResult(list);
        showList(list, call);
        const heldSay = held.length > 0 ? `I left ${held.slice(0, 3).map(x => x.slice(0, 30)).join(', ')} off your list because it's not a good fit for your limits. Tell me if you still want to keep it.` : '';
        return {
          ok: true,
          added: r.added.slice(0, 5).map(x => x.slice(0, 50)), ...(r.added.length > 5 ? { addedMore: r.added.length - 5 } : {}),
          left: r.state.needed.length,
          ...(held.length > 0 ? { held: held.slice(0, 3).map(x => x.slice(0, 30)), say: heldSay } : {}),
          ...shown,
        };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    remove_from_list: llm.tool({
      description: 'Take items off the caller\'s shopping list, or clear it with all true. Pass short item names. Set from_kroger_cart true when they ask to remove something from their Kroger cart or something already sent to it; then say its say sentence exactly and never say it left the Kroger cart.',
      parameters: z.object({ items: z.array(z.string().trim().min(1).max(80)).max(20).nullish(), all: z.boolean().nullish(), from_kroger_cart: z.boolean().nullish() }),
      execute: guard(async (call, args = {}) => {
        const asked = (Array.isArray(args.items) ? args.items : []).map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
        const all = args.all === true;
        if (!all && asked.length === 0) return fail('bad_items');
        if (asked.length > 20 || asked.some(x => x.length > 80)) return fail('bad_items');
        const honest = args.from_kroger_cart === true || (all && sentToKroger.size > 0) || asked.some(isSent);
        if (call.timedOut) return fail('timeout');
        const before = await listNow();
        const gone = new Set();
        let memoryFailed = false;
        if (memory) {
          try {
            const r = all ? await memory.clearList() : await memory.remove(asked);
            if (r?.ok) {
              if (all) for (const i of before) gone.add(i.name.toLowerCase());
              else for (const n of r.removed) gone.add(n.toLowerCase());
            } else memoryFailed = true;
          } catch { memoryFailed = true; }
        }
        const stillMissing = lastMissing.filter(i => !all && !asked.some(a => matchPantry([i.name], a).length > 0));
        for (const i of lastMissing) if (!stillMissing.includes(i)) gone.add(i.name.toLowerCase());
        lastMissing = stillMissing;
        for (const g of gone) qty.delete(g);
        if (gone.size === 0 && !honest) return fail(memoryFailed ? 'memory_unavailable' : 'not_on_list');
        const list = await listNow();
        const shown = listResult(list);
        showList(list, call);
        return { ok: true, removed: [...gone].slice(0, 5).map(x => x.slice(0, 50)), ...shown, ...(honest ? { say: KROGER_NO_REMOVE } : {}) };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    set_quantity: llm.tool({
      description: 'Change how much of one item is on the shopping list, for example "make it two loaves". Pass the item name and the new quantity as a few words.',
      parameters: z.object({ name: z.string().trim().min(1).max(80), quantity: z.string().trim().min(1).max(40) }),
      execute: guard(async (call, args = {}) => {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        const quantity = clean(args.quantity, 40);
        if (!name || name.length > 80 || !quantity) return fail('bad_item');
        const before = await listNow();
        const hit = matchPantry(before.map(i => i.name), name)[0];
        if (!hit) return fail('not_on_list');
        if (call.timedOut) return fail('timeout');
        qty.set(hit.toLowerCase(), quantity);
        const list = await listNow();
        const shown = listResult(list);
        showList(list, call);
        return { ok: true, name: hit.slice(0, 50), quantity: quantity.slice(0, 40), ...shown };
      }, { timeoutMs, limit: LIST_LIMIT }),
    }),
    text_list: llm.tool({
      description: 'Text the caller their shopping list (the items and quantities) when they ask for it, for example "text me the ingredients". It sends one text and never includes health numbers.',
      execute: guard(async call => {
        if (!phoneOk) return fail('no_phone');
        let items = await listNow();
        let title = 'Shopping list from your AI renal dietitian:';
        if (items.length === 0 && lastDish && lastDish.items.length > 0) {
          items = lastDish.items;
          title = `Ingredients for ${lastDish.name} from your AI renal dietitian:`;
        }
        if (items.length === 0) return fail('nothing_to_text');
        const lines = items.slice(0, 20).map(i => `- ${clean(i.name, 60)} (${clean(i.quantity, 30) || '1'})`);
        let text = [title, ...lines, LIST_CLOSING].join('\n');
        if (text.length > 1500) text = [title, ...lines.slice(0, 10), LIST_CLOSING].join('\n');
        if (sentLists.has(text)) return fail('list_already_sent');
        // Marked before sending: a send that times out may still arrive, and a repeat would duplicate it.
        sentLists.add(text);
        let r;
        try { r = await actions.sendText({ phone, text }); }
        catch { sentLists.delete(text); return fail('list_text_failed'); }
        if (r?.ok) return { ok: true, sent: true, count: Math.min(items.length, 20) };
        if (typeof r?.error === 'string' && /outcome is unknown/i.test(r.error)) return fail('list_text_unconfirmed');
        sentLists.delete(text);
        return fail('list_text_failed');
      }, { timeoutMs, onTimeout: () => fail('list_text_unconfirmed') }),
    }),
    shopping_list: llm.tool({
      description: "What is on the caller's shopping list, kept between calls: still needed, approved and rejected items. It also shows the list on the video as not in the Kroger cart yet.",
      execute: guard(async call => {
        if (!memory) return fail('memory_unavailable');
        const r = await memory.load();
        if (!r?.ok) return fail('memory_unavailable');
        const part = (list, n) => ({ names: list.slice(0, n).map(x => x.slice(0, 40)), more: list.length - n });
        const { needed, approved, rejected } = r.state;
        const a = part(needed, 8), b = part(approved, 5), c = part(rejected, 3);
        const list = needed.map(cut).filter(Boolean).map(name => ({ name, quantity: quantityOf(name) }));
        if (list.length > 0) { listShownSig = sig(list); showList(list, call); }
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
    kroger_status: llm.tool({
      description: "Whether the caller's Kroger account is connected for grocery carts. Call it during setup, and after the caller says they signed in. Its say sentence is what to tell the caller.",
      execute: guard(async () => {
        if (typeof actions.getKrogerStatus !== 'function') return fail('tool_failed');
        const s = await actions.getKrogerStatus();
        if (s?.ok !== true) return fail('tool_failed');
        if (s.configured !== true) return { ok: true, connected: false, set_up: false, can_text: false, say: "Kroger shopping isn't set up on this line, so there's nothing to sign in to." };
        if (s.connected === true) return { ok: true, connected: true, say: 'Your Kroger account is connected.' };
        if (s.pending === true) return { ok: true, connected: false, pending: true, can_text: true, say: "I'm still waiting for you to finish signing in to Kroger from the link I texted you." };
        if (s.relay === true) return { ok: true, connected: false, can_text: true, say: "Your Kroger account isn't connected yet. I can text you a link to sign in." };
        return { ok: true, connected: false, can_text: false, say: "Your Kroger account isn't connected yet, and I can't text a sign-in link on this line." };
      }, { timeoutMs }),
    }),
    text_kroger_sign_in: llm.tool({
      description: 'Text the caller a link to sign in to Kroger so the cart works. Use it during setup when kroger_status says can_text, or when the caller agrees to sign in. Never read the link aloud; it is only in the text.',
      execute: guard(async () => {
        if (!phoneOk) return fail('no_phone');
        if (krogerTextAt !== null && now() - krogerTextAt < 60_000) return fail('kroger_link_already_sent');
        if (typeof actions.startKrogerSignIn !== 'function') return fail('tool_failed');
        const started = await actions.startKrogerSignIn();
        if (started?.ok !== true) {
          return fail(started?.error === 'not_configured' || started?.error === 'no_relay' ? 'kroger_not_configured' : 'tool_failed');
        }
        let link = null;
        try {
          const u = new URL(String(started.link ?? ''));
          if (u.protocol === 'https:' && u.href.length <= 300) link = u.href;
        } catch { /* not a link */ }
        if (!link) return fail('tool_failed');
        // Marked before sending: a send that times out may still arrive, and a repeat would duplicate it.
        krogerTextAt = now();
        let r;
        try { r = await actions.sendText({ phone, text: `Sign in to Kroger so your renal dietitian can fill your cart: ${link} Nothing is ever paid for you.` }); }
        catch { krogerTextAt = null; return fail('kroger_text_failed'); }
        if (r?.ok) return { ok: true, sent: true, say: "I've texted you a Kroger sign-in link. Tap it and sign in while we keep going." };
        const why = typeof r?.error === 'string' ? r.error : '';
        if (/HTTP 403/.test(why)) { krogerTextAt = null; return fail('kroger_texting_refused'); }
        if (/outcome is unknown/i.test(why)) return fail('kroger_text_unconfirmed');
        krogerTextAt = null;
        return fail('kroger_text_failed');
      }, { timeoutMs, onTimeout: () => fail('kroger_text_unconfirmed') }),
    }),
    start_setup: llm.tool({
      description: 'Only when the caller explicitly asks to change their setup, limits, voice or preferences (for example "update my setup"). Never for a food, a dish, ingredients, a list or a cart. Setup tools only work after this.',
      execute: guard(async call => {
        setupActive = true;
        pending = null;
        draft = null;
        await loadDraft();
        if (call.timedOut) return fail('timeout');
        return { ok: true, say: "Let's update your setup. You can say skip at any step." };
      }, { timeoutMs }),
    }),
    save_profile_basics: llm.tool({
      description: 'Setup only. Save the name the caller wants to be called and their kidney condition (ckd, hemodialysis, peritoneal_dialysis, transplant or unsure). Pass null for a step they skipped.',
      parameters: z.object({ name: z.string().max(80).nullish(), condition: z.string().max(40).nullish() }),
      execute: guard(async (call, args = {}) => {
        const gate = needSetup();
        if (gate) return gate;
        let name = null;
        if (args?.name !== null && args?.name !== undefined) {
          name = cleanCallName(args.name);
          if (!name) return fail('bad_name');
        }
        let condition = null;
        if (args?.condition !== null && args?.condition !== undefined) {
          const c = String(args.condition).toLowerCase().trim();
          if (!CONDITIONS.includes(c)) return fail('bad_condition');
          condition = c;
        }
        const d = await loadDraft();
        if (d.limitsUnknown) return fail('profile_unsaved');
        if (call.timedOut) return fail('timeout');
        const saved = await saveDraft({ ...d, name: name ?? d.name, condition: condition ?? d.condition });
        if (!saved.ok) return fail('profile_unsaved');
        if (name && memory) { try { await memory.savePreferences({ name }); } catch { /* a preference failure never fails this tool */ } }
        return { ok: true };
      }, { timeoutMs }),
    }),
    propose_limits: llm.tool({
      description: "Setup only. Step 1 of 2 for the caller's daily limits as read from their care team: sodium, potassium and phosphorus in milligrams, fluid in milliliters. Returns a sentence to read back. Nothing is saved until confirm_limits.",
      parameters: z.object({ sodium_mg: z.number().nullish(), potassium_mg: z.number().nullish(), phosphorus_mg: z.number().nullish(), fluid_ml: z.number().nullish() }),
      execute: guard(async (call, args = {}) => {
        const gate = needSetup();
        if (gate) return gate;
        pending = null;
        if (LIMIT_FIELDS.some(([, , arg]) => args?.[arg] === null || args?.[arg] === undefined)) return fail('limit_missing');
        const limits = {};
        for (const [nutrient, key, arg] of LIMIT_FIELDS) {
          const v = args[arg];
          const [min, max] = LIMIT_BOUNDS[key];
          if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return fail(`bad_${nutrient}`);
          limits[key] = v;
        }
        if (call.timedOut) return fail('timeout');
        pending = { limits, at: now() };
        return { ok: true, pending: true, say: `I heard sodium ${limits.sodiumMg} milligrams, potassium ${limits.potassiumMg} milligrams, phosphorus ${limits.phosphorusMg} milligrams and fluid ${limits.fluidMl} milliliters a day. Is that right?` };
      }, { timeoutMs }),
    }),
    confirm_limits: llm.tool({
      description: 'Setup only. Step 2 of 2: call this only after the caller has said yes to the numbers you read back, with exactly those same four numbers. This is the only thing that saves limits.',
      parameters: z.object({ sodium_mg: z.number().nullish(), potassium_mg: z.number().nullish(), phosphorus_mg: z.number().nullish(), fluid_ml: z.number().nullish() }),
      execute: guard(async (call, args = {}) => {
        const gate = needSetup();
        if (gate) return gate;
        if (!pending) return fail('no_proposal');
        if (LIMIT_FIELDS.some(([, key, arg]) => args?.[arg] !== pending.limits[key])) { pending = null; return fail('limits_changed'); }
        const asked = pending;
        if (now() - asked.at < CONFIRM_MIN_MS) return fail('limits_not_confirmed');
        let heard = null;
        try { heard = callerHeardAfter(asked.at + 1000); } catch { heard = null; }
        if (heard === false) return fail('limits_not_confirmed');
        const d = await loadDraft();
        if (call.timedOut) return fail('timeout');
        const saved = await saveDraft({ ...d, limits: { ...asked.limits } });
        if (!saved.ok) return fail('profile_unsaved');
        pending = null;
        return { ok: true, saved: true, say: "Saved. These are the limits you told me your care team gave you, and I'll use them from now on." };
      }, { timeoutMs }),
    }),
    set_avoid_foods: llm.tool({
      description: "Setup only. Save foods the caller's care team told them to avoid, or their food allergies. An empty list is fine.",
      parameters: z.object({ foods: z.array(z.string().max(80)).max(20) }),
      execute: guard(async (call, args = {}) => {
        const gate = needSetup();
        if (gate) return gate;
        const seen = new Set();
        const foods = [];
        for (const raw of Array.isArray(args?.foods) ? args.foods : []) {
          const f = clean(raw, 40);
          if (!f || seen.has(f.toLowerCase())) continue;
          seen.add(f.toLowerCase());
          foods.push(f);
        }
        if (foods.length > MAX_AVOID) return fail('bad_foods');
        const d = await loadDraft();
        if (d.limitsUnknown) return fail('profile_unsaved');
        if (call.timedOut) return fail('timeout');
        const saved = await saveDraft({ ...d, avoid: foods });
        if (!saved.ok) return fail(saved.refused ? 'bad_foods' : 'profile_unsaved');
        return { ok: true, count: draft.avoid.length };
      }, { timeoutMs }),
    }),
    set_preferences: llm.tool({
      description: 'Save how the caller wants the agent to sound: voice (upbeat, firm, warm or mature), reply_style (brief or detailed) and language (english or spanish). Pass null for what they did not choose.',
      parameters: z.object({ voice: z.string().max(20).nullish(), reply_style: z.string().max(20).nullish(), language: z.string().max(20).nullish() }),
      execute: guard(async (call, args = {}) => {
        const given = v => v !== null && v !== undefined;
        const word = v => String(v).toLowerCase().trim();
        const next = {};
        if (given(args?.voice)) {
          const v = word(args.voice);
          const name = Object.hasOwn(VOICE_MENU, v) ? VOICE_MENU[v] : Object.values(VOICE_MENU).find(x => x.toLowerCase() === v);
          if (!name) return fail('bad_preference');
          next.voice = name;
        }
        if (given(args?.reply_style)) {
          const v = word(args.reply_style);
          if (v !== 'brief' && v !== 'detailed') return fail('bad_preference');
          next.replyStyle = v;
        }
        if (given(args?.language)) {
          const v = word(args.language);
          const code = v === 'english' || v === 'en' ? 'en' : v === 'spanish' || v === 'es' ? 'es' : null;
          if (!code) return fail('bad_preference');
          next.language = code;
        }
        if (Object.keys(next).length === 0) return fail('bad_preference');
        if (!memory || typeof memory.savePreferences !== 'function') return fail('prefs_unsaved');
        let before = null;
        if (next.voice) { try { before = (await memory.loadPreferences())?.prefs?.voice ?? null; } catch { before = null; } }
        if (call.timedOut) return fail('timeout');
        let r = null;
        try { r = await memory.savePreferences(next); } catch { r = null; }
        if (!r?.ok) return fail('prefs_unsaved');
        return { ok: true, say: next.voice && next.voice !== (before ?? 'Puck') ? 'Saved. Your new voice starts on your next call.' : 'Saved.' };
      }, { timeoutMs }),
    }),
    finish_onboarding: llm.tool({
      description: 'Setup only. Call once at the end of setup, after telling the caller what you can do. Marks setup finished, says whether limits were saved and, if a Kroger link was texted this call, whether Kroger is connected.',
      execute: guard(async call => {
        const gate = needSetup();
        if (gate) return gate;
        pending = null;
        const d = await loadDraft();
        if (d.limitsUnknown) return fail('profile_unsaved');
        if (call.timedOut) return fail('timeout');
        const saved = await saveDraft({ ...d, setupDone: true });
        if (!saved.ok) return fail('profile_unsaved');
        setupActive = false;
        const base = draft.limits
          ? { ok: true, complete: true, say: "You're all set. I'll use the limits you told me your care team gave you." }
          : { ok: true, complete: false, say: "Your setup is saved, but without your care team's limits I can't judge foods yet. When you have them, say 'update my setup'." };
        // Only when a link was texted this call: one fixed sentence about Kroger. Bounded; never changes ok or complete.
        if (krogerTextAt !== null && typeof actions.getKrogerStatus === 'function') {
          let timer;
          try {
            const late = new Promise(resolve => { timer = setTimeout(() => resolve(null), Math.min(3000, Math.floor(timeoutMs / 2))); });
            const s = await Promise.race([Promise.resolve().then(() => actions.getKrogerStatus()).catch(() => null), late]);
            if (s?.ok && s.configured && s.connected) return { ...base, say: `${base.say} Your Kroger account is connected.` };
            if (s?.ok && s.configured && s.relay && !s.connected) return { ...base, say: `${base.say} ${KROGER_FINISH_LATER}` };
          } catch { /* no Kroger sentence */ } finally { clearTimeout(timer); }
        }
        return base;
      }, { timeoutMs }),
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
