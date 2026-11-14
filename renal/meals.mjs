import { checkFood } from './check.mjs';
import { errorResult, normalizeFoodName } from './data.mjs';
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

const FOOD_ALIASES = new Map([
  ['chicken', 'unsalted chicken'],
  ['chicken breast', 'unsalted chicken'],
  ['rice', 'white rice'],
  ['eggs', 'egg'],
  ['egg whites', 'egg white'],
]);

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

async function proposeMeals(foods, profile, count, injected) {
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
        contents: `Suggest up to ${count} simple kidney-friendly meals using available foods: ${foods.join(', ') || 'none listed'}. Patient daily limits are sodium ${profile.limits.sodiumMg} mg, potassium ${profile.limits.potassiumMg} mg, phosphorus ${profile.limits.phosphorusMg} mg. Avoid: ${(profile.avoid ?? []).join(', ')}. Prefer low-sodium preparation. Return JSON only.`,
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
    Array.isArray(meal.uses) && meal.uses.every((food) => typeof food === 'string') &&
    Array.isArray(meal.missing) && meal.missing.every((item) =>
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
    const available = new Set(foods.map((food) =>
      FOOD_ALIASES.get(normalizeFoodName(food)) ?? normalizeFoodName(food)));
    const proposals = await proposeMeals(foods, profile, requestedCount, ai);
    const meals = [];
    for (const meal of proposals) {
      if (!validMeal(meal)) continue;
      if (available.size && !meal.uses.some((food) => {
        const normalized = normalizeFoodName(food);
        return available.has(normalized) || available.has(FOOD_ALIASES.get(normalized));
      })) continue;
      let safe = true;
      for (const name of meal.uses) {
        const result = await checkFood({ food: { name }, profile });
        if (!result.ok || result.verdict === 'avoid' || result.verdict === 'unknown') {
          safe = false;
          break;
        }
      }
      if (safe) meals.push(meal);
      if (meals.length >= requestedCount) break;
    }
    return { ok: true, meals };
  } catch (error) {
    return errorResult(error, 'could not suggest meals');
  }
}
