// Turn handling for noisy calls: barge-in switch, the reply watchdog and the time-warning delay.
// Everything here is pure (no timers, no I/O) so it can be tested offline with an injected clock.
import { ActivityHandling } from '@google/genai';

export const NUDGE_WAIT_MS = 6000;
export const MAX_NUDGES = 3;

// Gemini does not treat caller noise as barge-in unless AGENT_ALLOW_BARGE_IN is exactly "1".
// automaticActivityDetection is left out so server-side turn detection stays on.
export function bargeInConfig(env = process.env) {
  if (env?.AGENT_ALLOW_BARGE_IN === '1') return undefined;
  return { activityHandling: ActivityHandling.NO_INTERRUPTION };
}

// LiveKit side of barge-in off (AgentSessionOptions.turnHandling). The Google plugin emits input_speech_started
// whenever Gemini opens a generation that was not requested with generateReply, including the follow-up
// generation inside one reply (realtime_api.js startNewGeneration). AgentActivity.onInputSpeechStarted then calls
// interrupt(), which cancels the current SpeechHandle when it allows interruptions, and the running tool call with
// it (agent_activity.js onInputSpeechStarted, interrupt, "Aborting all realtime generation tasks due to
// interruption"). With interruption.enabled false every SpeechHandle is created non-interruptible
// (agent_activity.js allowInterruptions getter, onGenerationCreated, generateReply), so that interrupt() leaves it
// running. discardAudioIfUninterruptible is false so caller audio still reaches Gemini while the agent speaks,
// as it does today (the default true would drop a question asked over the agent).
export function turnHandlingConfig(env = process.env) {
  if (env?.AGENT_ALLOW_BARGE_IN === '1') return undefined;
  return { interruption: { enabled: false, discardAudioIfUninterruptible: false } };
}

// Seconds before the time warning: Number(raw) || 240, only positive finite numbers, capped at 3600. Returns milliseconds.
export function callWarnMs(raw) {
  let seconds = 240;
  if (typeof raw === 'string' && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) seconds = n;
  }
  return Math.min(seconds, 3600) * 1000;
}

export function createReplyWatchdog({ now = () => Date.now(), waitMs = NUDGE_WAIT_MS, maxNudges = MAX_NUDGES } = {}) {
  let armed = false;
  let disarmed = false;
  let turn = null; // { endedAt, answered, nudged }
  let userNow = 'listening';
  let agentNow = 'initializing';
  let tools = 0;
  let sent = 0;

  return {
    arm() { if (!disarmed) armed = true; },
    disarm() { disarmed = true; armed = false; },
    userState(newState) {
      try {
        userNow = newState;
        if (!armed) return;
        if (newState === 'speaking') {
          // A turn that starts while the agent is already speaking is answered by that speech.
          turn = { endedAt: null, answered: agentNow === 'speaking', nudged: false };
        } else if (turn && turn.endedAt === null) {
          turn.endedAt = now();
        }
      } catch { /* never throws */ }
    },
    agentState(newState) {
      try {
        agentNow = newState;
        if (newState === 'speaking' && turn) turn.answered = true;
      } catch { /* never throws */ }
    },
    toolActivity(delta) {
      try {
        const d = Number(delta);
        if (Number.isFinite(d)) tools = Math.max(0, tools + d);
      } catch { /* never throws */ }
    },
    toolsExecuted() {
      if (turn) turn.answered = true;
    },
    due() {
      try {
        if (!armed || disarmed || !turn || turn.answered || turn.nudged) return false;
        if (turn.endedAt === null || now() - turn.endedAt < waitMs) return false;
        if (agentNow === 'speaking' || userNow === 'speaking') return false;
        if (tools > 0 || sent >= maxNudges) return false;
        return true;
      } catch { return false; }
    },
    nudged() {
      if (turn) turn.nudged = true;
      sent += 1;
    },
    get nudges() { return sent; },
  };
}
