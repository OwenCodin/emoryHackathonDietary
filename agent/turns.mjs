// Turn handling for noisy calls: barge-in switch, the reply watchdog and the time-warning delay.
// Everything here is pure (no timers, no I/O) so it can be tested offline with an injected clock.
import { ActivityHandling, EndSensitivity } from '@google/genai';

export const NUDGE_WAIT_MS = 6000;
export const MAX_NUDGES = 3;
// Agent speech already playing when the caller's turn ended answers it only if it goes on at least this long after.
export const REPLY_MIN_MS = 1500;
// A generation stuck in "thinking" stops holding the nudge back after this long.
export const THINKING_CAP_MS = 15000;
// After a nudge, the time warning waits this long for the nudge reply to start.
export const NUDGE_SETTLE_MS = 8000;
// The time warning waits until no new caller words have arrived for this long.
export const CALLER_QUIET_MS = 1500;
// The time warning waits at most this long for a quiet moment, then is said anyway.
export const WARN_MAX_DEFER_MS = 20000;
// An ignoreNextSpeech() request lapses if no agent speech starts within this long.
const IGNORE_LAPSE_MS = 15000;
const MAX_ITEMS = 32;

// Gemini does not treat caller noise as barge-in unless AGENT_ALLOW_BARGE_IN is exactly "1".
// automaticActivityDetection is left out so server-side turn detection stays on.
export function bargeInConfig(env = process.env) {
  if (env?.AGENT_ALLOW_BARGE_IN === '1') return undefined;
  return { activityHandling: ActivityHandling.NO_INTERRUPTION };
}

// How long the caller must be silent before Gemini treats their turn as finished. Gemini Live's default ends a
// turn quickly (END_SENSITIVITY_HIGH), so the agent answered while the caller was still talking on live calls.
// AGENT_END_SILENCE_MS sets the wait: whole milliseconds, clamped to 300-3000, anything else means 1000.
export const END_SILENCE_DEFAULT_MS = 1000;
export function endSilenceMs(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return END_SILENCE_DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return END_SILENCE_DEFAULT_MS;
  return Math.min(3000, Math.max(300, Math.round(n)));
}

// The whole realtimeInputConfig for the Gemini session: server-side turn detection stays on (never disabled),
// it just waits longer for the caller to stop, and barge-in handling is added unless it is allowed.
export function realtimeInputConfig(env = process.env) {
  return {
    automaticActivityDetection: {
      endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
      silenceDurationMs: endSilenceMs(env?.AGENT_END_SILENCE_MS),
    },
    ...(bargeInConfig(env) ?? {}),
  };
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
  thinkingCapMs = THINKING_CAP_MS, nudgeSettleMs = NUDGE_SETTLE_MS, callerQuietMs = CALLER_QUIET_MS,
  warnMaxDeferMs = WARN_MAX_DEFER_MS,
} = {}) {
  let armed = false;
  let disarmed = false;
  let turn = null; // { endedAt, answered, nudged, nudgedAt }
  let agentNow = 'initializing';
  let speakingSince = null; // start of the agent speech now playing; null when none or when it is ignored
  let thinkingSince = null;
  let holdEndedAt = -Infinity;
  let lastHeardAt = -Infinity;
  let tools = 0;
  let sent = 0;
  let ignoreRequestedAt = null;
  let ignoring = false;
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
        lastHeardAt = t;
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
          if (ignoring) {
            ignoring = false;
          } else if (turn && !turn.answered && speakingSince !== null && t - turn.endedAt >= replyMinMs) {
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
          if (ignoreRequestedAt !== null && t - ignoreRequestedAt < IGNORE_LAPSE_MS) {
            ignoring = true;
          } else {
            speakingSince = t;
            if (turn && !turn.answered && t >= turn.endedAt) turn.answered = true;
          }
          ignoreRequestedAt = null;
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

    // The next agent speech is our own announcement (the time warning): it never answers a caller turn.
    ignoreNextSpeech() {
      try { ignoreRequestedAt = now(); } catch { /* never throws */ }
    },
    // That announcement's speech handle is done (spoken or not): a request that never spoke must not eat a reply.
    ignoreDone() { ignoreRequestedAt = null; },

    // The time warning fell due at dueAt: say it when the agent is idle (not speaking or thinking, no tool running,
    // the caller quiet and no caller turn still waiting for its answer or nudge), or once warnMaxDeferMs has passed.
    warnReady(dueAt) {
      try {
        const t = now();
        if (t - dueAt >= warnMaxDeferMs) return true;
        if (agentNow === 'speaking' || agentNow === 'thinking' || tools > 0) return false;
        if (t - lastHeardAt < callerQuietMs) return false;
        if (armed && turn && !turn.answered) {
          if (turn.nudged ? t - turn.nudgedAt < nudgeSettleMs : sent < maxNudges) return false;
        }
        return true;
      } catch { return true; }
    },

    get nudges() { return sent; },
  };
}
