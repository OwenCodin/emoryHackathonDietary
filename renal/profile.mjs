import { errorResult, normalizeFoodName, readData } from './data.mjs';

export async function getProfile(input = {}) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'profile request must be an object' };
    }
    const patientId = input?.patientId ?? 'demo';
    if (typeof patientId !== 'string' || !patientId.trim()) {
      return { ok: false, error: 'patientId is required' };
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
      },
    };
  } catch (error) {
    return errorResult(error, 'could not read patient profile');
  }
}
