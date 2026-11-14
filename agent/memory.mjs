// A small per-patient shopping list kept between calls. Each call is its own process, so the list lives in one
// JSON file per patient. Only food and product names are stored (needed, approved, rejected, updatedAt): no phone
// numbers, limits or transcripts. A sibling file also holds the voice, reply length, language and preferred name
// chosen in setup (allow-listed values only, never limits). The folder is never inside the repository, and
// nothing here ever throws.
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanPreferences } from './prefs.mjs';

export const MAX_AGE_MS = 7200000; // 2 hours
export const MAX_ITEMS = 50;
export const PANTRY_MAX = 40;
const MAX_FILE_BYTES = 65536;
const MAX_PREFS_BYTES = 4096;
const MAX_FUTURE_MS = 60000;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

export function safePatientId(id) {
  const kept = typeof id === 'string' ? id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) : '';
  return kept || 'default';
}

export function cleanName(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function defaultStateDir(env = process.env) {
  const set = env?.AGENT_STATE_DIR;
  return typeof set === 'string' && set.trim() ? resolve(set) : join(tmpdir(), 'renal-agent-state');
}

const emptyState = () => ({ needed: [], approved: [], rejected: [], pantry: [], updatedAt: null });

// Pure helper shared with tools.mjs: adds cleaned names to a pantry list without case-insensitive duplicates;
// when full, the oldest entry is dropped so the newest shot always counts.
export function mergePantry(list, names, max = PANTRY_MAX) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = cleanName(raw);
    if (name && !seen.has(name.toLowerCase())) { seen.add(name.toLowerCase()); out.push(name); }
  }
  const added = [];
  const dropped = [];
  for (const raw of Array.isArray(names) ? names : []) {
    const name = cleanName(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    while (out.length >= max && out.length > 0) {
      const old = out.shift();
      seen.delete(old.toLowerCase());
      dropped.push(old);
    }
    seen.add(key);
    out.push(name);
    added.push(name);
  }
  return { list: out, added, dropped };
}

// Stored names that match one wanted name: exact (case-insensitive) first, else containment with >= 3 characters each.
export function matchPantry(list, wanted) {
  const w = cleanName(wanted).toLowerCase();
  const items = Array.isArray(list) ? list : [];
  if (!w) return [];
  const exact = items.filter(x => String(x).toLowerCase() === w);
  if (exact.length) return exact;
  if (w.length < 3) return [];
  return items.filter(x => { const l = String(x).toLowerCase(); return l.length >= 3 && (l.includes(w) || w.includes(l)); });
}

// Cleaned, case-insensitively de-duplicated, capped list.
function cleanList(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const name = cleanName(raw);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

export function createMemory({ patientId = 'demo', dir = defaultStateDir(), now = () => Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  const folder = resolve(dir);
  const id = safePatientId(patientId);
  const file = join(folder, `${id}.json`);
  let folderOk = null; // cached answer of the one-time folder check
  let refusedLogged = false;
  let chain = Promise.resolve();

  const refuse = () => {
    if (!refusedLogged) { refusedLogged = true; try { console.error('[agent] state folder refused'); } catch { /* ignore */ } }
    return false;
  };

  async function checkFolder() {
    if (folderOk !== null) return folderOk;
    try {
      if (isInside(REPO_ROOT, folder)) { folderOk = refuse(); return folderOk; }
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const st = await lstat(folder);
      if (!st.isDirectory() || st.isSymbolicLink()) { folderOk = refuse(); return folderOk; }
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) { folderOk = refuse(); return folderOk; }
      if (isInside(REPO_ROOT, await realpath(folder))) { folderOk = refuse(); return folderOk; }
      if ((st.mode & 0o777) !== 0o700) await chmod(folder, 0o700);
      folderOk = true;
    } catch {
      folderOk = refuse();
    }
    return folderOk;
  }

  // Never throws: any trouble reading gives an empty state.
  async function readState() {
    try {
      const st = await lstat(file);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) return emptyState();
      const data = JSON.parse(await readFile(file, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) return emptyState();
      for (const key of ['needed', 'approved', 'rejected']) if (!Array.isArray(data[key])) return emptyState();
      const at = data.updatedAt;
      if (!Number.isFinite(at)) return emptyState();
      const t = now();
      if (t - at > maxAgeMs || at - t > MAX_FUTURE_MS) return emptyState();
      if (data.pantry !== undefined && !Array.isArray(data.pantry)) return emptyState();
      return { needed: cleanList(data.needed), approved: cleanList(data.approved), rejected: cleanList(data.rejected), pantry: mergePantry([], data.pantry ?? []).list, updatedAt: at };
    } catch {
      return emptyState();
    }
  }

  async function writeState(state) {
    const body = { needed: cleanList(state.needed), approved: cleanList(state.approved), rejected: cleanList(state.rejected), pantry: mergePantry([], state.pantry ?? []).list, updatedAt: now() };
    const tmp = join(folder, `.${id}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(body), { mode: 0o600, flag: 'wx' });
      await rename(tmp, file);
      return { ok: true, state: body };
    } catch {
      try { await unlink(tmp); } catch { /* nothing to remove */ }
      return { ok: false, error: 'unavailable' };
    }
  }

  const serial = work => {
    const run = chain.then(work, work);
    chain = run.then(() => {}, () => {});
    return run;
  };

  const findIndex = (list, name) => list.findIndex(x => x.toLowerCase() === name.toLowerCase());

  // Preferences: a sibling file that never expires. Only allow-listed values are written or read back.
  const prefsFile = join(folder, `${id}.prefs.json`);
  async function readPrefs() {
    try {
      const st = await lstat(prefsFile);
      if (!st.isFile() || st.size > MAX_PREFS_BYTES) return cleanPreferences(null);
      return cleanPreferences(JSON.parse(await readFile(prefsFile, 'utf8')));
    } catch {
      return cleanPreferences(null);
    }
  }
  async function writePrefs(prefs) {
    const body = cleanPreferences(prefs);
    const tmp = join(folder, `.${id}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, JSON.stringify(body), { mode: 0o600, flag: 'wx' });
      await rename(tmp, prefsFile);
      return { ok: true, prefs: body };
    } catch {
      try { await unlink(tmp); } catch { /* nothing to remove */ }
      return { ok: false, error: 'unavailable' };
    }
  }

  return {
    file,
    prefsFile,
    async loadPreferences() {
      try {
        if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
        return { ok: true, prefs: await readPrefs() };
      } catch { return { ok: false, error: 'unavailable' }; }
    },
    savePreferences(partial) {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const have = await readPrefs();
          const given = partial && typeof partial === 'object' ? partial : {};
          const merged = { ...have };
          for (const key of ['voice', 'replyStyle', 'language', 'name']) if (Object.hasOwn(given, key)) merged[key] = given[key];
          return await writePrefs(merged);
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    resetPreferences() {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          try { await unlink(prefsFile); return { ok: true, removed: true }; }
          catch (error) { return error?.code === 'ENOENT' ? { ok: true, removed: false } : { ok: false, error: 'unavailable' }; }
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    async load() {
      try {
        if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
        return { ok: true, state: await readState() };
      } catch { return { ok: false, error: 'unavailable' }; }
    },
    add(names) {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const state = await readState();
          const added = [];
          let skipped = 0;
          for (const raw of Array.isArray(names) ? names : []) {
            const name = cleanName(raw);
            if (!name) { skipped++; continue; }
            if (findIndex(state.needed, name) !== -1) continue;
            if (state.needed.length >= MAX_ITEMS) { skipped++; continue; }
            state.needed.push(name);
            added.push(name);
          }
          const w = await writeState(state);
          if (!w.ok) return w;
          return { ok: true, added, skipped, state: w.state };
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    addPantry(names) {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const state = await readState();
          const m = mergePantry(state.pantry, names);
          state.pantry = m.list;
          const w = await writeState(state);
          if (!w.ok) return w;
          return { ok: true, added: m.added, dropped: m.dropped, state: w.state };
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    removePantry(names) {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const state = await readState();
          const removed = [];
          const notFound = [];
          for (const raw of Array.isArray(names) ? names : []) {
            const hits = matchPantry(state.pantry, raw);
            if (!hits.length) { notFound.push(cleanName(raw)); continue; }
            for (const h of hits) if (!removed.includes(h)) removed.push(h);
            state.pantry = state.pantry.filter(x => !hits.includes(x));
          }
          const w = await writeState(state);
          if (!w.ok) return w;
          return { ok: true, removed, notFound, state: w.state };
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    clearPantry() {
      return serial(async () => {
        try {
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const state = await readState();
          state.pantry = [];
          const w = await writeState(state);
          if (!w.ok) return w;
          return { ok: true, state: w.state };
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
    mark(name, status) {
      return serial(async () => {
        try {
          const wanted = cleanName(name);
          if (!wanted || (status !== 'approved' && status !== 'rejected')) return { ok: false, error: 'bad_item' };
          if (!(await checkFolder())) return { ok: false, error: 'unavailable' };
          const state = await readState();
          let stored = null;
          for (const key of ['needed', 'approved', 'rejected']) {
            const i = findIndex(state[key], wanted);
            if (i !== -1) { stored = state[key][i]; break; }
          }
          if (stored === null && wanted.length >= 3) {
            const lw = wanted.toLowerCase();
            stored = state.needed.find(x => x.length >= 3 && (x.toLowerCase().includes(lw) || lw.includes(x.toLowerCase()))) ?? null;
          }
          if (stored === null) stored = wanted;
          for (const key of ['needed', 'approved', 'rejected']) {
            state[key] = state[key].filter(x => x.toLowerCase() !== stored.toLowerCase());
          }
          if (state[status].length >= MAX_ITEMS) state[status].shift();
          state[status].push(stored);
          const w = await writeState(state);
          if (!w.ok) return w;
          return { ok: true, name: stored, status, state: w.state };
        } catch { return { ok: false, error: 'unavailable' }; }
      });
    },
  };
}
