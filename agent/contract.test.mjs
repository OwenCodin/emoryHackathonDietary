import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

// No stub may touch the network. Replace fetch BEFORE the modules load.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('network used by a stub');
};

let video, renal, actions, tools;

before(async () => {
  video = await import('../shared/video.mjs');
  renal = await import('../renal/index.mjs');
  actions = await import('../actions/index.mjs');
  tools = await import('./tools.mjs');
});
after(() => {
  globalThis.fetch = originalFetch;
});

const isStr = v => typeof v === 'string';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isNutrients = n =>
  n && isNum(n.sodiumMg) && isNum(n.potassiumMg) && isNum(n.phosphorusMg);
const isVerdict = v =>
  v.ok === true &&
  isStr(v.food) &&
  ['ok', 'limit', 'avoid', 'unknown'].includes(v.verdict) &&
  isStr(v.say) && v.say.length > 0 &&
  Array.isArray(v.reasons) && v.reasons.every(isStr) &&
  (v.nutrients === null || isNutrients(v.nutrients)) &&
  isStr(v.portion) &&
  (v.swap === null || isStr(v.swap)) &&
  ['label', 'usda', 'rule', 'none'].includes(v.source);

describe('shared/video.mjs', () => {
  it('defines the video size and rate', () => {
    assert.equal(video.WIDTH, 1280);
    assert.equal(video.HEIGHT, 720);
    assert.equal(video.FPS, 15);
  });
});

describe('renal stub', () => {
  let profile;
  before(async () => {
    profile = (await renal.getProfile({ patientId: 'demo' })).profile;
  });

  it('getProfile returns a Profile', () => {
    assert.ok(isStr(profile.id) && isStr(profile.name));
    for (const k of ['sodiumMg', 'potassiumMg', 'phosphorusMg', 'fluidMl']) assert.ok(isNum(profile.limits[k]));
    assert.ok(Array.isArray(profile.avoid));
    assert.equal(profile.setBy, 'care team');
  });

  it('describeImage returns a Seen', async () => {
    const seen = await renal.describeImage({ jpeg: Buffer.alloc(4) });
    assert.equal(seen.ok, true);
    assert.ok(['label', 'plate', 'fridge', 'shelf', 'unclear'].includes(seen.kind));
    assert.ok(Array.isArray(seen.foods));
    for (const f of seen.foods) assert.ok(isStr(f.name) && (f.grams === null || isNum(f.grams)));
    assert.ok(seen.label === null || isStr(seen.label.product));
  });

  it('checkFood returns a Verdict', async () => {
    const v = await renal.checkFood({ food: { name: 'banana', grams: 118 }, profile });
    assert.ok(isVerdict(v));
    assert.equal(v.food, 'banana');
  });

  it('suggestMeals returns meals', async () => {
    const r = await renal.suggestMeals({ foods: ['rice'], profile, count: 2 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.meals) && r.meals.length > 0);
    for (const m of r.meals) {
      assert.ok(isStr(m.title) && isNum(m.minutes) && isStr(m.why));
      assert.ok(Array.isArray(m.uses) && m.uses.every(isStr));
      assert.ok(Array.isArray(m.steps) && m.steps.every(isStr));
      assert.ok(Array.isArray(m.missing));
      for (const c of m.missing) assert.ok(isStr(c.name) && isStr(c.quantity));
    }
  });

  it('logFood and getToday return their shapes', async () => {
    const verdict = await renal.checkFood({ food: { name: 'banana' }, profile });
    assert.deepEqual(await renal.logFood({ patientId: 'demo', verdict }), { ok: true });
    const t = await renal.getToday({ patientId: 'demo' });
    assert.equal(t.ok, true);
    assert.ok(isNutrients(t.totals) && isNutrients(t.remaining));
    assert.ok(Array.isArray(t.items));
  });

  it('every function returns a Promise resolving ok: true, with or without an argument', async () => {
    for (const name of ['getProfile', 'describeImage', 'checkFood', 'suggestMeals', 'logFood', 'getToday']) {
      const p = renal[name]();
      assert.ok(p instanceof Promise, `${name} returns a Promise`);
      assert.equal((await p).ok, true, `${name}() ok`);
    }
  });
});

describe('actions stub', () => {
  it('getCartFrame is synchronous and returns null', () => {
    const r = actions.getCartFrame();
    assert.ok(!(r instanceof Promise));
    assert.strictEqual(r, null);
  });

  it('getCartStatus returns a status', async () => {
    const s = await actions.getCartStatus();
    assert.equal(s.ok, true);
    assert.ok(['idle', 'running', 'waiting_for_patient', 'done', 'failed'].includes(s.state));
    assert.ok(isStr(s.step));
    assert.ok(Array.isArray(s.added));
    for (const a of s.added) assert.ok(isStr(a.name) && isNum(a.price));
    assert.ok(Array.isArray(s.missing) && s.missing.every(isStr));
    assert.ok(isNum(s.total));
    assert.ok(s.cartUrl === null || isStr(s.cartUrl));
  });

  it('startCart, stopCart, sendText, callPatient return ok', async () => {
    assert.equal((await actions.startCart({ items: [{ name: 'broth', quantity: '1' }] })).ok, true);
    assert.equal((await actions.stopCart()).ok, true);
    assert.equal((await actions.sendText({ phone: '+15551234567', text: 'hi' })).ok, true);
    const c = await actions.callPatient({ phone: '+15551234567', reason: 'dinner' });
    assert.equal(c.ok, true);
    assert.ok(isStr(c.callId));
  });

  it('every async function returns a Promise resolving ok: true, with or without an argument', async () => {
    for (const name of ['startCart', 'getCartStatus', 'stopCart', 'callPatient', 'sendText']) {
      const p = actions[name]();
      assert.ok(p instanceof Promise, `${name} returns a Promise`);
      assert.equal((await p).ok, true, `${name}() ok`);
    }
  });
});

describe('agent/tools.mjs', () => {
  it('exposes one anonymous check_food tool that runs offline', async () => {
    const t = tools.buildTools({ patientId: 'demo' });
    assert.deepEqual(Object.keys(t), ['check_food']);
    assert.ok(!Object.hasOwn(t.check_food, 'name'));
    const v = await t.check_food.execute({ name: 'banana', grams: 118 });
    assert.ok(isVerdict(v));
    assert.equal(v.food, 'banana');
  });
});
