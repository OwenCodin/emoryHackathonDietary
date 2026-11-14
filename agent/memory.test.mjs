import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_AGE_MS, PANTRY_MAX, mergePantry, matchPantry, cleanName, createMemory, defaultStateDir, safePatientId } from './memory.mjs';

const AGENT_DIR = fileURLToPath(new URL('.', import.meta.url));
let root, n = 0;
before(async () => { root = await mkdtemp(join(tmpdir(), 'memory-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

const fresh = () => join(root, `s${n++}`);
const clock = start => { const c = { t: start, now: () => c.t }; return c; };

describe('names and ids', () => {
  it('sanitises patient ids', () => {
    assert.equal(safePatientId('../../etc/passwd'), 'etcpasswd');
    assert.equal(safePatientId(''), 'default');
    assert.equal(safePatientId(42), 'default');
    assert.equal(safePatientId('a'.repeat(100)).length, 64);
    assert.equal(safePatientId('demo_1-x'), 'demo_1-x');
  });
  it('cleans names', () => {
    assert.equal(cleanName('  white   rice https://evil.example/x \u0007 '), 'white rice');
    assert.equal(cleanName('x'.repeat(200)).length, 80);
    assert.equal(cleanName(5), '');
  });
  it('defaultStateDir uses AGENT_STATE_DIR or the temp folder', () => {
    assert.equal(defaultStateDir({ AGENT_STATE_DIR: '/somewhere/else' }), '/somewhere/else');
    assert.equal(defaultStateDir({ AGENT_STATE_DIR: '' }), join(tmpdir(), 'renal-agent-state'));
  });
});

describe('store', () => {
  it('adds without case-insensitive duplicates', async () => {
    const m = createMemory({ dir: fresh() });
    const r = await m.add(['Rice', 'rice ', 'Broth']);
    assert.equal(r.ok, true);
    assert.deepEqual(r.state.needed, ['Rice', 'Broth']);
    const r2 = await m.add(['RICE']);
    assert.deepEqual(r2.added, []);
    assert.deepEqual((await m.load()).state.needed, ['Rice', 'Broth']);
  });
  it('marks items and moves them', async () => {
    const m = createMemory({ dir: fresh() });
    await m.add(['Rice', 'unsalted chicken broth']);
    const a = await m.mark('rice', 'approved');
    assert.equal(a.ok, true);
    assert.deepEqual(a.state.needed, ['unsalted chicken broth']);
    assert.deepEqual(a.state.approved, ['Rice']);
    const b = await m.mark('broth', 'rejected');
    assert.equal(b.name, 'unsalted chicken broth');
    assert.deepEqual(b.state.rejected, ['unsalted chicken broth']);
    assert.deepEqual(b.state.needed, []);
    const c = await m.mark('apple', 'approved');
    assert.deepEqual(c.state.approved, ['Rice', 'apple']);
    assert.deepEqual(await m.mark('', 'approved'), { ok: false, error: 'bad_item' });
    assert.deepEqual(await m.mark('x', 'maybe'), { ok: false, error: 'bad_item' });
  });
  it('expires after 2 hours with an injected clock', async () => {
    const dir = fresh();
    const c = clock(1_000_000);
    const m = createMemory({ dir, now: c.now });
    await m.add(['rice']);
    c.t += MAX_AGE_MS - 1;
    assert.deepEqual((await m.load()).state.needed, ['rice']);
    c.t = 1_000_000 + MAX_AGE_MS + 1;
    assert.deepEqual((await m.load()).state.needed, []);
    const r = await m.add(['beans']);
    assert.deepEqual(r.state.needed, ['beans']);
    assert.deepEqual(JSON.parse(await readFile(m.file, 'utf8')).needed, ['beans']);
  });
  it('treats corrupt, huge and wrongly shaped files as empty', async () => {
    for (const body of ['{not json', '[]', '{"needed":"x"}', 'x'.repeat(70 * 1024), '{"needed":[],"approved":[],"rejected":[]}']) {
      const dir = fresh();
      const m = createMemory({ dir });
      await m.load();
      await writeFile(m.file, body);
      const l = await m.load();
      assert.equal(l.ok, true);
      assert.deepEqual(l.state.needed, []);
      assert.equal((await m.add(['rice'])).ok, true);
    }
  });
  it('never follows a directory or symlink at the file path', async () => {
    const d1 = fresh();
    await mkdir(join(d1, 'demo.json'), { recursive: true });
    assert.deepEqual((await createMemory({ dir: d1 }).load()).state.needed, []);
    const d2 = fresh();
    await mkdir(d2, { mode: 0o700 });
    const target = join(root, 'target.json');
    await writeFile(target, JSON.stringify({ needed: ['secret'], approved: [], rejected: [], updatedAt: Date.now() }));
    await symlink(target, join(d2, 'demo.json'));
    assert.deepEqual((await createMemory({ dir: d2 }).load()).state.needed, []);
  });
  it('keeps the file inside the folder, mode 600, folder 700', async () => {
    const dir = fresh();
    const m = createMemory({ patientId: '../../etc/passwd', dir });
    await m.add(['rice']);
    assert.deepEqual((await readdir(dir)).sort(), ['etcpasswd.json']);
    assert.equal((await stat(join(dir, 'etcpasswd.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.equal(createMemory({ patientId: '', dir: fresh() }).file.endsWith('default.json'), true);
  });
  it('tightens a group or world writable folder to 700', async () => {
    const dir = fresh();
    await mkdir(dir);
    await chmod(dir, 0o777);
    const m = createMemory({ dir });
    assert.equal((await m.add(['rice'])).ok, true);
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
  });
  it('refuses a folder inside the repo and a symlink that leads there', async () => {
    const before = (await readdir(AGENT_DIR)).sort();
    const m = createMemory({ dir: AGENT_DIR });
    assert.deepEqual(await m.load(), { ok: false, error: 'unavailable' });
    assert.deepEqual(await m.add(['rice']), { ok: false, error: 'unavailable' });
    const link = join(root, 'link-to-repo');
    await symlink(AGENT_DIR, link);
    assert.deepEqual(await createMemory({ dir: link }).load(), { ok: false, error: 'unavailable' });
    assert.deepEqual((await readdir(AGENT_DIR)).sort(), before);
  });
  it('stores only the five keys with cleaned, capped names', async () => {
    const m = createMemory({ dir: fresh() });
    const many = Array.from({ length: 60 }, (_, i) => `item ${i}`);
    const r = await m.add(['  ', 'x'.repeat(200), 'see https://a.example/b now', ...many]);
    assert.equal(r.state.needed.length, 50);
    assert.ok(r.skipped >= 10);
    assert.ok(r.state.needed.every(s => s.length <= 80 && !s.includes('http')));
    assert.deepEqual(Object.keys(JSON.parse(await readFile(m.file, 'utf8'))).sort(), ['approved', 'needed', 'pantry', 'rejected', 'updatedAt']);
  });
  it('keeps two quick adds', async () => {
    const m = createMemory({ dir: fresh() });
    await Promise.all([m.add(['a1']), m.add(['b2']), m.mark('c3', 'approved')]);
    const s = (await m.load()).state;
    assert.deepEqual([...s.needed].sort(), ['a1', 'b2']);
    assert.deepEqual(s.approved, ['c3']);
  });
});

describe('pantry', () => {
  it('adds without duplicates across shots', async () => {
    const m = createMemory({ dir: fresh() });
    await m.addPantry(['Rice', 'rice ', 'Eggs']);
    const r = await m.addPantry(['EGGS', 'apples']);
    assert.equal(r.ok, true);
    assert.deepEqual(r.state.pantry, ['Rice', 'Eggs', 'apples']);
    assert.deepEqual(r.added, ['apples']);
  });
  it('caps at 40 and drops the oldest', async () => {
    const m = createMemory({ dir: fresh() });
    await m.addPantry(Array.from({ length: 40 }, (_, i) => `food ${i}`));
    const r = await m.addPantry(['newest']);
    assert.equal(PANTRY_MAX, 40);
    assert.equal(r.state.pantry.length, 40);
    assert.equal(r.state.pantry.at(-1), 'newest');
    assert.deepEqual(r.dropped, ['food 0']);
  });
  it('removes by exact and substring match, reports not found', async () => {
    const m = createMemory({ dir: fresh() });
    await m.addPantry(['Rice', 'apples', 'milk']);
    const r = await m.removePantry(['rice', 'apple', 'zzzz']);
    assert.deepEqual(r.removed, ['Rice', 'apples']);
    assert.deepEqual(r.notFound, ['zzzz']);
    assert.deepEqual(r.state.pantry, ['milk']);
  });
  it('clearPantry leaves the shopping list alone', async () => {
    const m = createMemory({ dir: fresh() });
    await m.add(['broth']);
    await m.addPantry(['rice']);
    const r = await m.clearPantry();
    assert.deepEqual(r.state.pantry, []);
    assert.deepEqual(r.state.needed, ['broth']);
  });
  it('an old file without pantry loads; a bad pantry reads as empty', async () => {
    const d = fresh();
    const m = createMemory({ dir: d });
    await m.add(['broth']);
    const old = JSON.parse(await readFile(m.file, 'utf8'));
    delete old.pantry;
    await writeFile(m.file, JSON.stringify(old), { mode: 0o600 });
    const s = (await m.load()).state;
    assert.deepEqual(s.needed, ['broth']);
    assert.deepEqual(s.pantry, []);
    await writeFile(m.file, JSON.stringify({ ...old, pantry: 'rice' }), { mode: 0o600 });
    assert.deepEqual((await m.load()).state.needed, []);
  });
  it('expires with the same rule and cleans names', async () => {
    const c = clock(1_000_000);
    const m = createMemory({ dir: fresh(), now: c.now });
    await m.addPantry(['see https://a.example/x rice', 'y'.repeat(200)]);
    let s = (await m.load()).state;
    assert.equal(s.pantry[0], 'see rice');
    assert.ok(s.pantry.every(x => x.length <= 80 && !x.includes('http')));
    c.t += MAX_AGE_MS + 1;
    s = (await m.load()).state;
    assert.deepEqual(s.pantry, []);
  });
  it('pure helpers', () => {
    assert.deepEqual(mergePantry(['a1'], ['A1', 'b2']).list, ['a1', 'b2']);
    assert.deepEqual(matchPantry(['Brown rice', 'egg'], 'rice'), ['Brown rice']);
    assert.deepEqual(matchPantry(['Brown rice', 'egg'], 'eg'), []);
  });
});

describe('preferences', () => {
  it('saves, loads, merges and does not expire', async () => {
    const c = clock(1000000);
    const dir = fresh();
    const m = createMemory({ dir, now: c.now });
    assert.deepEqual((await m.loadPreferences()).prefs, { voice: 'Puck', replyStyle: 'brief', language: 'en', name: null });
    assert.equal((await m.savePreferences({ voice: 'Sulafat', replyStyle: 'detailed', language: 'es', name: 'Ana' })).ok, true);
    await m.savePreferences({ voice: 'Kore' });
    c.t += MAX_AGE_MS * 5;
    assert.deepEqual((await m.loadPreferences()).prefs, { voice: 'Kore', replyStyle: 'detailed', language: 'es', name: 'Ana' });
    assert.equal((await stat(m.prefsFile)).mode & 0o777, 0o600);
  });
  it('a tampered file loads as defaults', async () => {
    const dir = fresh();
    const m = createMemory({ dir });
    await m.savePreferences({ voice: 'Kore' });
    await writeFile(m.prefsFile, JSON.stringify({ voice: 'Evil', replyStyle: 'loud', language: 'fr', name: 'x'.repeat(200) }));
    assert.deepEqual((await m.loadPreferences()).prefs, { voice: 'Puck', replyStyle: 'brief', language: 'en', name: null });
  });
  it('reset deletes only the preferences file', async () => {
    const dir = fresh();
    const m = createMemory({ dir });
    await m.add(['rice']);
    await m.savePreferences({ voice: 'Kore' });
    assert.deepEqual(await m.resetPreferences(), { ok: true, removed: true });
    assert.deepEqual(await m.resetPreferences(), { ok: true, removed: false });
    assert.deepEqual((await m.load()).state.needed, ['rice']);
    assert.equal((await m.loadPreferences()).prefs.voice, 'Puck');
  });
  it('preference writes leave the shopping state untouched', async () => {
    const dir = fresh();
    const m = createMemory({ dir });
    await m.add(['rice']);
    const before = await readFile(m.file, 'utf8');
    await m.savePreferences({ voice: 'Kore' });
    assert.equal(await readFile(m.file, 'utf8'), before);
  });
});
