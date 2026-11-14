import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { makeFakeActions, makeFakeRenal } from './fake-modules.mjs';

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('network used'); };

let tools, renal, actions, prompt, jpeg, dir;
before(async () => {
  tools = await import('./tools.mjs');
  renal = makeFakeRenal();
  actions = makeFakeActions();
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
    assert.deepEqual(Object.keys(t), ['look_at_camera', 'check_food', 'suggest_meal', 'log_meal', 'todays_totals', 'start_cart', 'cart_status', 'text_cart_link', 'add_to_shopping_list', 'shopping_list', 'mark_item', 'pantry_list', 'remove_from_pantry', 'clear_pantry', 'text_recipe']);
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
    assert.equal(r.results[0].swap, undefined);
  });
  it('a failed describeImage gives vision_failed', async () => {
    const r = await build({ renal: { ...renal, describeImage: async () => ({ ok: false, error: 'x' }) } }).look_at_camera.execute({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'vision_failed');
    assert.match(r.say, /still/);
  });
  it('an unclear picture gives unclear_picture', async () => {
    const r = await build({ renal: { ...renal, describeImage: async () => ({ ok: true, kind: 'unclear', foods: [], label: null }) } }).look_at_camera.execute({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'unclear_picture');
    assert.match(r.say, /closer/);
  });
  it('a clear picture with no named foods gives no_food_seen', async () => {
    const r = await build({ renal: { ...renal, describeImage: async () => ({ ok: true, kind: 'plate', foods: [], label: null }) } }).look_at_camera.execute({});
    assert.equal(r.ok, false);
    assert.equal(r.error, 'no_food_seen');
    assert.match(r.say, /food/);
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
    // look_at_camera is no longer a dead end: it returns ok:true with unjudged rows (see the unjudged tests).
    const look = await build({ renal: bad }).look_at_camera.execute({});
    assert.equal(look.ok, true);
    assert.equal(look.unjudged, true);
    for (const r of [await build({ renal: bad }).check_food.execute({ name: 'a', grams: null }), look]) {
      assert.ok(r.say.length > 0);
      if (r !== look) assert.equal(r.ok, false);
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
    assert.match(files[0], /^frame-\d+-[0-9a-f]{8}\.jpg$/);
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
    const r = await build().log_meal.execute({ foods: ['banana'] });
    assert.equal(r.error, 'nothing_to_log');
  });
  it('logs once, never twice', async () => {
    const { mod, calls } = rec(renal, 'logFood');
    const t = build({ renal: mod });
    await t.check_food.execute({ name: 'banana', grams: null });
    const r = await t.log_meal.execute({ foods: ['banana'] });
    assert.deepEqual(r, { ok: true, logged: ['banana'] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].patientId, 'demo');
    assert.equal(calls[0].verdict.food, 'banana');
    assert.equal((await t.log_meal.execute({ foods: ['banana'] })).error, 'nothing_to_log');
    assert.equal(calls.length, 1);
  });
  it('a failed log keeps the verdicts for a retry', async () => {
    let fail = true;
    const { mod } = rec(renal, 'logFood', () => (fail ? bad : { ok: true }));
    const t = build({ renal: mod });
    await t.check_food.execute({ name: 'banana', grams: null });
    clean(await t.log_meal.execute({ foods: ['banana'] }));
    fail = false;
    assert.equal((await t.log_meal.execute({ foods: ['banana'] })).ok, true);
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
    assert.deepEqual(r, { ok: true, state: 'done', say: 'The cart is filled and ready for you to review. I can text you the link.', step: 'cart filled', added: ['unsalted chicken broth'], missing: [], total: 3.49 });
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

const oneMealRenal = (meals) => ({ ...renal, suggestMeals: async () => ({ ok: true, meals: meals ?? [{ title: 'Rice with herbed chicken', uses: ['rice'], missing: [{ name: 'broth', quantity: '1 carton' }], minutes: 25, steps: ['Cook.', 'Serve.'], why: 'Gentle on sodium.' }] }) });

describe('guarding the new tools', () => {
  const cases = {
    suggest_meal: { prep: t => t.look_at_camera.execute({}), mod: 'renal', fns: ['suggestMeals'] },
    log_meal: { prep: t => t.check_food.execute({ name: 'a', grams: null }), args: { foods: ['a'] }, mod: 'renal', fns: ['logFood'] },
    todays_totals: { mod: 'renal', fns: ['getToday'] },
    start_cart: { args: { items: [{ name: 'rice', quantity: '1' }] }, mod: 'actions', fns: ['startCart'] },
    cart_status: { mod: 'actions', fns: ['getCartStatus'] },
    text_cart_link: { mod: 'actions', fns: ['getCartStatus', 'sendText'] },
    text_recipe: { prep: async t => { await t.look_at_camera.execute({}); await t.suggest_meal.execute({}); }, mod: 'actions', fns: ['sendText'], renalOne: true },
  };
  for (const [name, c] of Object.entries(cases)) {
    for (const fn of c.fns) {
      for (const [label, impl] of [['ok:false', async () => bad], ['throws', async () => { throw new Error('boom SECRET123'); }]]) {
        it(`${name}: ${fn} ${label}`, async () => {
          const base = c.mod === 'renal' ? renal : actions;
          const over = { [c.mod]: { ...base, [fn]: impl }, phone: PHONE };
          if (c.renalOne) over.renal = oneMealRenal();
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

// ---- review fixes (CR-01, WR-01 to WR-08, IN-01) ----
const manyFoods = (n, say = 'Some words about it that make the sentence fairly long indeed. And a second sentence.') =>
  tools_ => ({ ...renal,
    describeImage: async () => ({ ok: true, kind: 'fridge', foods: Array.from({ length: n }, (_, i) => ({ name: `food${i}`, grams: null })), label: null }),
    checkFood: async a => verdictFor(a.food.name, a.food.name === 'food4' ? 'avoid' : 'ok', say) });

describe('CR-01 look_at_camera never hides a food', () => {
  it('puts avoid first and keeps every food that was judged', async () => {
    const r = await build({ renal: manyFoods(6)() }).look_at_camera.execute({});
    assert.equal(r.ok, true);
    assert.equal(r.results[0].food, 'food4');
    assert.equal(r.results[0].verdict, 'avoid');
    assert.equal(r.results.length + (r.omitted ?? 0), 6);
    assert.ok(JSON.stringify(r).length <= 900);
  });
  it('orders avoid, limit, unknown, ok', async () => {
    const order = { a: 'ok', b: 'unknown', c: 'limit', d: 'avoid' };
    const t = build({ renal: { ...renal,
      describeImage: async () => ({ ok: true, kind: 'plate', foods: ['a', 'b', 'c', 'd'].map(name => ({ name })), label: null }),
      checkFood: async a => verdictFor(a.food.name, order[a.food.name]) } });
    const r = await t.look_at_camera.execute({});
    assert.deepEqual(r.results.map(x => x.verdict), ['avoid', 'limit', 'unknown', 'ok']);
  });
  it('says so when foods beyond six were not judged', async () => {
    const r = await build({ renal: manyFoods(9)() }).look_at_camera.execute({});
    assert.equal(r.results.length, 6);
    assert.equal(r.omitted, 3);
    assert.match(r.say, /show me the rest/i);
  });
  it('long realistic text still gives a result with the avoid food, not a failure', async () => {
    const long = 'This food has a lot of potassium for one sitting, so please be careful with the portion today. '.repeat(4);
    const r = await build({ renal: manyFoods(6, long)() }).look_at_camera.execute({});
    assert.equal(r.ok, true);
    assert.ok(r.results.some(x => x.verdict === 'avoid'));
    assert.equal(r.results.length + (r.omitted ?? 0), 6);
  });
});

describe('WR-01 and WR-08 missing data and cart state', () => {
  it('todays_totals without numbers is a failure', async () => {
    for (const bad of [{ ok: true }, { ok: true, totals: { sodiumMg: 1, potassiumMg: '2', phosphorusMg: 3 }, remaining: { sodiumMg: 1, potassiumMg: 2, phosphorusMg: 3 } }, { ok: true, totals: { sodiumMg: NaN, potassiumMg: 1, phosphorusMg: 1 }, remaining: {} }]) {
      const r = await build({ renal: { ...renal, getToday: async () => bad } }).todays_totals.execute({});
      assert.equal(r.ok, false);
      assert.ok(r.say);
    }
  });
  it('a failed cart is not ok and has a say', async () => {
    const failed = { ...actions, getCartStatus: async () => ({ ok: true, state: 'failed', step: 'https://x.test/?t=SECRET', added: [], missing: [] }) };
    const r = await build({ actions: failed }).cart_status.execute({});
    assert.equal(r.ok, false);
    assert.ok(r.say.length > 0);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  });
  it('cart_status strips links from step, caps text and omits a bad total', async () => {
    const odd = { ...actions, getCartStatus: async () => ({ ok: true, state: 'running', step: 'adding https://x.test/?t=SECRET now ' + 'z'.repeat(200), added: Array.from({ length: 8 }, (_, i) => ({ name: `item${i}` })), missing: [], total: undefined }) };
    const r = await build({ actions: odd }).cart_status.execute({});
    assert.equal(r.ok, true);
    assert.ok(!JSON.stringify(r).includes('SECRET'));
    assert.ok(r.step.length <= 60);
    assert.equal(r.added.length, 5);
    assert.equal(r.addedMore, 3);
    assert.ok(!('total' in r));
  });
  it('an unknown cart state is a failure', async () => {
    const odd = { ...actions, getCartStatus: async () => ({ ok: true, state: 'weird' }) };
    assert.equal((await build({ actions: odd }).cart_status.execute({})).ok, false);
  });
});

describe('WR-02 log_meal logs only what was confirmed', () => {
  const fridge = (extra = {}) => ({ ...renal,
    describeImage: async () => ({ ok: true, kind: 'fridge', foods: [{ name: 'milk' }, { name: 'cheese' }, { name: 'apple' }], label: null }),
    checkFood: async a => verdictFor(a.food.name), ...extra });
  it('logs the named food only', async () => {
    const { mod, calls } = rec(fridge(), 'logFood', () => ({ ok: true }));
    const t = build({ renal: mod });
    await t.look_at_camera.execute({});
    const r = await t.log_meal.execute({ foods: ['Apple'] });
    assert.deepEqual(r, { ok: true, logged: ['apple'] });
    assert.equal(calls.length, 1);
  });
  it('an unknown food is not logged', async () => {
    const { mod, calls } = rec(fridge(), 'logFood', () => ({ ok: true }));
    const t = build({ renal: mod });
    await t.look_at_camera.execute({});
    assert.equal((await t.log_meal.execute({ foods: ['pizza'] })).error, 'nothing_to_log');
    assert.equal(calls.length, 0);
  });
  it('a retry after a partial failure does not double-log', async () => {
    let n = 0;
    const logged = [];
    const { mod } = rec(fridge(), 'logFood', a => { n++; if (n === 2) return bad; logged.push(a.verdict.food); return { ok: true }; });
    const t = build({ renal: mod });
    await t.look_at_camera.execute({});
    clean(await t.log_meal.execute({ foods: ['milk', 'cheese'] }));
    const r = await t.log_meal.execute({ foods: ['milk', 'cheese'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.logged, ['cheese']);
    assert.deepEqual(logged, ['milk', 'cheese']);
  });
  it('a failed look clears the previous verdicts and foods', async () => {
    const { mod, calls } = rec(fridge(), 'logFood', () => ({ ok: true }));
    let seeing = true;
    const t = build({ renal: mod, camera: { jpeg: async () => (seeing ? jpeg : null) } });
    await t.look_at_camera.execute({ place: 'store' }); // a store look is never remembered in the pantry
    seeing = false;
    assert.equal((await t.look_at_camera.execute({})).ok, false);
    assert.equal((await t.log_meal.execute({ foods: ['milk'] })).error, 'nothing_to_log');
    assert.equal((await t.suggest_meal.execute({})).error, 'nothing_seen');
    assert.equal(calls.length, 0);
  });
  it('check_food does not replace the fridge foods used by suggest_meal', async () => {
    const { mod, calls } = rec(fridge(), 'suggestMeals');
    const t = build({ renal: mod });
    await t.look_at_camera.execute({});
    await t.check_food.execute({ name: 'banana', grams: null });
    await t.suggest_meal.execute({});
    assert.deepEqual(calls[0].foods, ['milk', 'cheese', 'apple']);
  });
});

describe('WR-04 timed-out calls leave no state behind', () => {
  it('a late look does not set verdicts or foods', async () => {
    let release;
    const slow = { ...renal, describeImage: () => new Promise(r => { release = () => r({ ok: true, kind: 'plate', foods: [{ name: 'late' }], label: null }); }) };
    const { mod, calls } = rec(slow, 'logFood', () => ({ ok: true }));
    const t = build({ renal: mod, timeoutMs: 30 });
    assert.equal((await t.look_at_camera.execute({})).error, 'timeout');
    release();
    await new Promise(r => setTimeout(r, 30));
    assert.equal((await t.log_meal.execute({ foods: ['late'] })).error, 'nothing_to_log');
    assert.equal((await t.suggest_meal.execute({})).error, 'nothing_seen');
    assert.equal(calls.length, 0);
  });
  it('a start_cart timeout is reported as unconfirmed, not as failed', async () => {
    const { mod } = rec(actions, 'startCart', () => new Promise(() => {}));
    const r = await build({ actions: mod, timeoutMs: 30 }).start_cart.execute({ items: [{ name: 'rice', quantity: '1' }] });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'cart_unconfirmed');
    assert.match(r.say, /check/);
  });
});

describe('WR-05 debug frames', () => {
  it('refuses a folder inside the repository and creates nothing', async () => {
    const { access } = await import('node:fs/promises');
    const inside = join(import.meta.dirname, 'no-such-debug-dir');
    await build({ debugFrameDir: inside }).look_at_camera.execute({});
    await assert.rejects(() => access(inside));
    await build({ debugFrameDir: 'relative-frames' }).look_at_camera.execute({});
    await assert.rejects(() => access('relative-frames'));
  });
  it('writes private files in a private folder, with distinct names', async () => {
    const { stat } = await import('node:fs/promises');
    const fresh = join(dir, 'new-folder');
    const t = build({ debugFrameDir: fresh });
    await t.look_at_camera.execute({});
    await t.look_at_camera.execute({});
    const files = await readdir(fresh);
    assert.equal(files.length, 2);
    assert.equal((await stat(fresh)).mode & 0o077, 0);
    assert.equal((await stat(join(fresh, files[0]))).mode & 0o777, 0o600);
  });
});

describe('WR-06 text_cart_link', () => {
  const status = over => ({ ...actions, getCartStatus: async () => ({ ok: true, state: 'done', step: '', added: [], missing: [], total: 1, cartUrl: 'https://example.com/cart', ...over }) });
  it('only sends when the cart is done', async () => {
    for (const state of ['running', 'waiting_for_patient', 'failed', 'idle']) {
      const { mod, calls } = rec(status({ state }), 'sendText');
      assert.equal((await build({ actions: mod, phone: PHONE }).text_cart_link.execute({})).error, 'no_cart_link');
      assert.equal(calls.length, 0);
    }
  });
  it('rejects a link that is not http or https', async () => {
    for (const cartUrl of ['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '']) {
      const { mod, calls } = rec(status({ cartUrl }), 'sendText');
      assert.equal((await build({ actions: mod, phone: PHONE }).text_cart_link.execute({})).error, 'no_cart_link');
      assert.equal(calls.length, 0);
    }
  });
  it('sends the same link once per call', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    const t = build({ actions: mod, phone: PHONE });
    assert.equal((await t.text_cart_link.execute({})).ok, true);
    assert.equal((await t.text_cart_link.execute({})).error, 'link_already_sent');
    assert.equal(calls.length, 1);
  });
  it('a failed send can be retried', async () => {
    let ok = false;
    const { mod, calls } = rec(actions, 'sendText', () => ({ ok }));
    const t = build({ actions: mod, phone: PHONE });
    assert.equal((await t.text_cart_link.execute({})).ok, false);
    ok = true;
    assert.equal((await t.text_cart_link.execute({})).ok, true);
    assert.equal(calls.length, 2);
  });
});

describe('WR-07 check_food input', () => {
  it('rejects empty and over-long names and bad grams', async () => {
    const { mod, calls } = rec(renal, 'checkFood');
    const t = build({ renal: mod });
    for (const a of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }, { name: 5 }, { name: 'rice', grams: 0 }, { name: 'rice', grams: -3 }, { name: 'rice', grams: NaN }, { name: 'rice', grams: 5001 }, { name: 'rice', grams: '100' }]) {
      const r = await t.check_food.execute(a);
      assert.equal(r.ok, false, JSON.stringify(a));
      assert.ok(r.say);
    }
    assert.equal(calls.length, 0);
  });
  it('treats missing grams as null and trims the name', async () => {
    const { mod, calls } = rec(renal, 'checkFood');
    assert.equal((await build({ renal: mod }).check_food.execute({ name: '  rice  ' })).ok, true);
    assert.deepEqual(calls[0].food, { name: 'rice', grams: null });
  });
});

describe('IN-01 spokenVerdict wording', () => {
  it('does not split at an abbreviation', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'limit', say: 'It has approx. 420 mg of potassium. Keep it small. Third.' }), 'Small portion, it has approx. 420 mg of potassium. Keep it small.');
  });
  it('keeps brand capitals that appear in the food name', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'avoid', food: "Campbell's soup", say: "Campbell's soup is very salty." }), "No, Campbell's soup is very salty.");
    assert.equal(tools.spokenVerdict({ verdict: 'ok', food: 'banana', say: 'Banana is fine.' }), 'Yes, banana is fine.');
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'iPhone fan.' }), 'Yes, iPhone fan.');
  });
  it('does not say Yes, yes', () => {
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'Yes, that is fine.' }), 'Yes, that is fine.');
    assert.equal(tools.spokenVerdict({ verdict: 'avoid', say: 'No. Far too salty.' }), 'No, far too salty.');
    assert.equal(tools.spokenVerdict({ verdict: 'ok', say: 'Yes.' }), 'Yes.');
  });
  it('shortens at a sentence or word end, never past max', () => {
    const say = 'First sentence is here. Second sentence is also here, and it keeps going for a while longer than the limit.';
    const out = tools.spokenVerdict({ verdict: 'ok', say }, 60);
    assert.equal(out, 'Yes, first sentence is here.');
    const one = tools.spokenVerdict({ verdict: 'ok', say: 'word '.repeat(60) }, 50);
    assert.ok(one.length <= 50 && one.endsWith('.'));
    assert.equal(tools.spokenVerdict({ verdict: 'avoid', say: 'Too salty.' }, 0), 'No.');
  });
});

describe('WR-08 sanitising free text', () => {
  it('removes links from module text before it reaches the model', async () => {
    const t = build({ renal: { ...renal, checkFood: async a => ({ ...verdictFor(a.food.name, 'ok', 'See https://x.test/?t=SECRET for more. Fine.'), swap: 'https://y.test/SECRET2' }) } });
    const r = await t.check_food.execute({ name: 'rice', grams: null });
    assert.ok(!JSON.stringify(r).includes('SECRET'));
  });
});

describe('WR-09 endCall and withTimeout', () => {
  it('calls stopCart and never throws', async () => {
    let n = 0;
    assert.equal((await tools.endCall({ actions: { stopCart: async () => { n++; return { ok: true }; } } })).ok, true);
    assert.equal(n, 1);
    assert.equal((await tools.endCall({ actions: { stopCart: async () => { throw new Error('x'); } } })).ok, false);
    assert.equal((await tools.endCall({ actions: { stopCart: () => { throw new Error('sync'); } } })).ok, false);
  });
  it('gives up on a hung step', async () => {
    const r = await tools.withTimeout(() => new Promise(() => {}), 30);
    assert.deepEqual(r, { ok: false, timedOut: true });
  });
});

describe('onToolActivity', () => {
  it('reports +1 then -1 around a tool run', async () => {
    const seen = [];
    const r = await build({ onToolActivity: d => seen.push(d) }).check_food.execute({ name: 'banana', grams: 118 });
    assert.equal(r.ok, true);
    assert.deepEqual(seen, [1, -1]);
  });
  it('reports -1 when the renal module throws', async () => {
    const seen = [];
    const t = build({ onToolActivity: d => seen.push(d), renal: { ...renal, checkFood: async () => { throw new Error('boom'); } } });
    const r = await t.check_food.execute({ name: 'banana', grams: null });
    assert.equal(r.ok, false);
    assert.deepEqual(seen, [1, -1]);
  });
  it('reports -1 when the tool times out', async () => {
    const seen = [];
    const t = build({ timeoutMs: 50, onToolActivity: d => seen.push(d), renal: { ...renal, checkFood: () => new Promise(() => {}) } });
    const r = await t.check_food.execute({ name: 'banana', grams: null });
    assert.equal(r.ok, false);
    assert.deepEqual(seen, [1, -1]);
  });
  it('a throwing hook does not change the result', async () => {
    const r = await build({ onToolActivity: () => { throw new Error('hook'); } }).check_food.execute({ name: 'banana', grams: 118 });
    assert.equal(r.ok, true);
  });
  it('works without a hook', async () => {
    const r = await build().check_food.execute({ name: 'banana', grams: 118 });
    assert.equal(r.ok, true);
  });
});

describe('shopping list tools', async () => {
  const { createMemory } = await import('./memory.mjs');
  let n = 0;
  const stateDir = () => join(dir, `state-${n++}`);
  const withMemory = (d, over = {}) => build({ memory: createMemory({ patientId: 'demo', dir: d }), ...over });

  it('add, then a call back without a call sees the list', async () => {
    const d = stateDir();
    const r = await withMemory(d).add_to_shopping_list.execute({ items: ['unsalted chicken broth', 'white rice'] });
    assert.equal(r.ok, true);
    assert.equal(r.added.length, 2);
    assert.equal(r.left, 2);
    const t2 = withMemory(d); // a new buildTools and a new store on the same folder
    const l = await t2.shopping_list.execute({});
    assert.deepEqual(l.needed, ['unsalted chicken broth', 'white rice']);
    const m = await t2.mark_item.execute({ name: 'white rice', status: 'approved' });
    assert.equal(m.ok, true);
    const l2 = await t2.shopping_list.execute({});
    assert.deepEqual(l2.approved, ['white rice']);
    assert.deepEqual(l2.needed, ['unsalted chicken broth']);
  });
  it('an empty list says so', async () => {
    const l = await withMemory(stateDir()).shopping_list.execute({});
    assert.equal(l.ok, true);
    assert.equal(l.say, 'Your shopping list is empty.');
  });
  it('without memory the list tools report memory_unavailable', async () => {
    const t = build();
    assert.equal((await t.add_to_shopping_list.execute({ items: ['rice'] })).error, 'memory_unavailable');
    assert.equal((await t.shopping_list.execute({})).error, 'memory_unavailable');
    assert.equal((await t.mark_item.execute({ name: 'rice', status: 'approved' })).error, 'memory_unavailable');
  });
  it('rejects bad arguments', async () => {
    const t = withMemory(stateDir());
    assert.equal((await t.add_to_shopping_list.execute({ items: [] })).error, 'bad_items');
    assert.equal((await t.add_to_shopping_list.execute({ items: Array.from({ length: 21 }, (_, i) => `i${i}`) })).error, 'bad_items');
    assert.equal((await t.add_to_shopping_list.execute({ items: ['  '] })).error, 'bad_items');
    assert.equal((await t.mark_item.execute({ name: 'rice', status: 'maybe' })).error, 'bad_item');
    assert.equal((await t.mark_item.execute({ name: ' ', status: 'approved' })).error, 'bad_item');
  });
  it('suggest_meal adds the missing items to needed', async () => {
    const t = withMemory(stateDir());
    await t.look_at_camera.execute({});
    await t.suggest_meal.execute({});
    assert.deepEqual((await t.shopping_list.execute({})).needed, ['unsalted chicken broth']);
  });
  it('start_cart with an empty list uses the remembered needed list', async () => {
    const { mod, calls } = rec(actions, 'startCart');
    const t = withMemory(stateDir(), { actions: mod });
    await t.add_to_shopping_list.execute({ items: ['white rice'] });
    const r = await t.start_cart.execute({ items: [] });
    assert.equal(r.ok, true);
    assert.deepEqual(calls[0].items, [{ name: 'white rice', quantity: '1' }]);
  });
  it('results stay within 900 characters with long names', async () => {
    const t = withMemory(stateDir());
    for (let k = 0; k < 3; k++) await t.add_to_shopping_list.execute({ items: Array.from({ length: 20 }, (_, i) => `${'w'.repeat(75)}${k}${i}`) });
    await t.mark_item.execute({ name: `${'w'.repeat(75)}00`, status: 'approved' });
    const l = await t.shopping_list.execute({});
    assert.ok(JSON.stringify(l).length <= 900);
    assert.equal(l.ok, true);
  });
});

// ---- Phase 5 plan 03: pickBest and the shelf result (AISL-01) ----
const LIM = { sodiumMg: 2000, potassiumMg: 2000, phosphorusMg: 1000 };
const vn = (food, verdict, nutrients = null, say = 'Fine today.') => ({ ...verdictFor(food, verdict, say), nutrients });

describe('pickBest', () => {
  it('ranks ok, then limit, then unknown, then avoid', () => {
    assert.equal(tools.pickBest([vn('A', 'limit'), vn('B', 'ok')], LIM).food, 'B');
    assert.equal(tools.pickBest([vn('A', 'unknown'), vn('B', 'limit')], LIM).food, 'B');
    assert.equal(tools.pickBest([vn('A', 'avoid'), vn('B', 'unknown')], LIM).food, 'B');
  });
  it('gives null when all are avoid or nothing was checked', () => {
    assert.equal(tools.pickBest([vn('A', 'avoid'), vn('B', 'avoid')], LIM), null);
    assert.equal(tools.pickBest([], LIM), null);
    assert.equal(tools.pickBest([null, { ok: false }], LIM), null);
    assert.equal(tools.pickBest(undefined, LIM), null);
  });
  it('breaks a tie by the lowest largest share of a daily limit', () => {
    const a = vn('A', 'ok', { sodiumMg: 800, potassiumMg: 100, phosphorusMg: 100 });
    const b = vn('B', 'ok', { sodiumMg: 200, potassiumMg: 400, phosphorusMg: 100 });
    assert.equal(tools.pickBest([a, b], LIM).food, 'B');
    assert.equal(tools.pickBest([vn('A', 'ok'), b], LIM).food, 'B');
  });
  it('uses the order seen without nutrients or limits', () => {
    assert.equal(tools.pickBest([vn('A', 'ok'), vn('B', 'ok')], LIM).food, 'A');
    const a = vn('A', 'ok', { sodiumMg: 800, potassiumMg: 100, phosphorusMg: 100 });
    const b = vn('B', 'ok', { sodiumMg: 200, potassiumMg: 400, phosphorusMg: 100 });
    assert.equal(tools.pickBest([a, b], undefined).food, 'A');
    assert.equal(tools.pickBest([a, b], { sodiumMg: 0, potassiumMg: 0, phosphorusMg: 0 }).food, 'A');
  });
  it('never chooses a failed check and ranks an odd verdict as unknown', () => {
    assert.equal(tools.pickBest([{ ok: false, verdict: 'ok', food: 'X' }, vn('B', 'limit')], LIM).food, 'B');
    assert.equal(tools.pickBest([vn('A', 'weird'), vn('B', 'avoid')], LIM).food, 'A');
    assert.equal(tools.pickBest([vn('A', 'weird'), vn('B', 'limit')], LIM).food, 'B');
  });
  it('does not change its input', () => {
    const input = [vn('A', 'limit'), vn('B', 'ok')];
    const copy = JSON.stringify(input);
    tools.pickBest(input, LIM);
    assert.equal(JSON.stringify(input), copy);
  });
});

const shelfRenal = (foods, byName, { kind = 'shelf', label = null, fails = [] } = {}) => ({ ...renal,
  describeImage: async () => ({ ok: true, kind, foods: foods.map(name => ({ name, grams: null })), label }),
  checkFood: async a => {
    if (fails.includes(a.food.name)) throw new Error('boom');
    const [verdict, say] = byName[a.food.name] ?? ['ok', 'Fine today.'];
    return verdictFor(a.food.name, verdict, say);
  } });

describe('look_at_camera on a shelf', () => {
  const three = ['regular broth', 'low sodium broth', 'bouillon cubes'];
  const verdicts = { 'regular broth': ['limit', 'Quite salty.'], 'low sodium broth': ['ok', 'It is low in salt. Enjoy it.'], 'bouillon cubes': ['avoid', 'Far too salty.'] };
  it('names the best choice first, with the verdict word first', async () => {
    const r = await build({ renal: shelfRenal(three, verdicts) }).look_at_camera.execute({});
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'shelf');
    assert.equal(r.best, 'low sodium broth');
    assert.ok(r.spoken.startsWith('Yes, the low sodium broth is the best choice here.'), r.spoken);
    assert.ok(splitCount(r.spoken) <= 2);
    assert.ok(r.spoken.length <= 200);
    assert.equal(r.results.length, 3);
    assert.equal(r.results[0].verdict, 'avoid');
  });
  it('says none fit when every food is avoid', async () => {
    const r = await build({ renal: shelfRenal(['a', 'b'], { a: ['avoid', 'No.'], b: ['avoid', 'No.'] }) }).look_at_camera.execute({});
    assert.equal(r.best, null);
    assert.equal(r.spoken, 'No, none of the items in view fit your limits. Want me to look at another shelf?');
  });
  it('uses the limit and unknown lead sentences', async () => {
    let r = await build({ renal: shelfRenal(['a', 'b'], { a: ['limit', 'Small amounts only.'], b: ['avoid', 'No.'] }) }).look_at_camera.execute({});
    assert.ok(r.spoken.startsWith('Small portion, the a is the best choice here.'), r.spoken);
    r = await build({ renal: shelfRenal(['a', 'b'], { a: ['unknown', 'Not sure.'], b: ['avoid', 'No.'] }) }).look_at_camera.execute({});
    assert.ok(r.spoken.startsWith("I can't tell for sure, but the a looks like the best choice here."), r.spoken);
    assert.ok(!r.spoken.startsWith('Yes'));
  });
  it('never recommends a food whose check failed', async () => {
    const r = await build({ renal: shelfRenal(['a', 'b'], { b: ['avoid', 'No.'] }, { fails: ['a'] }) }).look_at_camera.execute({});
    assert.equal(r.best, null);
  });
  it('leaves other pictures unchanged', async () => {
    for (const kind of ['plate', 'fridge']) {
      const r = await build({ renal: shelfRenal(['a', 'b'], {}, { kind }) }).look_at_camera.execute({});
      assert.equal(r.ok, true);
      assert.ok(!('best' in r) && !('spoken' in r));
    }
    let r = await build({ renal: shelfRenal(['only'], {}) }).look_at_camera.execute({});
    assert.ok(!('best' in r) && !('spoken' in r));
    r = await build({ renal: shelfRenal(['a', 'b'], {}, { label: { product: 'Soup' } }) }).look_at_camera.execute({});
    assert.ok(!('best' in r) && !('spoken' in r));
  });
  it('stays within 900 characters for six long names and says', async () => {
    const names = Array.from({ length: 6 }, (_, i) => `product number ${i} ${'x'.repeat(50)}`.slice(0, 70));
    const long = 'A rather long sentence about this product that goes on and on and on. And another one that is just as long.';
    const by = Object.fromEntries(names.map(n => [n, ['ok', long]]));
    const r = await build({ renal: shelfRenal(names, by) }).look_at_camera.execute({});
    assert.ok(JSON.stringify(r).length <= 900, String(JSON.stringify(r).length));
    assert.equal(typeof r.best, 'string');
    assert.ok(r.spoken.startsWith('Yes, the '));
  });
  it('cleans hostile names', async () => {
    const r = await build({ renal: shelfRenal(['Broth\u0007 https://x.y', 'other'], { other: ['avoid', 'No.'] }) }).look_at_camera.execute({});
    assert.equal(r.best, 'Broth');
    assert.ok(r.spoken.includes('the Broth is'), r.spoken);
    assert.ok(!r.spoken.includes('http'));
  });
});
function splitCount(text) { return text.split(/(?<=[.!?])\s+/).length; }

// ---- quick 261114-eyk: pantry and texted recipes ----
const scene = (kind, names) => ({ ok: true, kind, foods: names.map(name => ({ name, grams: 100 })), label: null });
const fridgeScenes = () => makeFakeRenal({ scenes: [scene('fridge', ['Rice', 'eggs', 'star fruit']), scene('shelf', ['EGGS', 'apples'])] });

describe('pantry tools', async () => {
  const { createMemory, MAX_AGE_MS } = await import('./memory.mjs');
  let n = 0;
  const stateDir = () => join(dir, `pantry-${n++}`);
  const withMemory = (d, over = {}) => build({ memory: createMemory({ patientId: 'demo', dir: d }), ...over });

  it('a fridge look then a shelf look remember both shots without duplicates', async () => {
    const t = withMemory(stateDir(), { renal: fridgeScenes() });
    const a = await t.look_at_camera.execute({ place: 'home' });
    assert.equal(a.remembered, true);
    await t.look_at_camera.execute({ place: 'home' });
    const l = await t.pantry_list.execute({});
    assert.deepEqual(l.names, ['Rice', 'eggs', 'star fruit', 'apples']);
    assert.equal(l.count, 4);
  });
  it('plate, label and store looks add nothing', async () => {
    const t = withMemory(stateDir());
    await t.look_at_camera.execute({});
    assert.equal((await t.pantry_list.execute({})).count, 0);
    const label = { ...renal, describeImage: async () => ({ ok: true, kind: 'fridge', foods: [], label: { product: 'Soup' } }) };
    await withMemory(stateDir(), { renal: label }).look_at_camera.execute({});
    const t2 = withMemory(stateDir(), { renal: fridgeScenes() });
    const r = await t2.look_at_camera.execute({ place: 'store' });
    assert.equal(r.remembered, undefined);
    assert.equal((await t2.pantry_list.execute({})).count, 0);
    const t3 = withMemory(stateDir(), { renal: label });
    await t3.look_at_camera.execute({});
    assert.equal((await t3.pantry_list.execute({})).count, 0);
  });
  it('a timed-out look adds nothing', async () => {
    const slow = { ...fridgeScenes() };
    const base = slow.describeImage;
    slow.describeImage = async a => { await new Promise(r => setTimeout(r, 100)); return base(a); };
    const t = withMemory(stateDir(), { renal: slow, timeoutMs: 30 });
    assert.equal((await t.look_at_camera.execute({})).error, 'timeout');
    await new Promise(r => setTimeout(r, 200));
    assert.equal((await t.pantry_list.execute({})).count, 0);
  });
  it('suggest_meal gets the whole pantry, including avoid foods', async () => {
    const r = fridgeScenes();
    const { mod, calls } = rec(r, 'suggestMeals');
    const t = withMemory(stateDir(), { renal: mod, });
    await t.look_at_camera.execute({ place: 'home' });
    await t.look_at_camera.execute({ place: 'home' });
    assert.equal((await t.suggest_meal.execute({})).ok, true);
    assert.deepEqual(calls[0].foods, ['Rice', 'eggs', 'star fruit', 'apples']);
  });
  it('without memory the pantry works inside the call; empty falls back to nothing_seen', async () => {
    const { mod, calls } = rec(fridgeScenes(), 'suggestMeals');
    const t = build({ renal: mod });
    assert.equal((await t.suggest_meal.execute({})).error, 'nothing_seen');
    await t.look_at_camera.execute({ place: 'home' });
    await t.suggest_meal.execute({});
    assert.deepEqual(calls[0].foods, ['Rice', 'eggs', 'star fruit']);
  });
  it('a call back sees the pantry, and it expires after two hours', async () => {
    const d = stateDir();
    const c = { t: 10_000_000 };
    const mem = () => createMemory({ patientId: 'demo', dir: d, now: () => c.t });
    const first = build({ renal: fridgeScenes(), memory: mem() });
    await first.look_at_camera.execute({ place: 'home' });
    const { mod, calls } = rec(renal, 'suggestMeals');
    const second = build({ renal: mod, memory: mem() });
    assert.deepEqual((await second.pantry_list.execute({})).names, ['Rice', 'eggs', 'star fruit']);
    assert.equal((await second.suggest_meal.execute({})).ok, true);
    assert.deepEqual(calls[0].foods, ['Rice', 'eggs', 'star fruit']);
    c.t += MAX_AGE_MS + 1;
    const third = build({ renal: mod, memory: mem() });
    assert.equal((await third.pantry_list.execute({})).count, 0);
    assert.equal((await third.suggest_meal.execute({})).error, 'nothing_seen');
  });
  it('pantry_list is short and says a fixed sentence when empty', async () => {
    const t = withMemory(stateDir(), { renal: { ...renal, describeImage: async () => scene('fridge', Array.from({ length: 30 }, (_, i) => `${'f'.repeat(70)}${i}`)) } });
    assert.match((await t.pantry_list.execute({})).say, /Show me your fridge/);
    await t.look_at_camera.execute({ place: 'home' });
    const l = await t.pantry_list.execute({});
    assert.equal(l.names.length, 12);
    assert.ok(l.names.every(x => x.length <= 40));
    assert.equal(l.more, 8);
    assert.ok(JSON.stringify(l).length <= 900);
  });
  it('remove_from_pantry removes, and fails when nothing matched', async () => {
    const d = stateDir();
    const t = withMemory(d, { renal: fridgeScenes() });
    await t.look_at_camera.execute({ place: 'home' });
    const r = await t.remove_from_pantry.execute({ items: ['rice', 'star'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.removed.sort(), ['Rice', 'star fruit']);
    assert.deepEqual((await withMemory(d).pantry_list.execute({})).names, ['eggs']);
    assert.equal((await t.remove_from_pantry.execute({ items: ['zzz'] })).error, 'not_in_pantry');
    assert.equal((await t.remove_from_pantry.execute({ items: [] })).error, 'bad_items');
    const lone = build({ renal: fridgeScenes() });
    await lone.look_at_camera.execute({ place: 'home' });
    assert.equal((await lone.remove_from_pantry.execute({ items: ['eggs'] })).ok, true);
    assert.deepEqual((await lone.pantry_list.execute({})).names, ['Rice', 'star fruit']);
  });
  it('clear_pantry forgets here and on the next call', async () => {
    const d = stateDir();
    const t = withMemory(d, { renal: fridgeScenes() });
    await t.look_at_camera.execute({ place: 'home' });
    assert.equal((await t.clear_pantry.execute({})).ok, true);
    assert.equal((await t.suggest_meal.execute({})).error, 'nothing_seen');
    assert.equal((await withMemory(d).pantry_list.execute({})).count, 0);
    const lone = build({ renal: fridgeScenes() });
    await lone.look_at_camera.execute({ place: 'home' });
    await lone.clear_pantry.execute({});
    assert.equal((await lone.suggest_meal.execute({})).error, 'nothing_seen');
  });
});

describe('recipeText', () => {
  const meal = { title: 'Rice with herbed chicken', uses: ['rice', 'chicken'], missing: [{ name: 'unsalted broth', quantity: '1 carton' }], minutes: 25, steps: ['Cook the rice.', 'Cook the chicken.'], why: 'Low in sodium.' };
  it('gives the plain text shape', () => {
    assert.equal(tools.recipeText(meal), [
      'Recipe from your AI renal dietitian: Rice with herbed chicken',
      'Uses from your kitchen: rice, chicken',
      'Missing: unsalted broth (1 carton)',
      'Time: about 25 minutes',
      'Steps:',
      '1. Cook the rice.',
      '2. Cook the chicken.',
      'Why it fits: Low in sodium.',
      'This recipe follows the limits set by your care team and does not replace their advice.',
    ].join('\n'));
  });
  it('says nothing missing, omits time, strips links, stays within 4000', () => {
    const t = tools.recipeText({ ...meal, missing: [], minutes: 0, title: 'A https://evil.example/x B' });
    assert.ok(t.includes('Missing: nothing') && !t.includes('Time:') && !t.includes('http'));
    const huge = tools.recipeText({ ...meal, steps: Array.from({ length: 200 }, () => 'x'.repeat(2000)), uses: Array.from({ length: 50 }, () => 'u'.repeat(500)) });
    assert.ok(huge.length <= 4000);
    assert.ok(huge.endsWith('does not replace their advice.'));
  });
});

describe('text_recipe', () => {
  const two = [
    { title: 'Rice with herbed chicken', uses: ['rice'], missing: [], minutes: 25, steps: ['Cook.'], why: 'Gentle.' },
    { title: 'Egg fried rice', uses: ['eggs'], missing: [], minutes: 15, steps: ['Fry.'], why: 'Quick.' },
  ];
  const ready = async (meals, over = {}) => {
    const t = build({ renal: oneMealRenal(meals), phone: PHONE, ...over });
    await t.look_at_camera.execute({});
    await t.suggest_meal.execute({});
    return t;
  };
  it('sends the single meal exactly once, then refuses a repeat', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    const t = await ready(undefined, { actions: mod });
    const r = await t.text_recipe.execute({});
    assert.deepEqual([r.ok, r.sent], [true, true]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].phone, PHONE);
    assert.equal(calls[0].text, tools.recipeText({ title: 'Rice with herbed chicken', uses: ['rice'], missing: [{ name: 'broth', quantity: '1 carton' }], minutes: 25, steps: ['Cook.', 'Serve.'], why: 'Gentle on sodium.' }));
    assert.equal((await t.text_recipe.execute({})).error, 'recipe_already_sent');
    assert.equal(calls.length, 1);
  });
  it('two meals need a choice; title and position pick the right one', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    const t = await ready(two, { actions: mod });
    const w = await t.text_recipe.execute({});
    assert.equal(w.error, 'which_recipe');
    assert.deepEqual(w.titles, ['Rice with herbed chicken', 'Egg fried rice']);
    assert.equal(calls.length, 0);
    assert.equal((await t.text_recipe.execute({ position: 3 })).error, 'which_recipe');
    assert.equal((await t.text_recipe.execute({ title: 'nothing like it' })).error, 'which_recipe');
    assert.equal((await t.text_recipe.execute({ position: 2 })).ok, true);
    assert.equal((await t.text_recipe.execute({ title: 'herbed' })).ok, true);
    assert.ok(calls[0].text.includes('Egg fried rice'));
    assert.ok(calls[1].text.includes('herbed chicken'));
  });
  it('refuses without a phone or a suggestion and sends nothing', async () => {
    const { mod, calls } = rec(actions, 'sendText');
    for (const phone of ['', 'YOUR_PATIENT_PHONE', undefined]) {
      const t = await ready(undefined, { actions: mod, phone });
      assert.equal((await t.text_recipe.execute({})).error, 'no_phone');
    }
    assert.equal((await build({ actions: mod, phone: PHONE }).text_recipe.execute({})).error, 'no_recipe');
    assert.equal(calls.length, 0);
  });
  it('a definite failure un-marks so a retry sends', async () => {
    for (const impl of [async () => ({ ok: false, error: 'Chert rejected it' }), async () => { throw new Error('boom'); }]) {
      const { mod, calls } = rec(actions, 'sendText', impl);
      const t = await ready(undefined, { actions: mod });
      assert.equal((await t.text_recipe.execute({})).error, 'text_failed');
      assert.equal((await t.text_recipe.execute({})).error, 'text_failed');
      assert.equal(calls.length, 2);
    }
  });
  it('an unknown outcome is never resent', async () => {
    const { mod, calls } = rec(actions, 'sendText', async () => ({ ok: false, error: 'Send outcome is unknown; inspect Chert before retrying' }));
    const t = await ready(undefined, { actions: mod });
    assert.equal((await t.text_recipe.execute({})).error, 'text_unconfirmed');
    assert.equal((await t.text_recipe.execute({})).error, 'recipe_already_sent');
    assert.equal(calls.length, 1);
  });
  it('a timeout is unconfirmed and never resent', async () => {
    const { mod, calls } = rec(actions, 'sendText', () => new Promise(() => {}));
    const t = await ready(undefined, { actions: mod, timeoutMs: 30 });
    assert.equal((await t.text_recipe.execute({})).error, 'text_unconfirmed');
    assert.equal((await t.text_recipe.execute({})).error, 'recipe_already_sent');
    assert.equal(calls.length, 1);
  });
});

describe('quick 261114-fc6: a look that sees foods is never a dead end', async () => {
  const { createMemory } = await import('./memory.mjs');
  let n = 0;
  const stateDir = () => join(dir, `fc6-${n++}`);
  const names = [{ name: 'Lettuce', grams: null }, { name: 'Spring mix salad', grams: null }];
  const fridgeSeen = () => ({ ...renal, describeImage: async () => ({ ok: true, kind: 'fridge', foods: names, label: null }) });

  it('every check failing returns unjudged, remembers the foods and feeds suggest_meal', async () => {
    for (const failing of [async () => ({ ok: false, error: 'USDA lookup failed (429)' }), async () => { throw new Error('boom'); }]) {
      const added = [];
      const memory = createMemory({ patientId: 'demo', dir: stateDir() });
      const realAdd = memory.addPantry.bind(memory);
      memory.addPantry = async list => { added.push(list); return realAdd(list); };
      const { mod, calls } = rec({ ...fridgeSeen(), checkFood: failing }, 'suggestMeals');
      const t = build({ renal: mod, memory });
      const r = await t.look_at_camera.execute({ place: 'home' });
      assert.equal(r.ok, true);
      assert.equal(r.unjudged, true);
      assert.equal(r.remembered, true);
      assert.equal(r.best, undefined);
      assert.deepEqual(r.results.map(x => x.verdict), ['unknown', 'unknown']);
      assert.ok(r.results.every(x => x.spoken === "I can't tell, I couldn't check that one just now."));
      assert.equal(r.say, "I can see 2 foods, but I couldn't check them against your limits just now.");
      assert.deepEqual(added, [['Lettuce', 'Spring mix salad']]);
      const meal = await t.suggest_meal.execute({});
      assert.equal(meal.ok, true);
      assert.deepEqual(calls[0].foods, ['Lettuce', 'Spring mix salad']);
    }
  });
  it('a failing profile is not a failure: foods are remembered and checkFood is never called', async () => {
    let checks = 0;
    const memory = createMemory({ patientId: 'demo', dir: stateDir() });
    const t = build({ memory, renal: { ...fridgeSeen(), getProfile: async () => ({ ok: false, error: 'x' }), checkFood: async () => { checks++; return verdictFor('x'); } } });
    const r = await t.look_at_camera.execute({ place: 'home' });
    assert.equal(r.ok, true);
    assert.equal(r.unjudged, true);
    assert.equal(r.remembered, true);
    assert.equal(checks, 0);
    assert.equal((await t.pantry_list.execute({})).count, 2);
  });
  it('a shelf look where nothing could be judged has no shelf pick', async () => {
    const shelf = { ...renal, describeImage: async () => ({ ok: true, kind: 'shelf', foods: names, label: null }), checkFood: async () => ({ ok: false, error: 'x' }) };
    const r = await build({ renal: shelf }).look_at_camera.execute({ place: 'store' });
    assert.equal(r.ok, true);
    assert.equal(r.unjudged, true);
    assert.equal(r.best, undefined);
    assert.equal(r.spoken, undefined);
    assert.equal(r.remembered, undefined);
  });
  it('a single unjudged food is worded in the singular', async () => {
    const one = { ...renal, describeImage: async () => ({ ok: true, kind: 'plate', foods: [{ name: 'soup', grams: null }], label: null }), checkFood: async () => ({ ok: false, error: 'x' }) };
    const r = await build({ renal: one }).look_at_camera.execute({});
    assert.equal(r.say, "I can see one food, but I couldn't check it against your limits just now.");
  });
  it('online is set only when a checked verdict came from the web', async () => {
    const web = { ...renal, checkFood: async a => ({ ...verdictFor(a.food.name, 'limit', "Limit, x has about one hundred milligrams of sodium per serving. That is from what I found online, not from your care team's list."), source: 'web' }) };
    const r = await build({ renal: web }).look_at_camera.execute({});
    assert.equal(r.online, true);
    assert.equal(r.unjudged, undefined);
    const plain = await build().look_at_camera.execute({});
    assert.equal(Object.hasOwn(plain, 'online'), false);
  });
  it('check_food keeps the online provenance sentence in its spoken text', async () => {
    const web = { ...renal, checkFood: async a => ({ ...verdictFor(a.food.name, 'limit', "Limit, x has about one hundred milligrams of sodium per serving. That is from what I found online, not from your care team's list."), source: 'web' }) };
    const r = await build({ renal: web }).check_food.execute({ name: 'oatly', grams: null });
    assert.ok(r.spoken.endsWith("not from your care team's list."), r.spoken);
  });
});
