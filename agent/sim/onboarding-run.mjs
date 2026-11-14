// Developer check, not part of npm test: drives the first-call setup tools in order with sample answers, against
// the real renal profile store and the real preferences file, both in throwaway folders. No network, no keys.
// Prints what was stored and an estimate of how long the spoken setup takes. Run: node agent/sim/onboarding-run.mjs
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const renalDir = await mkdtemp(join(tmpdir(), 'onboarding-run-'));
const prefsDir = await mkdtemp(join(tmpdir(), 'onboarding-run-prefs-'));
process.env.RENAL_STATE_DIR = renalDir;
globalThis.fetch = async () => { throw new Error('network is not available in this run'); };

let failed = false;
try {
  const renal = await import('../../renal/index.mjs');
  const { buildTools, setupStatus } = await import('../tools.mjs');
  const { createMemory } = await import('../memory.mjs');
  const { SETUP_STEPS } = await import('../prompt.mjs');
  const { realtimeOptions } = await import('../prefs.mjs');
  const { makeFakeActions } = await import('../fake-modules.mjs');

  const memory = createMemory({ patientId: 'demo', dir: prefsDir });
  const clock = { t: Date.now() };
  // Fake actions: the sign-in reads as connected only after the link was made (the patient tapping it), and no text is sent.
  const PHONE = '+15555550100';
  const texts = [];
  let linkMade = false;
  const actions = {
    ...makeFakeActions(),
    async getKrogerStatus() { return { ok: true, configured: true, relay: true, connected: linkMade, pending: false }; },
    async startKrogerSignIn() { linkMade = true; return { ok: true, link: `https://relay.example/k/${'A'.repeat(43)}` }; },
    async sendText(msg) { texts.push(msg); return { ok: true }; },
  };
  const tools = buildTools({ camera: null, patientId: 'demo', renal, memory, actions, phone: PHONE, setupDue: true, now: () => clock.t, callerHeardAfter: () => true, timeoutMs: 5000 });

  console.log('setupStatus before:', JSON.stringify(await setupStatus({ patientId: 'demo', renal })));
  const said = [];
  let turns = 0;
  const step = async (name, args, expectOk = true) => {
    const r = await tools[name].execute(args);
    turns++;
    if (r.say) said.push(r.say);
    console.log(`${name}: ok=${r.ok}${r.error ? ` error=${r.error}` : ''}${r.say ? ` say="${r.say}"` : ''}`);
    if ((r.ok === true) !== expectOk) { failed = true; console.log('  ^ unexpected result'); }
    return r;
  };

  await step('save_profile_basics', { name: 'Ana', condition: 'hemodialysis' });
  await step('propose_limits', { sodium_mg: 2000, potassium_mg: 2000, phosphorus_mg: 1000, fluid_ml: 1000 });
  await step('propose_limits', { sodium_mg: 2000, potassium_mg: 9000, phosphorus_mg: 1000, fluid_ml: 1000 }, false);
  await step('propose_limits', { sodium_mg: 2000, potassium_mg: 2000, phosphorus_mg: 1000, fluid_ml: 1000 });
  clock.t += 3000;
  await step('confirm_limits', { sodium_mg: 2000, potassium_mg: 2000, phosphorus_mg: 1000, fluid_ml: 1000 });
  await step('set_avoid_foods', { foods: ['grapefruit'] });
  await step('set_preferences', { voice: 'warm', reply_style: 'brief', language: 'english' });
  await step('kroger_status', {});
  await step('text_kroger_sign_in', {});
  if (texts.length !== 1 || texts[0].phone !== PHONE || !texts[0].text.includes('https://relay.example/k/')) { failed = true; console.log('  ^ the sign-in text was not sent once to the patient phone with the link'); }
  await step('finish_onboarding', {});

  const got = await renal.getProfile({ patientId: 'demo' });
  console.log('stored profile:', JSON.stringify(got));
  if (!got.ok || got.profile.setBy !== 'patient, as told by their care team') failed = true;
  const prefs = await memory.loadPreferences();
  console.log('stored preferences:', JSON.stringify(prefs));
  if (!prefs.ok || prefs.prefs.voice !== 'Sulafat') failed = true;
  const after = await setupStatus({ patientId: 'demo', renal });
  console.log('setupStatus after:', JSON.stringify(after));
  if (after.needsSetup !== false) failed = true;
  console.log('RealtimeModel options on the next call:', JSON.stringify(realtimeOptions({ model: 'MODEL', prefs: prefs.prefs })));

  // Spoken length: the agent's script lines plus the tool sentences it reads out, the caller's sample answers,
  // and a model latency per turn.
  const count = text => text.split(/\s+/).filter(Boolean).length;
  const agentWords = SETUP_STEPS.reduce((n, s) => n + count(s.says), 0) + said.reduce((n, s) => n + count(s), 0);
  const callerAnswers = [
    'Please call me Ana', 'I am on hemodialysis three times a week',
    'My sodium is two thousand milligrams, potassium two thousand, phosphorus one thousand, and fluid one thousand milliliters',
    'Yes that is right', 'Sorry, my potassium is two thousand, not nine thousand', 'Yes that is right',
    'Yes, my care team said to avoid grapefruit', 'The warm voice please', 'Brief answers in English please', 'Okay', 'Okay, can I check a banana',
  ];
  const callerWords = callerAnswers.reduce((n, s) => n + count(s), 0);
  const seconds = Math.round(((agentWords + callerWords) / 150) * 60 + 15 * 1.5);
  const inside = seconds >= 180 && seconds <= 300 && seconds < 240;
  console.log(`spoken length: agent words=${agentWords} caller words=${callerWords} estimate=${seconds} s`);
  console.log(`target 180 to 300 s total and under 240 s: ${inside ? 'PASS' : seconds < 180 ? 'FAIL (shorter than 180 s; acceptable for the call cap)' : 'FAIL'}`);
} catch (error) {
  failed = true;
  console.error(`run failed: ${error?.name ?? 'Error'}`);
} finally {
  await rm(renalDir, { recursive: true, force: true });
  await rm(prefsDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
