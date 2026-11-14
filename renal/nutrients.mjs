import { errorResult, normalizeFoodName, plausibleMatch, readData, writeData } from './data.mjs';
import { acceptWebEntry, lookupWeb } from './websearch.mjs';

export { plausibleMatch };

const NUTRIENT_IDS = { sodiumMg: 1093, potassiumMg: 1092, phosphorusMg: 1091, waterMl: 1051 };
let cache;

function findSeed(name, foods) {
  const normalized = normalizeFoodName(name);
  return Object.values(foods).find((food) =>
    normalizeFoodName(food.name) === normalized ||
    (food.aliases ?? []).some((alias) => normalizeFoodName(alias) === normalized)
  ) ?? null;
}

// Dropping these words from a name would understate sodium, potassium or phosphorus
// (preserved, flavored, dairy-free or concentrated versions differ from the plain seed food).
const RISK_WORDS = new Set([
  'smoked', 'cured', 'corned', 'canned', 'pickled', 'brined', 'salted', 'salt', 'seasoned', 'marinated',
  'dried', 'dehydrated', 'instant', 'processed', 'deli', 'fried', 'chocolate', 'cocoa', 'coconut', 'almond',
  'soy', 'oat', 'cashew', 'condensed', 'evaporated', 'powdered', 'powder', 'flavored', 'flavoured',
  'sweetened', 'cream', 'creamed', 'cheese', 'sauce', 'soup', 'juice', 'chips', 'jerky', 'sausage', 'enhanced',
]);

function wordForms(word) {
  const forms = new Set([word, `${word}s`, `${word}es`]);
  if (word.endsWith('ies')) forms.add(`${word.slice(0, -3)}y`);
  if (word.endsWith('es')) forms.add(word.slice(0, -2));
  if (word.endsWith('s')) forms.add(word.slice(0, -1));
  if (word.endsWith('y')) forms.add(`${word.slice(0, -1)}ies`);
  return forms;
}

// Exact name or alias equality only, tolerating singular/plural of the last word.
function findSeedLoose(words, foods) {
  for (const form of wordForms(words[words.length - 1])) {
    const seed = findSeed([...words.slice(0, -1), form].join(' '), foods);
    if (seed) return seed;
  }
  return null;
}

// "Local Bounti Crispy Green Leaf lettuce" -> the lettuce seed. Conservative: the longest trailing 1-3 words
// that exactly name a seed food win, and the match is refused when a dropped word could change the nutrition
// or is itself a food (so "banana milk", "coconut water", "smoked salmon", "oat milk" are never reduced).
function genericSeed(name, foods, hardRules) {
  const words = normalizeFoodName(name).split(' ').filter(Boolean);
  if (words.length < 2) return null;
  const known = new Set();
  for (const food of Object.values(foods)) {
    known.add(normalizeFoodName(food.name));
    for (const alias of food.aliases ?? []) known.add(normalizeFoodName(alias));
  }
  for (const entry of [...(hardRules?.alwaysAvoid ?? []), ...(hardRules?.alwaysLimit ?? [])]) {
    known.add(normalizeFoodName(entry.name));
  }
  const isFoodPhrase = (parts) => [...wordForms(parts[parts.length - 1])]
    .some((form) => known.has([...parts.slice(0, -1), form].join(' ')));

  for (const k of [3, 2, 1]) {
    if (k >= words.length) continue;
    const seed = findSeedLoose(words.slice(-k), foods);
    if (!seed) continue;
    const dropped = words.slice(0, words.length - k);
    if (dropped.some((word) => RISK_WORDS.has(word))) return null;
    for (let i = 0; i < dropped.length; i += 1) {
      if (isFoodPhrase([dropped[i]])) return null;
      if (i + 1 < dropped.length && isFoodPhrase([dropped[i], dropped[i + 1]])) return null;
    }
    return { ...seed, source: 'usda', matched: 'seed', genericFrom: name };
  }
  return null;
}

function cachedFood(name, entries) {
  return entries?.[normalizeFoodName(name)] ?? null;
}

function portionFromUSDA(food) {
  if (!Array.isArray(food.foodPortions)) return null;
  const portions = food.foodPortions
    .filter((portion) => Number.isFinite(portion.gramWeight) && portion.gramWeight > 0 &&
      Number.isFinite(portion.amount) && portion.amount > 0)
    .sort((left, right) => {
      const leftText = `${left.portionDescription ?? ''} ${left.modifier ?? ''} ${left.unitName ?? ''}`;
      const rightText = `${right.portionDescription ?? ''} ${right.modifier ?? ''} ${right.unitName ?? ''}`;
      const household = /\b(cup|tablespoon|teaspoon|slice|piece|medium|large|small|can|bottle|bar)\b/i;
      return Number(household.test(rightText)) - Number(household.test(leftText));
    });
  const portion = portions[0];
  if (!portion) return null;
  const description = portion.portionDescription?.trim() ||
    [portion.amount, portion.modifier || portion.unitName].filter(Boolean).join(' ');
  if (!description) return null;
  return {
    servingGrams: portion.gramWeight,
    portion: `${description} (${Math.round(portion.gramWeight)} g)`,
    servingEstimated: false,
  };
}

function typicalServing(name) {
  const normalized = normalizeFoodName(name);
  if (/\b(cereal|corn flakes|granola)\b/.test(normalized)) {
    return { servingGrams: 30, portion: 'about 1 cup (30 g)', servingEstimated: true };
  }
  if (/\b(ketchup)\b/.test(normalized)) {
    return { servingGrams: 17, portion: 'about 1 tablespoon (17 g)', servingEstimated: true };
  }
  if (/\b(mustard|mayonnaise|mayo|dressing|condiment)\b/.test(normalized)) {
    return { servingGrams: 15, portion: 'about 1 tablespoon (15 g)', servingEstimated: true };
  }
  if (/\b(coconut water|juice|milk|beverage|drink|tea|coffee|water)\b/.test(normalized)) {
    return { servingGrams: 240, portion: 'about 1 cup (240 mL)', servingEstimated: true };
  }
  return null;
}

async function loadCache() {
  if (!cache) {
    try {
      cache = await readData('cache.json');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      cache = { foods: {} };
    }
  }
  return cache;
}

async function lookupUsda(name) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) return { ok: true, found: false };

  const currentCache = await loadCache();
  const cacheKey = normalizeFoodName(name);
  if (Object.hasOwn(currentCache.foods, cacheKey)) {
    const cached = cachedFood(name, currentCache.foods);
    if (!cached) return { ok: true, found: false };
    // Positives cached by older code are only trusted if they credibly match the query.
    if (plausibleMatch(name, cached.name)) return { ok: true, found: true, ...cached };
  }

  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', name);
  url.searchParams.set('dataType', 'Foundation,SR Legacy');
  url.searchParams.set('pageSize', '10');

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(2400) });
  } catch (error) {
    return errorResult(error, 'USDA lookup failed');
  }
  if (!response.ok) return { ok: false, error: `USDA lookup failed (${response.status})` };

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: 'USDA returned invalid JSON' };
  }
  const candidates = Array.isArray(payload.foods) ? payload.foods : [];
  const result = candidates.find((candidate) =>
    candidate && Array.isArray(candidate.foodNutrients) &&
    typeof candidate.description === 'string' &&
    plausibleMatch(name, candidate.description) &&
    ['sodiumMg', 'potassiumMg', 'phosphorusMg'].some((field) =>
      typeof candidate.foodNutrients.find((entry) => entry?.nutrientId === NUTRIENT_IDS[field])?.value === 'number'));
  if (!result) {
    // Nothing credible: remember the absence, never a rejected hit as a positive.
    currentCache.foods[cacheKey] = null;
    await writeData('cache.json', currentCache);
    return { ok: true, found: false };
  }

  const nutrients = {};
  for (const [field, nutrientId] of Object.entries(NUTRIENT_IDS)) {
    const nutrient = result.foodNutrients.find((entry) => entry.nutrientId === nutrientId);
    nutrients[field] = typeof nutrient?.value === 'number' ? nutrient.value : null;
  }
  const entry = {
    nutrients: {
      sodiumMg: nutrients.sodiumMg,
      potassiumMg: nutrients.potassiumMg,
      phosphorusMg: nutrients.phosphorusMg,
    },
    waterMl: nutrients.waterMl,
    fdcId: result.fdcId ?? null,
    name: result.description,
    query: name,
    ...(portionFromUSDA(result) ?? typicalServing(name) ?? {}),
  };
  currentCache.foods[cacheKey] = entry;
  await writeData('cache.json', currentCache);
  return { ok: true, found: true, ...entry };
}

// Rejected web lookups are remembered in memory only, so a flaky answer is retried later.
const WEB_MISS_MS = 10 * 60 * 1000;
const webMisses = new Map();

async function webStep(name, ai) {
  const key = normalizeFoodName(name);
  const currentCache = await loadCache();
  currentCache.web ??= {};
  const cached = currentCache.web[key];
  if (cached !== undefined) {
    // Persisted web numbers are re-validated on every read; a tampered or mismatched entry is dropped.
    if (acceptWebEntry(name, cached)) return { ok: true, found: true, ...cached, source: 'web', matched: 'web' };
    delete currentCache.web[key];
  }
  const missUntil = webMisses.get(key);
  if (missUntil !== undefined) {
    if (missUntil > Date.now()) return { ok: true, found: false };
    webMisses.delete(key);
  }
  const web = await lookupWeb(name, { ai });
  if (web.found) {
    const entry = { ...web.entry, savedAt: new Date().toISOString() };
    currentCache.web[key] = entry;
    await writeData('cache.json', currentCache);
    return { ok: true, found: true, ...entry, source: 'web', matched: 'web' };
  }
  if (web.rejected) webMisses.set(key, Date.now() + WEB_MISS_MS);
  return { ok: true, found: false };
}

export async function lookupFood(food, { ai } = {}) {
  if (!food || typeof food.name !== 'string' || !food.name.trim()) {
    return { ok: false, error: 'food name is required' };
  }

  try {
    const foods = await readData('foods.json');
    const seed = findSeed(food.name, foods);
    if (seed) return { ok: true, found: true, ...seed, source: 'usda', matched: 'seed' };

    const generic = genericSeed(food.name, foods, await readData('hard-rules.json'));
    if (generic) return { ok: true, found: true, ...generic };

    // A USDA failure (429, 5xx, timeout, bad JSON) is never a failed check: fall through to the grounded web lookup.
    let usda;
    try {
      usda = await lookupUsda(food.name.trim());
    } catch {
      usda = { ok: false };
    }
    if (usda.ok && usda.found) return { ...usda, source: 'usda', matched: 'usda' };

    return await webStep(food.name.trim(), ai);
  } catch (error) {
    return errorResult(error, 'could not look up nutrients');
  }
}
