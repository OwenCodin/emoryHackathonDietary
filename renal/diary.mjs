import { errorResult, isFiniteNonNegative, readData, writeData } from './data.mjs';
import { getProfile } from './profile.mjs';

const NUTRIENT_KEYS = ['sodiumMg', 'potassiumMg', 'phosphorusMg'];
let pendingWrite = Promise.resolve();

async function readDiary() {
  try {
    return await readData('diary.json');
  } catch (error) {
    if (error?.code === 'ENOENT') return { days: {} };
    throw error;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function validVerdict(verdict) {
  return verdict && verdict.ok === true && typeof verdict.food === 'string' &&
    typeof verdict.verdict === 'string' &&
    (verdict.nutrients == null || (typeof verdict.nutrients === 'object' &&
      NUTRIENT_KEYS.every((key) => verdict.nutrients[key] == null || isFiniteNonNegative(verdict.nutrients[key]))));
}

function enqueueWrite(update) {
  const next = pendingWrite.then(update, update);
  pendingWrite = next.catch(() => {});
  return next;
}

export async function logFood(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'diary request must be an object' };
  }
  const patientId = input?.patientId ?? 'demo';
  const verdict = input?.verdict;
  if (typeof patientId !== 'string' || !patientId.trim()) return { ok: false, error: 'patientId is required' };
  if (!validVerdict(verdict)) return { ok: false, error: 'a valid food verdict is required' };

  try {
    await enqueueWrite(async () => {
      const diary = await readDiary();
      const day = todayKey();
      diary.days ??= {};
      diary.days[day] ??= {};
      diary.days[day][patientId] ??= [];
      diary.days[day][patientId].push({
        food: verdict.food,
        verdict: verdict.verdict,
        portion: verdict.portion ?? 'unknown',
        nutrients: verdict.nutrients ?? null,
        loggedAt: new Date().toISOString(),
      });
      await writeData('diary.json', diary);
    });
    return { ok: true };
  } catch (error) {
    return errorResult(error, 'could not save food diary');
  }
}

export async function getToday(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'diary request must be an object' };
  }
  const patientId = input?.patientId ?? 'demo';
  if (typeof patientId !== 'string' || !patientId.trim()) return { ok: false, error: 'patientId is required' };
  try {
    await pendingWrite;
    const diary = await readDiary();
    const items = diary.days?.[todayKey()]?.[patientId] ?? [];
    const totals = Object.fromEntries(NUTRIENT_KEYS.map((key) => [
      key,
      items.reduce((sum, item) => sum + (item.nutrients?.[key] ?? 0), 0),
    ]));
    const got = await getProfile({ patientId });
    if (!got.ok) {
      return got.limitsNeeded ? { ok: false, error: 'limits not set', limitsNeeded: true } : { ok: false, error: 'patient not found' };
    }
    const limits = got.profile.limits;
    const remaining = Object.fromEntries(NUTRIENT_KEYS.map((key) => [key, limits[key] - totals[key]]));
    return { ok: true, totals, remaining, items };
  } catch (error) {
    return errorResult(error, 'could not read food diary');
  }
}
