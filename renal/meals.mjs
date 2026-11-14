import { checkFood } from './check.mjs';
import { errorResult, normalizeFoodName, readData } from './data.mjs';
import { generateJsonWithFallback } from './gemini.mjs';

const FALLBACK_MEALS = [
  {
    title: 'Herbed chicken and white rice',
    uses: ['unsalted chicken', 'white rice', 'cabbage'],
    missing: [{ name: 'unsalted chicken', quantity: '1 portion' }],
    minutes: 25,
    steps: ['Cook the white rice in water.', 'Pan-cook the chicken with herbs and no added salt.', 'Serve with steamed cabbage.'],
    why: 'Uses simple ingredients and avoids added salt.',
  },
  {
    title: 'Apple and egg-white rice bowl',
    uses: ['white rice', 'egg white', 'apple'],
    missing: [{ name: 'egg white', quantity: '2 large' }],
    minutes: 15,
    steps: ['Warm the cooked rice.', 'Scramble the egg whites without salt.', 'Serve with sliced apple.'],
    why: 'A quick option with a modest potassium portion.',
  },
  {
    title: 'Cabbage pasta with garlic',
    uses: ['pasta', 'cabbage', 'garlic'],
    missing: [{ name: 'pasta', quantity: '1 serving' }, { name: 'garlic', quantity: '1 clove' }],
    minutes: 20,
    steps: ['Boil pasta and drain it.', 'Cook sliced cabbage with garlic and a little oil.', 'Combine and season with herbs instead of salt.'],
    why: 'A low-sodium meal when prepared without salty sauces.',
  },
];

const PANTRY_STAPLES = new Set([
  'water',
  'oil',
  'olive oil',
  'vegetable oil',
  'canola oil',
  'cooking oil',
  'pepper',
  'black pepper',
  'herb',
  'herbs',
  'rosemary',
  'thyme',
  'basil',
  'oregano',
  'parsley',
  'dill',
  'sage',
  'chives',
]);

const FOOD_ALIASES = new Map([
  ['chicken', 'unsalted chicken'],
  ['chicken breast', 'unsalted chicken'],
  ['rice', 'white rice'],
  ['eggs', 'egg'],
  ['egg whites', 'egg white'],
]);

function isPantryStaple(name) {
  const normalized = normalizeFoodName(name);
  return PANTRY_STAPLES.has(normalized) ||
    normalized.endsWith(' oil') ||
    normalized.endsWith(' herbs') ||
    normalized.endsWith(' herb') ||
    normalized === 'ground pepper';
}

function canonicalFoodName(name, catalog) {
  const normalized = normalizeFoodName(name);
  const alias = FOOD_ALIASES.get(normalized);
  if (alias) return alias;
  for (const food of Object.values(catalog)) {
    if (normalizeFoodName(food.name) === normalized ||
        (food.aliases ?? []).some((item) => normalizeFoodName(item) === normalized)) {
      return normalizeFoodName(food.name);
    }
  }
  return normalized;
}

const MEAL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    meals: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          uses: { type: 'ARRAY', items: { type: 'STRING' } },
          missing: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { name: { type: 'STRING' }, quantity: { type: 'STRING' } },
              required: ['name', 'quantity'],
            },
          },
          minutes: { type: 'INTEGER' },
          steps: { type: 'ARRAY', items: { type: 'STRING' } },
          why: { type: 'STRING' },
        },
        required: ['title', 'uses', 'missing', 'minutes', 'steps', 'why'],
      },
    },
  },
  required: ['meals'],
};

function parseMeals(text) {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.meals) ? parsed.meals : null;
}

async function proposeMeals(foods, profile, count, preferredFoods, injected) {
  if (!injected && !process.env.GOOGLE_API_KEY) return FALLBACK_MEALS;
  try {
    let ai = injected;
    if (!ai) {
      const { GoogleGenAI } = await import('@google/genai');
      ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    }
    const result = await generateJsonWithFallback({
      ai,
      models: [
        process.env.RENAL_MEALS_MODEL || 'gemini-3.8-flash',
        process.env.RENAL_MEALS_FALLBACK_MODEL || 'gemini-3.5-flash-lite',
      ],
      buildRequest: (model, signal) => ({
        model,
        contents: [
          `Suggest up to ${count} real, recognizable dishes (for example, chicken and rice soup or an egg-white vegetable omelet), not generic ingredient combinations.`,
          `Foods actually seen in the kitchen: ${foods.join(', ')}.`,
          `Prefer ingredients from this built-in renal food list: ${preferredFoods.join(', ')}.`,
          'Use the seen foods as the base of each complete meal. You may request up to three missing food ingredients to make each dish a proper, recognizable meal.',
          'Water, cooking oil, pepper, and ordinary herbs and spices are always available: never list them as missing. Do not list those pantry staples in missing.',
          'Use plain ingredient names in uses and missing. Put each missing item in {name, quantity} form. Do not invent unavailable foods as if they were seen.',
          `Patient daily limits are sodium ${profile.limits.sodiumMg} mg, potassium ${profile.limits.potassiumMg} mg, phosphorus ${profile.limits.phosphorusMg} mg. Avoid: ${(profile.avoid ?? []).join(', ')}.`,
          'Prefer low-sodium preparation without salt substitutes. Return JSON only matching the schema.',
        ].join('\n'),
        config: { responseMimeType: 'application/json', responseSchema: MEAL_SCHEMA, abortSignal: signal },
      }),
      parse: parseMeals,
      totalMs: 5100,
      hedgeMs: 2500,
      label: 'meal suggestions',
    });
    return result.ok ? result.value : FALLBACK_MEALS;
  } catch {
    return FALLBACK_MEALS;
  }
}

function validMeal(meal) {
  return meal && typeof meal.title === 'string' &&
    Array.isArray(meal.uses) && meal.uses.length <= 8 && meal.uses.every((food) => typeof food === 'string') &&
    Array.isArray(meal.missing) && meal.missing.length <= 8 && meal.missing.every((item) =>
      typeof item?.name === 'string' && typeof item?.quantity === 'string') &&
    Number.isInteger(meal.minutes) && meal.minutes > 0 &&
    Array.isArray(meal.steps) && meal.steps.every((step) => typeof step === 'string') &&
    typeof meal.why === 'string';
}

export async function suggestMeals(input = {}, { ai } = {}) {
  const foods = input?.foods ?? [];
  const profile = input?.profile;
  const count = input?.count ?? 2;
  if (!Array.isArray(foods) || !foods.every((food) => typeof food === 'string')) {
    return { ok: false, error: 'foods must be an array of names' };
  }
  if (!profile?.limits || !Array.isArray(profile.avoid)) return { ok: false, error: 'a valid patient profile is required' };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'count must be a positive integer' };

  try {
    const requestedCount = Math.min(count, 5);
    const catalog = await readData('foods.json');
    const available = new Set(foods.map((food) => canonicalFoodName(food, catalog)));
    if (available.size === 0) {
      return {
        ok: true,
        meals: [],
        message: "I couldn't see enough ingredients to suggest a meal. Could you show me the cupboards?",
      };
    }

    const preferredFoods = [...new Set(Object.values(catalog).map((food) => food.name))];
    const proposals = (await proposeMeals(foods, profile, requestedCount, preferredFoods, ai))
      .filter(validMeal)
      .slice(0, requestedCount);

    const checkedMeals = await Promise.all(proposals.map(async (meal) => {
      const usedNames = [...new Set(meal.uses
        .filter((name) => !isPantryStaple(name))
        .map((name) => canonicalFoodName(name, catalog)))];
      const usedAvailableFoods = usedNames.filter((name) => available.has(name));
      if (usedAvailableFoods.length === 0) return null;

      const missingByName = new Map(meal.missing
        .filter((item) => !isPantryStaple(item.name))
        .map((item) => [canonicalFoodName(item.name, catalog), item]));
      for (const name of usedNames) {
        if (!available.has(name) && !missingByName.has(name)) {
          missingByName.set(name, { name, quantity: '1 portion' });
        }
      }
      for (const name of available) missingByName.delete(name);
      const missing = [...missingByName.values()];
      if (missing.length > 3) return null;

      const ingredientsToCheck = [...new Set([...usedNames, ...missing.map((item) =>
        canonicalFoodName(item.name, catalog))])];
      const results = await Promise.all(ingredientsToCheck.map((name) =>
        checkFood({ food: { name }, profile })));
      if (results.some((result) =>
        !result.ok || result.verdict === 'avoid' || result.verdict === 'unknown')) return null;

      const availableUsedNames = new Set(usedAvailableFoods);
      return {
        ...meal,
        uses: meal.uses.filter((name) =>
          isPantryStaple(name) || availableUsedNames.has(canonicalFoodName(name, catalog))),
        missing,
      };
    }));
    const meals = checkedMeals.filter(Boolean);
    if (meals.length === 0) {
      return {
        ok: true,
        meals: [],
        message: "I couldn't find a complete safe meal from what I can see. Could you show me the cupboards?",
      };
    }
    return { ok: true, meals };
  } catch (error) {
    return errorResult(error, 'could not suggest meals');
  }
}
