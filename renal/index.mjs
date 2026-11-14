// STUB with canned data. Track B replaces this with the real module and keeps the same exports.
// Every function is async, takes one object (default {}), never throws and uses no network.

const LIMITS = { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 };

export async function getProfile({ patientId } = {}) {
  return {
    ok: true,
    profile: {
      id: patientId || 'demo',
      name: 'Sam',
      limits: { ...LIMITS },
      avoid: ['star fruit', 'salt substitute'],
      setBy: 'care team',
    },
  };
}

export async function describeImage({ jpeg } = {}) {
  return { ok: true, kind: 'plate', foods: [{ name: 'banana', grams: 118 }], label: null };
}

export async function checkFood({ food, profile } = {}) {
  return {
    ok: true,
    food: (food && food.name) || 'unknown food',
    verdict: 'limit',
    say: 'A banana has about 420 milligrams of potassium, a fifth of your day. Half is fine.',
    reasons: ['potassium 422 mg is 21% of the 2000 mg daily limit'],
    nutrients: { sodiumMg: 1, potassiumMg: 422, phosphorusMg: 26 },
    portion: '1 medium (118 g)',
    swap: 'an apple',
    source: 'rule',
  };
}

export async function suggestMeals({ foods, profile, count } = {}) {
  const meal = {
    title: 'Rice with herbed chicken',
    uses: ['rice', 'chicken'],
    missing: [{ name: 'unsalted chicken broth', quantity: '1 carton' }],
    minutes: 25,
    steps: ['Cook the rice in unsalted broth.', 'Pan-cook the chicken with herbs.', 'Serve together.'],
    why: 'Low in sodium and potassium, with a modest phosphorus load.',
  };
  const n = Math.max(1, Number.isInteger(count) ? count : 1);
  return { ok: true, meals: Array.from({ length: n }, () => ({ ...meal })) };
}

export async function logFood({ patientId, verdict } = {}) {
  return { ok: true };
}

export async function getToday({ patientId } = {}) {
  const totals = { sodiumMg: 1, potassiumMg: 422, phosphorusMg: 26 };
  return {
    ok: true,
    totals,
    remaining: {
      sodiumMg: LIMITS.sodiumMg - totals.sodiumMg,
      potassiumMg: LIMITS.potassiumMg - totals.potassiumMg,
      phosphorusMg: LIMITS.phosphorusMg - totals.phosphorusMg,
    },
    items: [{ food: 'banana', portion: '1 medium (118 g)' }],
  };
}
