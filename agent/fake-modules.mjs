// Test fixtures, NOT the real modules: deterministic in-test fakes of renal/ and actions/
// (the original stub shapes). They use no network and no files. The real modules are
// checked by renal/*.test.mjs and agent/contract.test.mjs.

const LIMITS = { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000, fluidMl: 1000 };

export function makeFakeRenal({ scenes } = {}) {
  let sceneIndex = 0;
  const saved = new Map(); // in-memory saved profiles, by patient id
  return {
    // Saved-profile functions: same shapes as renal/profile.mjs, but in memory and without validation
    // (the real bounds are tested in renal/profile.test.mjs). Override saveProfile in a test to make it fail.
    async getSavedProfile({ patientId } = {}) {
      const s = saved.get(patientId || 'demo');
      return { ok: true, saved: s ? JSON.parse(JSON.stringify(s)) : null };
    },
    async saveProfile({ patientId, profile } = {}) {
      const s = { id: patientId || 'demo', ...JSON.parse(JSON.stringify(profile)), setBy: 'patient, as told by their care team', setOn: '2026-11-14' };
      saved.set(s.id, s);
      return { ok: true, saved: s };
    },
    async resetProfile({ patientId } = {}) {
      return { ok: true, removed: saved.delete(patientId || 'demo') };
    },
    async getProfile({ patientId } = {}) {
      const s = saved.get(patientId || 'demo');
      if (s) {
        if (!s.limits) return { ok: false, error: 'limits not set', limitsNeeded: true };
        return { ok: true, profile: { ...s, name: s.name ?? '', limits: { ...s.limits }, source: 'patient' } };
      }
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
    // Deterministic ham sandwich, as the real module would return after re-checking each ingredient.
    async dishIngredients({ dish, profile } = {}) {
      const row = (name, quantity, verdict, swap, nutrients) => ({
        name, quantity, verdict, swap, nutrients, portion: nutrients ? '1 portion' : null, say: null,
        source: nutrients ? 'usda' : 'none', checked: nutrients !== null,
      });
      return {
        ok: true,
        dish: String(dish ?? ''),
        source: 'builtin',
        ingredients: [
          row('white bread', '2 slices', 'ok', null, { sodiumMg: 490, potassiumMg: 115, phosphorusMg: 98 }),
          row('ham', '3 slices', 'avoid', 'fresh unsalted chicken', { sodiumMg: 1200, potassiumMg: 240, phosphorusMg: 210 }),
          row('lettuce', '1 leaf', 'ok', null, { sodiumMg: 10, potassiumMg: 141, phosphorusMg: 20 }),
          row('mayonnaise', '1 tablespoon', 'unknown', null, null),
        ],
      };
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
    async previewCart({ items } = {}) {
      return { ok: true, shown: Array.isArray(items) && items.length > 0, found: Array.isArray(items) ? items.length : 0, notFound: 0, total: 0 };
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
    async sendText({ phone, text, allow } = {}) {
      return { ok: true };
    },
    async hasRecentInboundText({ phone } = {}) {
      return { ok: true, texted: true };
    },
    async getCallerPhone({ callId } = {}) {
      return { ok: false, error: 'not_configured' };
    },
    async getKrogerStatus() {
      return { ok: true, configured: false, relay: false, connected: false, pending: false };
    },
    async startKrogerSignIn() {
      return { ok: true, link: 'https://relay.example/k/' + 'A'.repeat(43) };
    },
  };
}
