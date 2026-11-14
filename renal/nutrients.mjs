import { errorResult, normalizeFoodName, readData, writeData } from './data.mjs';

const NUTRIENT_IDS = { sodiumMg: 1093, potassiumMg: 1092, phosphorusMg: 1091, waterMl: 1051 };
let cache;

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
    return cached ? { ok: true, found: true, ...cached } : { ok: true, found: false };
  }

  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', name);
  url.searchParams.set('dataType', 'Foundation,SR Legacy');
  url.searchParams.set('pageSize', '1');

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
  const result = payload.foods?.[0];
  if (!result || !Array.isArray(result.foodNutrients)) {
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
    name: result.description ?? name,
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
    if (seed) return { ok: true, found: true, source: 'usda', ...seed };

    const result = await lookupUsda(food.name.trim());
    if (!result.ok || !result.found) return result;
    return { ...result, source: 'usda' };
  } catch (error) {
    return errorResult(error, 'could not look up nutrients');
  }
}
