import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// No stub may touch the network. Replace fetch BEFORE the modules load.
// Keep the real logFood from writing renal/data/diary.json.
const stateDir = await mkdtemp(join(tmpdir(), 'agent-contract-state-'));
process.env.RENAL_STATE_DIR = stateDir;

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('network used by a stub');
};

let video, renal, actions, tools, face;

before(async () => {
  video = await import('../shared/video.mjs');
  renal = await import('../renal/index.mjs');
  actions = await import('../actions/index.mjs');
  tools = await import('./tools.mjs');
  face = await import('./face.mjs');
});
after(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.RENAL_STATE_DIR;
  await rm(stateDir, { recursive: true, force: true });
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

describe('renal contract', () => {
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
    const previousKey = process.env.GOOGLE_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      const failed = await renal.describeImage({ jpeg: Buffer.alloc(4) });
      assert.equal(failed.ok, false);
      assert.ok(isStr(failed.error) && failed.error.length > 0);

      process.env.GOOGLE_API_KEY = 'dummy-key';
      const ai = {
        models: {
          generateContent: async () => ({
            text: JSON.stringify({ kind: 'plate', foods: [{ name: 'banana', grams: 118 }], label: null }),
          }),
        },
      };
      const seen = await renal.describeImage({ jpeg: Buffer.alloc(4) }, { ai });
      assert.equal(seen.ok, true);
      assert.ok(['label', 'plate', 'fridge', 'shelf', 'unclear'].includes(seen.kind));
      assert.ok(Array.isArray(seen.foods));
      for (const f of seen.foods) assert.ok(isStr(f.name) && (f.grams === null || isNum(f.grams)));
      assert.ok(seen.label === null || isStr(seen.label.product));
    } finally {
      if (previousKey === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = previousKey;
    }
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

  it('every function returns a Promise that resolves to an ok result, with or without an argument', async () => {
    const saved = { google: process.env.GOOGLE_API_KEY, usda: process.env.USDA_API_KEY };
    delete process.env.GOOGLE_API_KEY;
    delete process.env.USDA_API_KEY;
    try {
      for (const name of ['getProfile', 'describeImage', 'checkFood', 'suggestMeals', 'logFood', 'getToday']) {
        const p = renal[name]();
        assert.ok(p instanceof Promise, `${name} returns a Promise`);
        const r = await p;
        assert.equal(typeof r.ok, 'boolean', `${name}() ok is a boolean`);
        if (r.ok === false) assert.ok(isStr(r.error) && r.error.length > 0, `${name}() failure has an error`);
      }
      assert.equal((await renal.getProfile()).ok, true);
      assert.equal((await renal.getToday()).ok, true);
    } finally {
      if (saved.google === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = saved.google;
      if (saved.usda === undefined) delete process.env.USDA_API_KEY;
      else process.env.USDA_API_KEY = saved.usda;
    }
  });
});

describe('actions contract', () => {
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

  it('rejects external actions without configuration without performing them', async () => {
    const configKeys = [
      'CHERT_API_KEY',
      'CHERT_PROJECT_ID',
      'CHERT_LINE_ID',
      'PATIENT_PHONE',
      'LIVEKIT_URL',
      'LIVEKIT_API_KEY',
      'LIVEKIT_API_SECRET',
      'AGENT_NAME',
    ];
    const previous = Object.fromEntries(configKeys.map(key => [key, process.env[key]]));
    for (const key of configKeys) delete process.env[key];
    try {
      assert.equal((await actions.startCart()).ok, false);
      assert.equal((await actions.sendText({ phone: '+15551234567', text: 'hi' })).ok, false);
      assert.equal((await actions.callPatient({ phone: '+15551234567', reason: 'dinner' })).ok, false);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // The main checkout's .env.local may hold real Kroger keys: scrub every KROGER_* var and use a throwaway token folder.
  async function withScrubbedKroger(fn) {
    const saved = {};
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('KROGER_')) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
    }
    const tokenDir = await mkdtemp(join(tmpdir(), 'agent-contract-kroger-'));
    process.env.KROGER_TOKEN_DIR = tokenDir;
    try {
      return await fn();
    } finally {
      delete process.env.KROGER_TOKEN_DIR;
      Object.assign(process.env, saved);
      await rm(tokenDir, { recursive: true, force: true });
    }
  }

  it('Kroger sign-in actions report not configured without keys', async () => {
    await withScrubbedKroger(async () => {
      assert.deepEqual(await actions.startKrogerSignIn(), { ok: false, error: 'not_configured' });
      assert.deepEqual(await actions.getKrogerStatus(), {
        ok: true,
        configured: false,
        relay: false,
        connected: false,
        pending: false,
      });
    });
  });

  it('every async function returns a Promise with an ok result', async () => {
    await withScrubbedKroger(async () => {
      for (const name of ['startCart', 'getCartStatus', 'stopCart', 'callPatient', 'sendText', 'startKrogerSignIn', 'getKrogerStatus']) {
        const p = actions[name]();
        assert.ok(p instanceof Promise, `${name} returns a Promise`);
        assert.equal(typeof (await p).ok, 'boolean', `${name}() returns an ok result`);
      }
    });
  });
});

describe('agent/tools.mjs', () => {
  it('exposes anonymous look_at_camera and check_food tools that run offline', async () => {
    const t = tools.buildTools({ patientId: 'demo' });
    assert.ok(Object.keys(t).includes('check_food'));
    assert.ok(Object.keys(t).includes('look_at_camera'));
    for (const tool of Object.values(t)) assert.ok(!Object.hasOwn(tool, 'name'));
    const r = await t.check_food.execute({ name: 'banana', grams: 118 });
    assert.equal(r.ok, true);
    assert.equal(r.food, 'banana');
    assert.ok(['ok', 'limit', 'avoid', 'unknown'].includes(r.verdict));
    assert.ok(isStr(r.spoken));
  });
});

describe('agent/face.mjs', () => {
  it('draws WIDTH x HEIGHT RGBA frames', () => {
    for (const [tick, speaking] of [[0, false], [1, true]]) {
      const px = face.drawFace(tick, speaking);
      assert.ok(px instanceof Uint8Array);
      assert.equal(px.length, video.WIDTH * video.HEIGHT * 4);
    }
  });
});
