// For demos: forgets the saved profile and the saved voice/style choices for one patient, so first-call setup
// runs again on the next call. Usage: node --env-file-if-exists=.env.local agent/sim/reset-setup.mjs [patientId]
// Prints only two booleans, never a profile value.
import { resetProfile } from '../../renal/index.mjs';
import { createMemory } from '../memory.mjs';

const patientId = process.argv[2] || 'demo';
const profile = await resetProfile({ patientId });
const prefs = await createMemory({ patientId }).resetPreferences();
console.log(`[reset] profile removed=${profile.removed === true} preferences removed=${prefs.removed === true}`);
if (profile.ok !== true || prefs.ok !== true) process.exitCode = 1;
