import { errorResult, normalizeFoodName, readData, writeData } from './data.mjs';

const NUTRIENT_IDS = { sodiumMg: 1093, potassiumMg: 1092, phosphorusMg: 1091, waterMl: 1051 };
let cache;

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'in', 'or', 'raw', 'fresh', 'plain']);

function significantTokens(value) {
  return normalizeFoodName(value).split(' ').filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function tokenMatches(queryToken, descriptionTokens) {
  const forms = new Set([queryToken, `${queryToken}s`, `${queryToken}es`]);
  if (queryToken.endsWith('es')) forms.add(queryToken.slice(0, -2));
  if (queryToken.endsWith('s')) forms.add(queryToken.slice(0, -1));
  if (queryToken.endsWith('ies')) forms.add(`${queryToken.slice(0, -3)}y`);
  if (queryToken.endsWith('y')) forms.add(`${queryToken.slice(0, -1)}ies`);
  return descriptionTokens.some((token) => forms.has(token));
}

// True only when every significant word of the query appears in the USDA description (plural tolerant).
export function plausibleMatch(query, description) {
  if (typeof query !== 'string' || typeof description !== 'string') return false;
  const queryTokens = significantTokens(query);
  if (queryTokens.length === 0) return false;
  const descriptionTokens = significantTokens(description);
  return queryTokens.every((token) => tokenMatches(token, descriptionTokens));
}

function findSeed(name, foods) {
  const normalized = normalizeFoodName(name);
  return Object.values(foods).find((food) =>
    normalizeFoodName(food.name) === normalized ||
    (food.aliases ?? []).some((alias) => normalizeFoodName(alias) === normalized)
  ) ?? null;
}

function cachedFood(name, entries) {
  return entries?.[normalizeFoodName(name)] ?? null;
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
  };
  currentCache.foods[cacheKey] = entry;
  await writeData('cache.json', currentCache);
  return { ok: true, found: true, ...entry };
}

export async function lookupFood(food) {
  if (!food || typeof food.name !== 'string' || !food.name.trim()) {
    return { ok: false, error: 'food name is required' };
  }

  try {
    const foods = await readData('foods.json');
    const seed = findSeed(food.name, foods);
    if (seed) return { ok: true, found: true, ...seed, source: 'usda', matched: 'seed' };

    const result = await lookupUsda(food.name.trim());
    if (!result.ok || !result.found) return result;
    return { ...result, source: 'usda', matched: 'usda' };
  } catch (error) {
    return errorResult(error, 'could not look up nutrients');
  }
}
