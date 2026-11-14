import { fileURLToPath } from 'node:url';
import { defineAgent, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { createFaceFrames } from './face.mjs';
import { FPS, HEIGHT, WIDTH } from '../shared/video.mjs';
import { watchCaller } from './camera.mjs';
import { buildTools, endCall, withTimeout } from './tools.mjs';
import { getCartFrame } from '../actions/index.mjs';
import { createVideoPicker } from './video.mjs';
import { createFakeCart } from './sim/fake-cart.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { createDeadline, outboundCall, outboundRequested, outboundWaitMs, parseJobMetadata } from './outbound.mjs';
import { chooseGreeting, instructions, replyNudge, timeWarning } from './prompt.mjs';
import { bargeInConfig, callWarnMs, createReplyWatchdog } from './turns.mjs';
import { createMemory } from './memory.mjs';


const agent = defineAgent({
  entry: async ctx => {
    // Outbound (twist 3): Track C's callPatient dispatches with metadata naming the Chert bridge. Anything else is inbound.
    const metadata = parseJobMetadata(ctx.job?.metadata);
    const call = outboundCall(metadata);
    if (!call && outboundRequested(metadata)) {
      // Outbound asked for but bridgeIdentity missing or invalid: never fall back to an inbound call. No metadata in the log.
      console.error('[agent] outbound metadata rejected');
      await ctx.connect();
      ctx.shutdown('outbound_metadata_rejected');
      return;
    }
    // Registered before connecting so no caller video track is missed.
    const camera = watchCaller(ctx.room);
    await ctx.connect();
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
    let linkedIdentity;
    if (call) {
      // No waiting: Chert dials only after the agent is publishing, so the bridge joins after us.
      console.log(`[agent] outbound call reason=${call.reason}`);
      linkedIdentity = call.bridgeIdentity;
    } else {
      const caller = await ctx.waitForParticipant();
      console.log(`[agent] call joined caller=${caller.identity}`);
      linkedIdentity = caller.identity;
    }

    const joinedAt = Date.now();

    // Outbound only: if the patient never answers, end the job so the model session, timer, tracks and audio are
    // released. Limit: 90 s by default (AGENT_OUTBOUND_WAIT_SECONDS overrides it for testing, not in the shared env
    // contract). Armed now for the bridge to join, restarted when it joins, cleared by chert_bridge_ready.
    let answerDeadline = null, onBridgeJoined = null;
    if (call) {
      answerDeadline = createDeadline({
        ms: outboundWaitMs(process.env.AGENT_OUTBOUND_WAIT_SECONDS),
        onExpire: () => { console.error('[agent] outbound call not answered'); ctx.shutdown('outbound_not_answered'); },
      });
      onBridgeJoined = participant => { if (participant?.identity === call.bridgeIdentity) answerDeadline.arm(); };
      ctx.room.on('participantConnected', onBridgeJoined);
      answerDeadline.arm();
      if (ctx.room.remoteParticipants?.has(call.bridgeIdentity)) answerDeadline.arm();
    }

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false, timer = null;
    // Track C's browser frame while a cart runs (exact size or nothing), the cached face otherwise.
    const faces = createFaceFrames();
    const fakeCart = process.env.AGENT_FAKE_CART === '1' ? createFakeCart() : null;
    if (fakeCart) console.log('[agent] video: fake cart provider on (simulated proof only)');
    const picker = createVideoPicker({
      getCartFrame: fakeCart ? fakeCart.getCartFrame : getCartFrame,
      drawOwnPicture: () => faces.frame(tick++, speaking),
      expectedLength: WIDTH * HEIGHT * 4,
    });
    // A failed frame must never take the call down: the timer callback has no caller to catch for it.
    const frame = () => {
      try { source.captureFrame(new VideoFrame(picker.next(), WIDTH, HEIGHT, VideoBufferType.RGBA)); }
      catch (error) { console.error('[agent] video frame failed', error); }
    };

    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
    // Barge-in is off by default: caller noise must not cancel a reply (AGENT_ALLOW_BARGE_IN=1 turns it back on).
    const realtimeInputConfig = bargeInConfig(process.env);
    console.log(realtimeInputConfig ? '[agent] barge-in off' : '[agent] barge-in on');
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel({ model, voice: 'Puck', ...(realtimeInputConfig ? { realtimeInputConfig } : {}) }),
    });
    // Reply watchdog: nudges the model once when a caller turn ends with no reply and no tool run.
    const watchdog = createReplyWatchdog();
    let nudgeTimer = null, closing = false;
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      try { speaking = event.newState === 'speaking'; watchdog.agentState(event.newState); } catch { /* never breaks the call */ }
    });
    session.on(voice.AgentSessionEventTypes.UserStateChanged, event => {
      try { watchdog.userState(event.newState); } catch { /* never breaks the call */ }
    });
    // Tool name and ok only: arguments and outputs contain what the caller said.
    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, event => {
      try { watchdog.toolsExecuted(); } catch { /* never breaks the call */ }
      try {
        event.functionCalls.forEach((call, i) => {
          const out = event.functionCallOutputs[i];
          let ok = false;
          try { ok = Boolean(out) && !out.isError && JSON.parse(out.output)?.ok === true; } catch { ok = false; }
          console.log(`[agent] tool ${call.name} ok=${ok}`);
        });
      } catch { /* logging must never break the call */ }
    });
    // Model and connection errors: error name and message only (never request or caller content).
    session.on(voice.AgentSessionEventTypes.Error, event => {
      try {
        const e = event?.error;
        console.error(`[agent] session error name=${e?.name ?? 'Error'} message=${String(e?.error?.message ?? e?.message ?? 'unknown').slice(0, 200)}`);
      } catch { /* logging must never break the call */ }
    });

    // Outbound only: Chert needs the agent publishing audio and video before it dials, and RoomIO in
    // @livekit/agents 1.8.0 publishes its audio only after the linked participant joins. So the one audio
    // track is published here, and RoomIO keeps this pre-set output instead of making a second track.
    let audioAbort = null, audioOut = null;
    if (call) {
      audioAbort = new AbortController();
      audioOut = new voice.ParticipantAudioOutput(ctx.room, {
        sampleRate: 24000,
        numChannels: 1,
        trackPublishOptions: new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
        queueSizeMs: 200,
      });
      session.output.audio = audioOut;
    }

    const checkNudge = async () => {
      try {
        if (closing || !watchdog.due()) return;
        watchdog.nudged();
        console.log('[agent] reply nudge');
        await session.generateReply({ instructions: replyNudge });
      } catch (error) {
        try { console.error(`[agent] reply nudge failed ${error?.name ?? 'Error'}`); } catch { /* ignore */ }
      }
    };

    // Shopping list kept between calls (one small file per patient, outside the repo).
    const memory = createMemory({ patientId: 'demo' });

    // Time warning: once, a little before the trial's call limit. Armed with the greeting, cleared on shutdown.
    const warnNow = async () => {
      try {
        if (closing) return;
        console.log('[agent] time warning requested');
        await session.generateReply({ instructions: timeWarning });
      } catch (error) {
        try { console.error(`[agent] time warning failed ${error?.name ?? 'Error'}`); } catch { /* ignore */ }
      }
    };
    const warning = createDeadline({ ms: callWarnMs(process.env.AGENT_CALL_WARN_SECONDS), onExpire: () => { void warnNow(); } });

    // Registered before anything is opened, so a throw while publishing or starting still cleans up.
    ctx.addShutdownCallback(async () => {
      console.log('[agent] call ended');
      closing = true;
      watchdog.disarm();
      if (nudgeTimer) clearInterval(nudgeTimer);
      answerDeadline?.clear();
      warning.clear();
      if (onBridgeJoined) ctx.room.off('participantConnected', onBridgeJoined);
      if (timer) clearInterval(timer);
      // Close each resource even if an earlier one fails or hangs: every step has its own time limit.
      // stopCart goes first so a cart from this call cannot block or leak into the next one.
      const steps = [
        ['cart', () => endCall()],
        ['session', () => session.close()],
        ['audioAbort', () => audioAbort?.abort()],
        ['audioOut', () => audioOut?.close()],
        ['track', () => track.close()],
        ['source', () => source.close()],
        ['camera', () => camera.close()],
      ];
      for (const [name, close] of steps) {
        const r = await withTimeout(close, 4000);
        if (!r.ok) console.error(`[agent] shutdown step ${name} ${r.timedOut ? 'timed out' : 'failed'}`);
      }
    });

    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    // The listener is registered now so the signal is never missed while setup runs;
    // the greeting itself waits for the session to be started.
    let markReady, markFailed;
    const sessionReady = new Promise((resolve, reject) => { markReady = resolve; markFailed = reject; });
    sessionReady.catch(() => {}); // reported by the greeting, or by the entry error below
    const stopGreeting = greetOnBridgeReady(ctx.room, async () => {
      answerDeadline?.clear();
      const requestedAt = Date.now();
      try {
        await sessionReady;
        if (closing) return;
        watchdog.arm();
        nudgeTimer = setInterval(() => { void checkNudge(); }, 500);
        warning.arm();
        let remembered = null;
        if (!call) {
          // Never let a slow read delay the greeting (the Mac ends the call after 10 s of silence).
          let t;
          const slow = new Promise(resolve => { t = setTimeout(() => resolve(null), 1000); });
          try { remembered = await Promise.race([memory.load(), slow]); } catch { remembered = null; } finally { clearTimeout(t); }
          if (remembered && remembered.ok === false) console.log('[agent] shopping list memory unavailable');
        }
        const { kind, instructions: opening } = chooseGreeting({ outbound: Boolean(call), remembered });
        console.log(`[agent] greeting requested kind=${kind} waited_ms=${Date.now() - requestedAt}`);
        await session.generateReply({ instructions: opening });
      } catch (error) {
        console.error(`[agent] greeting failed ${error?.name ?? 'Error'}: ${String(error?.message ?? 'unknown').slice(0, 200)}`);
      }
    });
    ctx.addShutdownCallback(async () => stopGreeting());

    try {
      frame();
      await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
      timer = setInterval(frame, 1000 / FPS);
      // Not awaited: it resolves only once someone subscribes.
      // A call with no agent audio is dropped by Chert anyway, so a failed start ends the job rather than carrying on silently.
      audioOut?.start(audioAbort.signal).catch(error => {
        if (audioAbort.signal.aborted) return; // closed on shutdown, not a failure
        console.error(`[agent] outbound audio failed ${error?.name ?? 'Error'}`);
        markFailed(error);
        ctx.shutdown('outbound_audio_failed');
      });
      await session.start({
        room: ctx.room,
        agent: new voice.Agent({ instructions, tools: buildTools({ camera, patientId: 'demo', memory, onToolActivity: delta => watchdog.toolActivity(delta) }) }),
        record: false,
        inputOptions: {
          participantIdentity: linkedIdentity,
          audioEnabled: true,
          videoEnabled: false,
          textEnabled: false,
          closeOnDisconnect: true,
          deleteRoomOnClose: false,
        },
        outputOptions: { audioEnabled: true, transcriptionEnabled: false },
      });
    } catch (error) {
      markFailed(error);
      throw error; // the shutdown callbacks above close the timer, track, source and session
    }
    console.log(`[agent] session started model=${model} setup_ms=${Date.now() - joinedAt}`);
    fakeCart?.start();
    markReady();
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'renal-dietitian' });
