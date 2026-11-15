import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const stateDir = await mkdtemp(join(tmpdir(), 'renal-profile-'));
process.env.RENAL_STATE_DIR = stateDir;
after(async () => {
  delete process.env.RENAL_STATE_DIR;
  await rm(stateDir, { recursive: true, force: true });
});

const {
  CONDITIONS, LIMIT_BOUNDS, MAX_AVOID, PATIENT_SET_BY,
  getProfile, getSavedProfile, resetProfile, saveProfile,
} = await import('./profile.mjs');
const { getToday } = await import('./index.mjs');

const patientsPath = new URL('./data/patients.json', import.meta.url);
const hash = async () => createHash('sha256').update(await readFile(patientsPath)).digest('hex');
const before = await hash();
after(async () => assert.equal(await hash(), before));

const good = { sodiumMg: 2000, potassiumMg: 2500, phosphorusMg: 900, fluidMl: 1200 };
const KEYS = ['sodiumMg', 'potassiumMg', 'phosphorusMg', 'fluidMl']; // the required four; proteinG/carbsG are optional
const save = (profile, patientId = 'p1') => saveProfile({ patientId, profile });
const full = (over = {}) => ({ name: 'Ana', condition: 'hemodialysis', limits: good, avoid: [], setupDone: true, ...over });

test('nothing saved: built-in profile, unchanged', async () => {
  const r = await getProfile({ patientId: 'demo' });
  assert.equal(r.ok, true);
  assert.equal(r.profile.name, 'Sam');
  assert.equal(r.profile.setBy, 'care team');
  assert.equal(r.profile.source, 'builtin');
});

test('per-caller ids with nothing saved need limits, never the built-in ones', async () => {
  for (const id of ['p' + 'a1b2c3d4e5f60718293a4b5c'.slice(0, 24), 'g' + '0'.repeat(24)]) {
    assert.deepEqual(await getProfile({ patientId: id }), { ok: false, error: 'limits not set', limitsNeeded: true });
    const today = await getToday({ patientId: id });
    assert.equal(today.ok, false);
    assert.equal(today.limitsNeeded, true);
  }
  const missing = await getProfile({ patientId: 'missing' });
  assert.deepEqual([missing.ok, missing.error], [false, 'patient not found']);
  assert.equal((await getProfile({ patientId: 'demo' })).profile.name, 'Sam');
  // a saved per-caller profile still wins
  const id = 'p' + 'f'.repeat(24);
  await save(full(), id);
  assert.equal((await getProfile({ patientId: id })).ok, true);
  await resetProfile({ patientId: id });
});

test('save then get returns patient profile', async () => {
  const s = await save(full({ avoid: ['Grapefruit ', 'grapefruit', 'Star Fruit'] }));
  assert.equal(s.ok, true);
  const r = await getProfile({ patientId: 'p1' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.profile.limits, good);
  assert.deepEqual(r.profile.avoid, ['grapefruit', 'star fruit']);
  assert.equal(r.profile.setBy, PATIENT_SET_BY);
  assert.equal(r.profile.setOn, new Date().toISOString().slice(0, 10));
  assert.equal(r.profile.source, 'patient');
  assert.match(r.profile.limitsNote, /care team/);
});

test('every bound is enforced', async () => {
  for (const key of KEYS) {
    const [min, max] = LIMIT_BOUNDS[key];
    assert.equal((await save(full({ limits: { ...good, [key]: min } }), 'b')).ok, true, `${key} min`);
    assert.equal((await save(full({ limits: { ...good, [key]: max } }), 'b')).ok, true, `${key} max`);
    for (const bad of [min - 1, max + 1, 1500.5, '2000', NaN, Infinity, null]) {
      const r = await save(full({ limits: { ...good, [key]: bad } }), 'b');
      assert.equal(r.ok, false, `${key} ${String(bad)}`);
      assert.equal(r.field, key);
    }
    const missing = { ...good };
    delete missing[key];
    const r = await save(full({ limits: missing }), 'b');
    assert.equal(r.ok, false);
    assert.equal(r.field, key);
  }
  assert.equal((await save(full({ limits: { ...good, extra: 1 } }), 'b')).ok, false);
});

test('limits null is incomplete: limitsNeeded, never built-in', async () => {
  assert.equal((await save(full({ limits: null, setupDone: false }), 'nolim')).ok, true);
  const r = await getProfile({ patientId: 'nolim' });
  assert.equal(r.ok, false);
  assert.equal(r.limitsNeeded, true);
  assert.equal(r.profile, undefined);
  const t = await getToday({ patientId: 'nolim' });
  assert.equal(t.ok, false);
  assert.equal(t.limitsNeeded, true);
});

test('name, condition and avoid validation', async () => {
  const n = await save(full({ name: '  A\u0007na\n  B  ' }), 'n');
  assert.equal(n.saved.name, 'A na B');
  assert.equal((await save(full({ name: 'x'.repeat(41) }), 'n')).ok, false);
  assert.equal((await save(full({ name: '1234' }), 'n')).ok, false);
  const nul = await save(full({ name: null }), 'nn');
  assert.equal(nul.saved.name, null);
  assert.equal((await getProfile({ patientId: 'nn' })).profile.name, '');
  assert.equal((await save(full({ condition: 'cold' }), 'n')).ok, false);
  for (const c of CONDITIONS) assert.equal((await save(full({ condition: c }), 'n')).ok, true);
  const many = Array.from({ length: MAX_AVOID + 1 }, (_, i) => `food${i}`);
  assert.equal((await save(full({ avoid: many }), 'n')).ok, false);
  assert.equal((await save(full({ avoid: many.slice(0, MAX_AVOID) }), 'n')).ok, true);
  assert.equal((await save(full({ avoid: 'grapefruit' }), 'n')).ok, false);
  assert.equal((await save(full({ avoid: ['a'.repeat(41)] }), 'n')).ok, false);
});

test('file modes, no leftover temp, replace, concurrent saves', async () => {
  await Promise.all([save(full({ name: 'Cy' }), 'c1'), save(full({ name: 'Di' }), 'c2')]);
  assert.equal((await getSavedProfile({ patientId: 'c1' })).saved.name, 'Cy');
  assert.equal((await getSavedProfile({ patientId: 'c2' })).saved.name, 'Di');
  await save(full({ name: 'Cyd' }), 'c1');
  assert.equal((await getSavedProfile({ patientId: 'c1' })).saved.name, 'Cyd');
  assert.equal((await stat(join(stateDir, 'profiles.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(stateDir)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(stateDir)).filter((f) => f.endsWith('.tmp')), []);
});

test('reset removes only that patient', async () => {
  await save(full(), 'r1');
  await save(full(), 'r2');
  assert.deepEqual(await resetProfile({ patientId: 'r1' }), { ok: true, removed: true });
  assert.deepEqual(await resetProfile({ patientId: 'r1' }), { ok: true, removed: false });
  assert.equal((await getSavedProfile({ patientId: 'r2' })).saved.id, 'r2');
  await resetProfile({ patientId: 'demo' });
  assert.equal((await getProfile({ patientId: 'demo' })).profile.source, 'builtin');
});

test('getToday uses saved limits', async () => {
  await save(full({ limits: { ...good, sodiumMg: 1800 } }), 'today');
  const t = await getToday({ patientId: 'today' });
  assert.equal(t.ok, true);
  assert.equal(t.remaining.sodiumMg, 1800);
});

test('refuses a folder inside the repo, and a corrupt store is not the built-in profile', async () => {
  const keep = process.env.RENAL_STATE_DIR;
  process.env.RENAL_STATE_DIR = fileUrlDataDir();
  const r = await save(full(), 'inrepo');
  assert.equal(r.ok, false);
  assert.equal((await getProfile({ patientId: 'demo' })).ok, false);
  process.env.RENAL_STATE_DIR = keep;

  const bad = await mkdtemp(join(tmpdir(), 'renal-corrupt-'));
  try {
    await writeFile(join(bad, 'profiles.json'), '{not json');
    process.env.RENAL_STATE_DIR = bad;
    const g = await getProfile({ patientId: 'demo' });
    assert.equal(g.ok, false);
    assert.notEqual(g.profile?.name, 'Sam');
    assert.equal((await getSavedProfile({ patientId: 'demo' })).ok, false);
    assert.equal((await save(full(), 'demo')).ok, false);
  } finally {
    process.env.RENAL_STATE_DIR = keep;
    await rm(bad, { recursive: true, force: true });
  }
});

function fileUrlDataDir() {
  return new URL('./data', import.meta.url).pathname;
}

test('no console output', async () => {
  const calls = [];
  const log = console.log;
  const err = console.error;
  console.log = (...a) => calls.push(a);
  console.error = (...a) => calls.push(a);
  try {
    await save(full(), 'quiet');
    await getProfile({ patientId: 'quiet' });
    await getSavedProfile({ patientId: 'quiet' });
    await save(full({ limits: { ...good, sodiumMg: 1 } }), 'quiet');
    await resetProfile({ patientId: 'quiet' });
  } finally {
    console.log = log;
    console.error = err;
  }
  assert.equal(calls.length, 0);
});

const FOUR = { sodiumMg: 2000, potassiumMg: 2500, phosphorusMg: 900, fluidMl: 1200 };
test('optional proteinG and carbsG validate, save and come back', async () => {
  const plain = await save({ limits: FOUR }, 'macro-a');
  assert.equal(plain.ok, true);
  assert.deepEqual(Object.keys(plain.saved.limits), ['sodiumMg', 'potassiumMg', 'phosphorusMg', 'fluidMl']);
  const nulls = await save({ limits: { ...FOUR, proteinG: null, carbsG: undefined } }, 'macro-b');
  assert.deepEqual(Object.keys(nulls.saved.limits), ['sodiumMg', 'potassiumMg', 'phosphorusMg', 'fluidMl']);
  const both = await save({ limits: { ...FOUR, proteinG: 60, carbsG: 200 } }, 'macro-c');
  assert.deepEqual(both.saved.limits, { ...FOUR, proteinG: 60, carbsG: 200 });
  assert.deepEqual((await getProfile({ patientId: 'macro-c' })).profile.limits, { ...FOUR, proteinG: 60, carbsG: 200 });
  assert.deepEqual((await getProfile({ patientId: 'macro-a' })).profile.limits, FOUR);
});
test('optional limits reject out-of-range values and unknown keys', async () => {
  for (const [k, v] of [['proteinG', 5], ['proteinG', 250], ['proteinG', 60.5], ['carbsG', 30], ['carbsG', 600], ['carbsG', '200']]) {
    const r = await save({ limits: { ...FOUR, [k]: v } }, 'macro-d');
    assert.deepEqual([r.ok, r.error, r.field], [false, 'limit out of range', k]);
  }
  assert.equal((await save({ limits: { ...FOUR, fatG: 50 } }, 'macro-d')).error, 'bad limits');
});
