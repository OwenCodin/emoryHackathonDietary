// Test fixtures, NOT the real modules: deterministic in-test fakes of renal/ and actions/
// (the original stub shapes). They use no network and no files. The real modules are
// checked by renal/*.test.mjs and agent/contract.test.mjs.

const LIMITS = { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 };

export function makeFakeRenal({ scenes } = {}) {
  let sceneIndex = 0;
  return {
    async getProfile({ patientId } = {}) {
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
    },
    async describeImage({ jpeg } = {}) {
      if (Array.isArray(scenes) && scenes.length > 0) return scenes[Math.min(sceneIndex++, scenes.length - 1)];
      return { ok: true, kind: 'plate', foods: [{ name: 'banana', grams: 118 }], label: null };
    },
    async checkFood({ food, profile } = {}) {
      return {
        ok: true,
        food: (food && food.name) || 'unknown food',
        verdict: 'unknown',
        say: 'This is placeholder test data. The real food check is not connected yet, so I cannot judge that food.',
        reasons: ['fake: deterministic test data'],
        nutrients: null,
        portion: 'unknown',
        swap: null,
        source: 'none',
      };
    },
    async suggestMeals({ foods, profile, count } = {}) {
      const meal = {
        title: 'Rice with herbed chicken',
        uses: ['rice', 'chicken'],
        missing: [{ name: 'unsalted chicken broth', quantity: '1 carton' }],
        minutes: 25,
        steps: ['Cook the rice in unsalted broth.', 'Pan-cook the chicken with herbs.', 'Serve together.'],
        why: 'Low in sodium and potassium, with a modest phosphorus load.',
      };
      const n = Math.min(5, Math.max(1, Number.isInteger(count) ? count : 1));
      return { ok: true, meals: Array.from({ length: n }, () => ({ ...meal })) };
    },
    async logFood({ patientId, verdict } = {}) {
      return { ok: true };
    },
    async getToday({ patientId } = {}) {
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
    },
  };
}

export function makeFakeActions() {
  return {
    async startCart({ items } = {}) {
      return { ok: true };
    },
    async getCartStatus() {
      return {
        ok: true,
        state: 'done',
        step: 'cart filled',
        added: [{ name: 'unsalted chicken broth', price: 3.49 }],
        missing: [],
        total: 3.49,
        cartUrl: 'https://example.com/cart',
      };
    },
    getCartFrame() {
      return null;
    },
    async stopCart() {
      return { ok: true };
    },
    async callPatient({ phone, reason } = {}) {
      return { ok: true, callId: 'stub-call-1' };
    },
    async sendText({ phone, text } = {}) {
      return { ok: true };
    },
  };
}
