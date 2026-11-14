// Turn handling for noisy calls: barge-in switch, the reply watchdog and the time-warning delay.
// Everything here is pure (no timers, no I/O) so it can be tested offline with an injected clock.
import { ActivityHandling } from '@google/genai';

export const NUDGE_WAIT_MS = 6000;
export const MAX_NUDGES = 3;
// Agent speech already playing when the caller's turn ended answers it only if it goes on at least this long after.
export const REPLY_MIN_MS = 1500;
// A generation stuck in "thinking" stops holding the nudge back after this long.
export const THINKING_CAP_MS = 15000;
const MAX_ITEMS = 32;

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

// The reply watchdog. Rule: after the caller has said something, the agent must be heard. Only agent speech
// counts; a tool run does not.
//
// "Said something" is a user_input_transcribed event with a non-empty transcript (heard()). user_state_changed is
// not the caller with the Gemini realtime model in @livekit/agents 1.8.0: no local VAD runs when the model does
// server-side turn detection (agent_activity.js recognitionVad), and the plugin emits input_speech_started when
// Gemini opens a generation and input_speech_stopped when any generation ends, the greeting included
// (realtime_api.js startNewGeneration, markCurrentGenerationDone). The transcript arrives in pieces (isFinal false)
// while Gemini hears the caller, then once more in full (isFinal true) when the generation ends, which is after the
// reply; that repeat is ignored so it cannot reopen an answered turn. Callers pass the item id, isFinal and the
// transcript length only, never the text.
//
// The 6 s clock runs from the later of the caller's last words and the end of the last hold (a tool run, a
// "thinking" spell or an overlapping agent speech that ended without answering). While a tool runs, the agent
// speaks, or it thinks (up to THINKING_CAP_MS), no nudge is due.
export function createReplyWatchdog({
  now = () => Date.now(), waitMs = NUDGE_WAIT_MS, maxNudges = MAX_NUDGES, replyMinMs = REPLY_MIN_MS,
  thinkingCapMs = THINKING_CAP_MS,
} = {}) {
  let armed = false;
  let disarmed = false;
  let turn = null; // { endedAt, answered, nudged, nudgedAt }
  let agentNow = 'initializing';
  let speakingSince = null; // start of the agent speech now playing; null when none
  let thinkingSince = null;
  let holdEndedAt = -Infinity;
  let tools = 0;
  let sent = 0;
  const items = new Map(); // transcript item id -> longest transcript length seen

  return {
    arm() { if (!disarmed) armed = true; },
    disarm() { disarmed = true; armed = false; },

    // A user_input_transcribed event, reduced to { itemId, isFinal, length }.
    heard(event) {
      try {
        const { itemId = null, isFinal = false, length = 0 } = event ?? {};
        const len = Number(length);
        if (!Number.isFinite(len) || len <= 0) return;
        if (itemId === null || itemId === undefined) {
          if (isFinal === true) return; // cannot tell a repeat from new words without an id
        } else {
          const key = String(itemId);
          const seen = items.get(key);
          if (seen !== undefined && (isFinal === true || len <= seen)) return; // repeat, or no new words
          items.delete(key);
          items.set(key, Math.max(len, seen ?? 0));
          if (items.size > MAX_ITEMS) items.delete(items.keys().next().value);
        }
        if (!armed) return;
        const t = now();
        // More words before an answer (or a nudge) extend the same turn; anything else starts a new one.
        if (turn && !turn.answered && !turn.nudged) turn.endedAt = t;
        else turn = { endedAt: t, answered: false, nudged: false, nudgedAt: null };
      } catch { /* never throws */ }
    },

    agentState(newState) {
      try {
        const prev = agentNow;
        if (prev === newState) return;
        agentNow = newState;
        const t = now();
        if (prev === 'speaking') {
          if (turn && !turn.answered && speakingSince !== null && t - turn.endedAt >= replyMinMs) {
            turn.answered = true; // speech that overlapped the turn went on long enough after it to be the reply
          }
          speakingSince = null;
          holdEndedAt = t;
        }
        if (prev === 'thinking') {
          thinkingSince = null;
          if (newState !== 'speaking') holdEndedAt = t;
        }
        if (newState === 'thinking') thinkingSince = t;
        if (newState === 'speaking') {
          speakingSince = t;
          if (turn && !turn.answered && t >= turn.endedAt) turn.answered = true;
        }
      } catch { /* never throws */ }
    },

    toolActivity(delta) {
      try {
        const d = Number(delta);
        if (!Number.isFinite(d)) return;
        const before = tools;
        tools = Math.max(0, tools + d);
        if (before > 0 && tools === 0) holdEndedAt = now();
      } catch { /* never throws */ }
    },

    // FunctionToolsExecuted: the tools finished; restarts the clock but never answers the turn.
    toolsExecuted() {
      try { holdEndedAt = now(); } catch { /* never throws */ }
    },

    due() {
      try {
        if (!armed || disarmed || !turn || turn.answered || turn.nudged || sent >= maxNudges) return false;
        if (agentNow === 'speaking' || tools > 0) return false;
        const t = now();
        if (agentNow === 'thinking' && thinkingSince !== null && t - thinkingSince < thinkingCapMs) return false;
        return t - Math.max(turn.endedAt, holdEndedAt) >= waitMs;
      } catch { return false; }
    },

    nudged() {
      try {
        if (turn) { turn.nudged = true; turn.nudgedAt = now(); }
        sent += 1;
      } catch { /* never throws */ }
    },

    get nudges() { return sent; },
  };
}
