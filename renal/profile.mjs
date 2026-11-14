import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorResult, normalizeFoodName, readData } from './data.mjs';

// Sanity bounds for what a caller reads out in setup. They catch misheard numbers and typos; they are NOT medical
// advice and never replace the patient's care team.
export const LIMIT_BOUNDS = Object.freeze({
  sodiumMg: Object.freeze([500, 4000]),
  potassiumMg: Object.freeze([1000, 4700]),
  phosphorusMg: Object.freeze([500, 1500]),
  fluidMl: Object.freeze([500, 4000]),
});
export const CONDITIONS = Object.freeze(['ckd', 'hemodialysis', 'peritoneal_dialysis', 'transplant', 'unsure']);
export const MAX_AVOID = 10;
export const PATIENT_SET_BY = 'patient, as told by their care team';

const LIMIT_KEYS = ['sodiumMg', 'potassiumMg', 'phosphorusMg', 'fluidMl'];
const FILE_NAME = 'profiles.json';
const MAX_FILE_BYTES = 65536;
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// Health information never lives inside the repository. Read at call time so tests can point it at a temp folder.
function profileDir() {
  const set = process.env.RENAL_STATE_DIR;
  return typeof set === 'string' && set.trim() ? resolve(set) : join(tmpdir(), 'renal-state');
}

// Returns false when the folder does not exist yet (read only); throws when the folder is not acceptable.
async function checkDir(dir, create) {
  if (isInside(REPO_ROOT, dir)) throw new Error('refused');
  if (create) await mkdir(dir, { recursive: true, mode: 0o700 });
  let st;
  try {
    st = await lstat(dir);
  } catch (error) {
    if (!create && error?.code === 'ENOENT') return false;
    throw error;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('refused');
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error('refused');
  if (isInside(REPO_ROOT, await realpath(dir))) throw new Error('refused');
  if (create && (st.mode & 0o777) !== 0o700) await chmod(dir, 0o700);
  return true;
}

const emptyStore = () => ({ version: 1, patients: {} });

async function readStore() {
  const dir = profileDir();
  if (!(await checkDir(dir, false))) return emptyStore();
  const file = join(dir, FILE_NAME);
  let st;
  try {
    st = await lstat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore();
    throw error;
  }
  if (!st.isFile() || st.size > MAX_FILE_BYTES) throw new Error('unreadable');
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1
    || !data.patients || typeof data.patients !== 'object' || Array.isArray(data.patients)) {
    throw new Error('unreadable');
  }
  return data;
}

// All writes go through one chain so two saves never interleave their read-modify-write.
let chain = Promise.resolve();
const serial = (work) => {
  const run = chain.then(work, work);
  chain = run.then(() => {}, () => {});
  return run;
};

async function writeStore(store) {
  const dir = profileDir();
  await checkDir(dir, true);
  const tmp = join(dir, `.profiles.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(store)}\n`, { mode: 0o600, flag: 'wx' });
    await rename(tmp, join(dir, FILE_NAME));
  } catch (error) {
    try { await unlink(tmp); } catch { /* nothing to remove */ }
    throw error;
  }
}

function patientKey(patientId) {
  const id = patientId === undefined || patientId === null ? 'demo' : patientId;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

function cleanPersonName(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns { ok: true, value } or { ok: false, error, field? }. Errors are fixed strings and never echo input.
function validate(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { ok: false, error: 'profile must be an object' };

  let name = null;
  if (profile.name !== null && profile.name !== undefined) {
    if (typeof profile.name !== 'string') return { ok: false, error: 'bad name', field: 'name' };
    name = cleanPersonName(profile.name);
    if (name.length > 40 || !/\p{L}/u.test(name)) return { ok: false, error: 'bad name', field: 'name' };
  }

  let condition = null;
  if (profile.condition !== null && profile.condition !== undefined) {
    if (!CONDITIONS.includes(profile.condition)) return { ok: false, error: 'bad condition', field: 'condition' };
    condition = profile.condition;
  }

  let limits = null;
  if (profile.limits !== null && profile.limits !== undefined) {
    const l = profile.limits;
    if (typeof l !== 'object' || Array.isArray(l)) return { ok: false, error: 'bad limits', field: 'limits' };
    if (Object.keys(l).some((k) => !LIMIT_KEYS.includes(k))) return { ok: false, error: 'bad limits', field: 'limits' };
    for (const key of LIMIT_KEYS) {
      const v = l[key];
      const [min, max] = LIMIT_BOUNDS[key];
      if (!Number.isInteger(v) || v < min || v > max) return { ok: false, error: 'limit out of range', field: key };
    }
    limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, l[k]]));
  }

  const avoid = [];
  if (profile.avoid !== null && profile.avoid !== undefined) {
    if (!Array.isArray(profile.avoid) || profile.avoid.length > MAX_AVOID) return { ok: false, error: 'bad avoid list', field: 'avoid' };
    const seen = new Set();
    for (const raw of profile.avoid) {
      if (typeof raw !== 'string') return { ok: false, error: 'bad avoid list', field: 'avoid' };
      const food = normalizeFoodName(raw);
      if (!food) continue;
      if (food.length < 2 || food.length > 40) return { ok: false, error: 'bad avoid list', field: 'avoid' };
      if (!seen.has(food)) { seen.add(food); avoid.push(food); }
    }
  }

  const setupDone = profile.setupDone === undefined || profile.setupDone === null ? false : profile.setupDone;
  if (typeof setupDone !== 'boolean') return { ok: false, error: 'bad setupDone', field: 'setupDone' };

  return { ok: true, value: { name, condition, limits, avoid, setupDone } };
}

export async function saveProfile(input = {}) {
  try {
    const id = patientKey(input?.patientId);
    if (!id) return { ok: false, error: 'patientId is required' };
    const checked = validate(input?.profile);
    if (!checked.ok) return checked;
    const saved = {
      id,
      ...checked.value,
      setBy: PATIENT_SET_BY,
      setOn: new Date().toISOString().slice(0, 10),
    };
    return await serial(async () => {
      try {
        // A corrupt store is never overwritten silently: the save is refused instead.
        const store = await readStore();
        store.patients[id] = saved;
        await writeStore(store);
        return { ok: true, saved };
      } catch {
        return { ok: false, error: 'profile store unavailable' };
      }
    });
  } catch {
    return { ok: false, error: 'profile store unavailable' };
  }
}

export async function getSavedProfile(input = {}) {
  try {
    const id = patientKey(input?.patientId);
    if (!id) return { ok: false, error: 'patientId is required' };
    const store = await readStore();
    const saved = Object.hasOwn(store.patients, id) ? store.patients[id] : null;
    return { ok: true, saved: saved && typeof saved === 'object' ? { ...saved } : null };
  } catch {
    return { ok: false, error: 'profile store unreadable' };
  }
}

export async function resetProfile(input = {}) {
  try {
    const id = patientKey(input?.patientId);
    if (!id) return { ok: false, error: 'patientId is required' };
    return await serial(async () => {
      try {
        const store = await readStore();
        if (!Object.hasOwn(store.patients, id)) return { ok: true, removed: false };
        delete store.patients[id];
        await writeStore(store);
        return { ok: true, removed: true };
      } catch {
        return { ok: false, error: 'profile store unavailable' };
      }
    });
  } catch {
    return { ok: false, error: 'profile store unavailable' };
  }
}

export async function getProfile(input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'profile request must be an object' };
    }
    const patientId = input?.patientId ?? 'demo';
    if (typeof patientId !== 'string' || !patientId.trim()) {
      return { ok: false, error: 'patientId is required' };
    }

    // A saved profile wins. A store that cannot be read never falls back to the built-in limits (someone else's).
    const key = patientKey(patientId);
    if (key) {
      let store;
      try { store = await readStore(); } catch { return { ok: false, error: 'profile store unreadable' }; }
      const saved = Object.hasOwn(store.patients, key) ? store.patients[key] : null;
      if (saved && typeof saved === 'object') {
        if (!saved.limits) return { ok: false, error: 'limits not set', limitsNeeded: true };
        return {
          ok: true,
          profile: {
            id: saved.id,
            name: saved.name ?? '',
            condition: saved.condition ?? null,
            limits: { ...saved.limits },
            avoid: Array.isArray(saved.avoid) ? saved.avoid.map(normalizeFoodName) : [],
            setBy: saved.setBy,
            setOn: saved.setOn,
            setupDone: saved.setupDone === true,
            source: 'patient',
            limitsNote: 'These limits are what the patient told us their care team gave them.',
          },
        };
      }
    }

    const patients = await readData('patients.json');
    const profile = patients[patientId.trim()];
    if (!profile) return { ok: false, error: 'patient not found' };
    if (!profile.limits || !Array.isArray(profile.avoid)) {
      return { ok: false, error: 'patient profile is invalid' };
    }

    return {
      ok: true,
      profile: {
        ...profile,
        avoid: profile.avoid.map(normalizeFoodName),
        limits: { ...profile.limits },
        source: 'builtin',
      },
    };
  } catch (error) {
    return errorResult(error, 'could not read patient profile');
  }
}
