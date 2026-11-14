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
  it('has the two tools, anonymous', () => {
    const t = build();
    assert.deepEqual(Object.keys(t), ['look_at_camera', 'check_food']);
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

describe('prompt', () => {
  it('names the tools and the rules, drops Phase 2 wording', () => {
    const text = prompt.instructions;
    for (const k of Object.keys(build())) assert.ok(text.includes(k), k);
    for (const w of ['spoken', 'say', 'pay', 'no_camera_picture']) assert.ok(text.includes(w), w);
    for (const w of ['camera yet', 'never claim to see food', 'could not check it']) assert.ok(!text.includes(w), w);
  });
});
