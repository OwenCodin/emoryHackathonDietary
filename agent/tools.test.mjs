import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network used'); };

let tools, renal, actions, prompt, jpeg, dir;
before(async () => {
  tools = await import('./tools.mjs');
  renal = await import('../renal/index.mjs');
  actions = await import('../actions/index.mjs');
  prompt = await import('./prompt.mjs');
  jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  dir = await mkdtemp(join(tmpdir(), 'tools-test-'));
});
after(async () => {
  globalThis.fetch = originalFetch;
  await rm(dir, { recursive: true, force: true });
});

const camOk = { jpeg: async () => jpeg };
const camOff = { jpeg: async () => null };
const build = (over = {}) => tools.buildTools({ camera: camOk, patientId: 'demo', renal, actions, debugFrameDir: '', timeoutMs: 2000, ...over });
const verdictFor = (food, verdict = 'ok', say = 'Fine today.') => ({ ok: true, food, verdict, say, reasons: [], nutrients: null, portion: 'x', swap: null, source: 'none' });

describe('spokenVerdict', () => {
  it('maps the four verdicts', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'A banana is fine today.' }), 'Yes, a banana is fine today.');
    assert.ok(tools.spokenVerdict({ verdict: 'avoid', say: 'Too salty.' }).startsWith('No, '));
    assert.ok(tools.spokenVerdict({ verdict: 'limit', say: 'Half only.' }).startsWith('Small portion, '));
    assert.ok(tools.spokenVerdict({ verdict: 'unknown', say: 'Not sure.' }).startsWith("I can't tell, "));
    assert.ok(tools.spokenVerdict({ verdict: 'weird', say: 'Hm.' }).startsWith("I can't tell, "));
  });
  it('keeps a leading I and acronyms', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'limit', say: 'I would keep it small.' }), 'Small portion, I would keep it small.');
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'USDA says fine.' }), 'Yes, USDA says fine.');
  });
  it('keeps two sentences, handles empty say, caps length', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'One. Two! Three?' }), 'Yes, one. Two!');
    assert.equal(tools.spokenVerdict({ verdict: 'avoid', say: '' }), 'No.');
    assert.equal(tools.spokenVerdict({ verdict: 'avoid' }), 'No.');
    assert.ok(tools.spokenVerdict({ verdict: 'ok', say: 'word '.repeat(200) }).length <= 240);
  });
});

describe('buildTools shape', () => {
  it('has the eight tools, anonymous', () => {
    const t = build();
    assert.deepEqual(Object.keys(t), ['look_at_camera', 'check_food', 'suggest_meal', 'log_meal', 'todays_totals', 'start_cart', 'cart_status', 'text_cart_link']);
    for (const tool of Object.values(t)) assert.ok(!Object.hasOwn(tool, 'name'));
  });
});

describe('check_food', () => {
  it('works against the stub', async () => {
    const r = await build().check_food.execute({ name: 'banana', grams: 118 });
    assert.equal(r.ok, true);
    assert.equal(r.food, 'banana');
    assert.equal(r.verdict, 'unknown');
    assert.ok(r.spoken.startsWith("I can't tell"));
    assert.equal(r.swap, null);
  });
});

describe('look_at_camera', () => {
  it('says no_camera_picture without a picture and never calls describeImage', async () => {
    let called = 0;
    const t = build({ camera: camOff, renal: { ...renal, describeImage: async () => { called++; return {}; } } });
    const r = await t.look_at_camera.execute({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no_camera_picture');
    assert.match(r.say, /camera/);
    assert.equal(called, 0);
  });
  it('same without any camera object', async () => {
    const r = await tools.buildTools({ patientId: 'demo', renal, actions, debugFrameDir: '' }).look_at_camera.execute({});
    assert.equal(r.error, 'no_camera_picture');
  });
  it('runs camera, describeImage and checkFood on the stubs', async () => {
    const r = await build().look_at_camera.execute({});
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'plate');
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0].food, 'banana');
    assert.equal(r.results[0].verdict, 'unknown');
    assert.ok(r.results[0].spoken);
    assert.equal(r.results[0].swap, null);
  });
  it('unclear and failed pictures give unclear_picture', async () => {
    for (const seen of [{ ok: true, kind: 'unclear', foods: [], label: null }, { ok: false, error: 'x' }]) {
      const r = await build({ renal: { ...renal, describeImage: async () => seen } }).look_at_camera.execute({});
      assert.equal(r.ok, false);
      assert.equal(r.error, 'unclear_picture');
      assert.match(r.say, /closer/);
    }
  });
  it('judges the label product once', async () => {
    const calls = [];
    const label = { product: 'Chicken broth', sodiumMg: 860 };
    const t = build({ renal: { ...renal,
      describeImage: async () => ({ ok: true, kind: 'label', foods: [], label }),
      checkFood: async a => { calls.push(a); return verdictFor(a.food.name, 'avoid', 'Very salty.'); } } });
    const r = await t.look_at_camera.execute({});
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].food, { name: 'Chicken broth', label });
    assert.equal(r.results[0].spoken, 'No, very salty.');
  });
  it('judges at most 6 foods', async () => {
    let n = 0;
    const foods = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, grams: null }));
    const t = build({ renal: { ...renal,
      describeImage: async () => ({ ok: true, kind: 'fridge', foods, label: null }),
      checkFood: async a => { n++; return verdictFor(a.food.name); } } });
    const r = await t.look_at_camera.execute({});
    assert.equal(n, 6);
    assert.equal(r.results.length, 6);
  });
  it('a failing checkFood for one food still speaks for it', async () => {
    const t = build({ renal: { ...renal,
      describeImage: async () => ({ ok: true, kind: 'plate', foods: [{ name: 'a' }, { name: 'b' }], label: null }),
      checkFood: async a => (a.food.name === 'a' ? { ok: false, error: 'bad' } : verdictFor('b')) } });
    const r = await t.look_at_camera.execute({});
    assert.equal(r.ok, true);
    assert.match(r.results[0].spoken, /^I can't tell/);
  });
});

describe('guarding', () => {
  it('a module returning ok:false with a url becomes our own error', async () => {
    const bad = { ...renal,
      getProfile: async () => ({ ok: false, error: 'https://x.test/?token=SECRET123' }),
      checkFood: async () => ({ ok: false, error: 'https://x.test/?token=SECRET123' }) };
    for (const r of [await build({ renal: bad }).check_food.execute({ name: 'a', grams: null }), await build({ renal: bad }).look_at_camera.execute({})]) {
      assert.equal(r.ok, false);
      assert.ok(r.say.length > 0);
      const j = JSON.stringify(r);
      for (const w of ['SECRET123', 'http', 'boom', 'stack']) assert.ok(!j.includes(w), w);
    }
  });
  it('a throwing module becomes tool_failed', async () => {
    const bad = { ...renal, checkFood: async () => { throw new Error('boom SECRET123'); } };
    const r = await build({ renal: bad }).check_food.execute({ name: 'a', grams: null });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'tool_failed');
    const j = JSON.stringify(r);
    for (const w of ['SECRET123', 'http', 'boom', 'stack']) assert.ok(!j.includes(w), w);
  });
  it('a long say still fits 600 characters', async () => {
    const t = build({ renal: { ...renal, checkFood: async a => verdictFor(a.food.name, 'ok', 'Long sentence here. '.repeat(150)) } });
    const r = await t.check_food.execute({ name: 'a', grams: null });
    assert.ok(JSON.stringify(r).length <= 600);
  });
  it('a module that never resolves times out', async () => {
    const t = build({ timeoutMs: 50, renal: { ...renal, checkFood: () => new Promise(() => {}) } });
    const r = await t.check_food.execute({ name: 'a', grams: null });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'timeout');
  });
});

describe('debug frames', () => {
  it('writes one frame when a folder is set, none when empty', async () => {
    await build({ debugFrameDir: dir }).look_at_camera.execute({});
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /^frame-\d+\.jpg$/);
    const other = await mkdtemp(join(tmpdir(), 'tools-test-empty-'));
    await build({ debugFrameDir: '' }).look_at_camera.execute({});
    assert.equal((await readdir(other)).length, 0);
    await rm(other, { recursive: true, force: true });
  });
});

const PHONE = '+15551234567';
const rec = (obj, name, impl) => { const calls = []; return { mod: { ...obj, [name]: async a => { calls.push(a); return impl ? impl(a) : obj[name](a); } }, calls }; };
const bad = { ok: false, error: 'https://x.test/?token=SECRET123' };
const clean = r => { assert.equal(r.ok, false); assert.ok(r.say.length > 0); const j = JSON.stringify(r); for (const w of ['SECRET123', 'http', 'boom']) assert.ok(!j.includes(w), w); };

describe('suggest_meal', () => {
  it('refuses before any look', async () => {
    const { mod, calls } = rec(renal, 'suggestMeals');
    const r = await build({ renal: mod }).suggest_meal.execute({});
    assert.equal(r.error, 'nothing_seen');
    assert.match(r.say, /fridge/);
    assert.equal(calls.length, 0);
  });
  it('suggests after a look', async () => {
    const { mod, calls } = rec(renal, 'suggestMeals');
    const t = build({ renal: mod });
    await t.look_at_camera.execute({});
    const r = await t.suggest_meal.execute({});
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].foods, ['banana']);
    assert.equal(calls[0].count, 2);
    assert.equal(calls[0].profile.name, 'Sam');
    assert.equal(r.ok, true);
    assert.equal(r.meals.length, 2);
    assert.equal(r.meals[0].title, 'Rice with herbed chicken');
    assert.deepEqual(r.meals[0].missing, ['unsalted chicken broth']);
    assert.ok(r.meals[0].steps.length <= 3);
    assert.equal(r.meals[1].steps, undefined);
  });
});

describe('log_meal and todays_totals', () => {
  it('log_meal needs something to log', async () => {
    const r = await build().log_meal.execute({});
    assert.equal(r.error, 'nothing_to_log');
  });
  it('logs once, never twice', async () => {
    const { mod, calls } = rec(renal, 'logFood');
    const t = build({ renal: mod });
    await t.check_food.execute({ name: 'banana', grams: null });
    const r = await t.log_meal.execute({});
    assert.deepEqual(r, { ok: true, logged: ['banana'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].patientId, 'demo');
    assert.equal(calls[0].verdict.food, 'banana');
    assert.equal((await t.log_meal.execute({})).error, 'nothing_to_log');
    assert.equal(calls.length, 1);
  });
  it('a failed log keeps the verdicts for a retry', async () => {
    let fail = true;
    const { mod } = rec(renal, 'logFood', () => (fail ? bad : { ok: true }));
    const t = build({ renal: mod });
    await t.check_food.execute({ name: 'banana', grams: null });
    clean(await t.log_meal.execute({}));
    fail = false;
    assert.equal((await t.log_meal.execute({})).ok, true);
  });
  it('todays_totals returns only the three numbers each', async () => {
    const r = await build().todays_totals.execute({});
    assert.deepEqual(r, { ok: true,
      totals: { sodiumMg: 1, potassiumMg: 422, phosphorusMg: 26 },
      remaining: { sodiumMg: 1999, potassiumMg: 1578, phosphorusMg: 974 } });
  });
});

describe('cart tools', () => {
  it('start_cart with nothing to buy', async () => {
    const { mod, calls } = rec(actions, 'startCart');
    const r = await build({ actions: mod }).start_cart.execute({ items: [] });
    assert.equal(r.error, 'nothing_to_buy');
    assert.equal(calls.length, 0);
  });
  it('start_cart uses the remembered missing items, deduplicated', async () => {
    const { mod, calls } = rec(actions, 'startCart');
    const t = build({ actions: mod });
    await t.look_at_camera.execute({});
    await t.suggest_meal.execute({});
    const r = await t.start_cart.execute({ items: [] });
    assert.deepEqual(calls[0].items, [{ name: 'unsalted chicken broth', quantity: '1 carton' }]);
    assert.deepEqual(r, { ok: true, started: true, items: ['unsalted chicken broth'] });
  });
  it('start_cart trims and caps explicit items', async () => {
    const { mod, calls } = rec(actions, 'startCart');
    const items = Array.from({ length: 15 }, (_, i) => ({ name: ` ${'n'.repeat(100)}${i} `, quantity: 'q'.repeat(100) }));
    items.push({ name: '  ', quantity: '1' });
    await build({ actions: mod }).start_cart.execute({ items });
    assert.equal(calls[0].items.length, 12);
    assert.equal(calls[0].items[0].name.length, 80);
    assert.equal(calls[0].items[0].quantity.length, 80);
  });
  it('start_cart busy', async () => {
    const { mod } = rec(actions, 'startCart', () => ({ ok: false, error: 'busy' }));
    const r = await build({ actions: mod }).start_cart.execute({ items: [{ name: 'rice', quantity: '1' }] });
    assert.equal(r.error, 'cart_busy');
    assert.match(r.say, /how it's going/);
  });
  it('cart_status hides the link', async () => {
    const r = await build().cart_status.execute({});
    assert.deepEqual(r, { ok: true, state: 'done', step: 'cart filled', added: ['unsalted chicken broth'], missing: [], total: 3.49 });
    const j = JSON.stringify(r);
    assert.ok(!j.includes('http') && !j.includes('cartUrl'));
  });
  it('text_cart_link sends to the configured phone only', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    const r = await build({ actions: mod, phone: PHONE }).text_cart_link.execute({});
    assert.deepEqual(r, { ok: true, sent: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phone, PHONE);
    assert.ok(calls[0].text.includes('https://example.com/cart'));
    assert.ok(!JSON.stringify(r).includes('1555'));
  });
  it('text_cart_link without a phone or a link', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    for (const phone of ['', 'YOUR_PATIENT_PHONE', undefined]) {
      const r = await build({ actions: mod, phone }).text_cart_link.execute({});
      assert.equal(r.error, 'no_phone');
    }
    assert.equal(calls.length, 0);
    const noUrl = { ...actions, getCartStatus: async () => ({ ok: true, state: 'running', added: [], missing: [], total: 0, cartUrl: null }) };
    assert.equal((await build({ actions: noUrl, phone: PHONE }).text_cart_link.execute({})).error, 'no_cart_link');
  });
});

describe('guarding the new tools', () => {
  const cases = {
    suggest_meal: { prep: t => t.look_at_camera.execute({}), mod: 'renal', fns: ['suggestMeals'] },
    log_meal: { prep: t => t.check_food.execute({ name: 'a', grams: null }), mod: 'renal', fns: ['logFood'] },
    todays_totals: { mod: 'renal', fns: ['getToday'] },
    start_cart: { args: { items: [{ name: 'rice', quantity: '1' }] }, mod: 'actions', fns: ['startCart'] },
    cart_status: { mod: 'actions', fns: ['getCartStatus'] },
    text_cart_link: { mod: 'actions', fns: ['getCartStatus', 'sendText'] },
  };
  for (const [name, c] of Object.entries(cases)) {
    for (const fn of c.fns) {
      for (const [label, impl] of [['ok:false', async () => bad], ['throws', async () => { throw new Error('boom SECRET123'); }]]) {
        it(`${name}: ${fn} ${label}`, async () => {
          const base = c.mod === 'renal' ? renal : actions;
          const over = { [c.mod]: { ...base, [fn]: impl }, phone: PHONE };
          const t = build(over);
          if (c.prep) await c.prep(t);
          clean(await t[name].execute(c.args ?? {}));
        });
      }
    }
  }
});

describe('prompt', () => {
  it('names the tools and the rules, drops Phase 2 wording', () => {
    const text = prompt.instructions;
    for (const k of Object.keys(build())) assert.ok(text.includes(k), k);
    for (const w of ['spoken', 'say', 'pay', 'no_camera_picture', 'link']) assert.ok(text.includes(w), w);
    for (const w of ['camera yet', 'never claim to see food', 'could not check it']) assert.ok(!text.includes(w), w);
  });
});
