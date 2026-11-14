import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, afterEach, beforeEach } from 'node:test';

const stateDir = await mkdtemp(join(tmpdir(), 'renal-lookup-state-'));
process.env.RENAL_STATE_DIR = stateDir;
const { lookupFood } = await import('./nutrients.mjs');

after(async () => {
  delete process.env.RENAL_STATE_DIR;
  await rm(stateDir, { recursive: true, force: true });
});

const saved = {};
let fetchCalls = 0;
beforeEach(() => {
  saved.fetch = globalThis.fetch;
  saved.usda = process.env.USDA_API_KEY;
  saved.google = process.env.GOOGLE_API_KEY;
  delete process.env.USDA_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('network must not be used');
  };
});
afterEach(() => {
  globalThis.fetch = saved.fetch;
  if (saved.usda === undefined) delete process.env.USDA_API_KEY;
  else process.env.USDA_API_KEY = saved.usda;
  if (saved.google === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = saved.google;
});

test('generic fallback: a brand-qualified lettuce resolves to the lettuce seed with no network', async () => {
  const result = await lookupFood({ name: 'Local Bounti Crispy Green Leaf lettuce' });
  assert.equal(result.ok, true);
  assert.equal(result.found, true);
  assert.equal(result.matched, 'seed');
  assert.equal(result.name, 'lettuce');
  assert.equal(result.genericFrom, 'Local Bounti Crispy Green Leaf lettuce');
  assert.equal(fetchCalls, 0);
});

test('generic fallback: plural forms resolve', async () => {
  const result = await lookupFood({ name: 'crisp iceberg lettuces' });
  assert.equal(result.found, true);
  assert.equal(result.name, 'lettuce');
});

test('generic fallback: unknown multi-word names do not match a seed', async () => {
  const result = await lookupFood({ name: 'Local Bounti Spring Mix' });
  assert.deepEqual({ ok: result.ok, found: result.found }, { ok: true, found: false });
});

test('generic fallback never reduces risky or compound names', async () => {
  for (const name of ['pina colada', 'coconut water', 'chocolate milk', 'smoked salmon', 'oat milk', 'banana milk', 'star fruit juice', 'canned tomato soup']) {
    const result = await lookupFood({ name });
    assert.equal(result.found, false, name);
    assert.equal(result.genericFrom, undefined, name);
  }
});

test('generic fallback: a single unknown word has no generic step', async () => {
  const result = await lookupFood({ name: 'zzyzx' });
  assert.equal(result.found, false);
});
