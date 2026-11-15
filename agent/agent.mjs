import { fileURLToPath } from 'node:url';
import { defineAgent, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackPublishOptions, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { createScreen } from './screen.mjs';
import { FPS, HEIGHT, WIDTH } from '../shared/video.mjs';
import { watchCaller } from './camera.mjs';
import { buildTools, endCall, setupStatus, withTimeout } from './tools.mjs';
import { getCartFrame, getCallerPhone } from '../actions/index.mjs';
import { resolveCaller } from './caller.mjs';
import { createVideoPicker } from './video.mjs';
import { createFakeCart } from './sim/fake-cart.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { createDeadline, outboundCall, outboundRequested, outboundWaitMs, parseJobMetadata } from './outbound.mjs';
import { buildInstructions, chooseGreeting, replyNudge, timeWarning } from './prompt.mjs';
import { readPreferences, realtimeOptions } from './prefs.mjs';
import { bargeInConfig, callWarnMs, createReplyWatchdog, realtimeInputConfig as buildRealtimeInputConfig, turnHandlingConfig } from './turns.mjs';
import { createMemory } from './memory.mjs';
import { toolLogLine } from './toollog.mjs';


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
    // Track C's browser frame while a cart runs (exact size or nothing), the cached companion otherwise.
    // The brand screen renders in the background; the abstract companion shows until it is ready. Nothing is awaited on the call path.
    const screen = createScreen();
    const fakeCart = process.env.AGENT_FAKE_CART === '1' ? createFakeCart() : null;
    if (fakeCart) console.log('[agent] video: fake cart provider on (simulated proof only)');
    const picker = createVideoPicker({
      getCartFrame: fakeCart ? fakeCart.getCartFrame : getCartFrame,
      drawOwnPicture: () => screen.frame(tick++, speaking),
      expectedLength: WIDTH * HEIGHT * 4,
    });
    // A failed frame must never take the call down: the timer callback has no caller to catch for it.
    const frame = () => {
      try { source.captureFrame(new VideoFrame(picker.next(), WIDTH, HEIGHT, VideoBufferType.RGBA)); }
      catch (error) { console.error('[agent] video frame failed', error); }
    };

    const model = process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';
    // Barge-in is off by default: caller noise must not cancel a reply (AGENT_ALLOW_BARGE_IN=1 turns it back on).
    // Two halves: Gemini's own activity handling, and LiveKit's speech interruption (see turnHandlingConfig).
    const realtimeInputConfig = buildRealtimeInputConfig(process.env);
    const turnHandling = turnHandlingConfig(process.env);
    console.log(bargeInConfig(process.env) ? '[agent] barge-in off' : '[agent] barge-in on');
    console.log(`[agent] end of speech wait_ms=${realtimeInputConfig.automaticActivityDetection.silenceDurationMs}`);
    // Shopping list kept between calls (one small file per patient, outside the repo).
    // Who is calling: with AGENT_OPEN_ACCESS unset (default) this is always the demo patient and makes no Chert lookup.
    let identity = { kind: 'demo', patientId: 'demo', phone: process.env.PATIENT_PHONE, textAllow: null, textFirst: false };
    try {
      identity = await resolveCaller({ outbound: Boolean(call), identity: linkedIdentity, roomMetadata: ctx.room?.metadata, jobMetadata: metadata, getCallerPhone, timeoutMs: 1500 });
    } catch { /* resolveCaller never throws; the demo identity stays */ }
    console.log(`[agent] caller kind=${identity.kind}`);
    const memory = createMemory({ patientId: identity.patientId });
    // The voice, reply length and language chosen in first-call setup apply from the start of the call.
    const prefs = await readPreferences(memory);
    // A caller with no finished setup is set up on an inbound call (AGENT_SKIP_ONBOARDING=1 turns that off).
    const setupDue = !call && process.env.AGENT_SKIP_ONBOARDING !== '1' && (await setupStatus({ patientId: identity.patientId })).needsSetup;
    console.log(`[agent] setup due=${setupDue}`);
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel(realtimeOptions({ model, prefs, realtimeInputConfig })),
      ...(turnHandling ? { turnHandling } : {}),
    });
    // Reply watchdog: after the caller has said something, the agent must be heard; otherwise one nudge (see turns.mjs).
    const watchdog = createReplyWatchdog();
    let nudgeTimer = null, closing = false;
    let heardAt = 0, heardAny = false; // when the caller last spoke (time only), for confirm_limits
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => {
      try { speaking = event.newState === 'speaking'; watchdog.agentState(event.newState); } catch { /* never breaks the call */ }
    });
    // The caller's words, as a length only: the transcript text is never kept or logged.
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, event => {
      try {
        const length = typeof event?.transcript === 'string' ? event.transcript.trim().length : 0;
        if (length > 0) { heardAt = Date.now(); heardAny = true; }
        watchdog.heard({ itemId: event?.itemId ?? null, isFinal: event?.isFinal === true, length });
      } catch { /* never breaks the call */ }
    });
    // Tool name, ok and a short validated error code only: arguments and outputs contain what the caller said.
    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, event => {
      // Restarts the reply clock; a tool run is not an answer.
      try { watchdog.toolsExecuted(); } catch { /* never breaks the call */ }
      try {
        event.functionCalls.forEach((call, i) => {
          console.log(toolLogLine(call?.name, event.functionCallOutputs[i]));
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

    // Time warning: once, a little before the trial's call limit. Armed with the greeting, cleared on shutdown.
    // When it falls due it waits for an idle moment (watchdog.warnReady: up to 20 s, then it is said anyway), and
    // its speech is marked as our own so it never counts as the answer to a caller's question.
    let warnTimer = null;
    const warnNow = async dueAt => {
      try {
        if (closing) return;
        console.log(`[agent] time warning requested waited_ms=${Date.now() - dueAt}`);
        watchdog.ignoreNextSpeech();
        const handle = session.generateReply({ instructions: timeWarning });
        try { handle?.addDoneCallback?.(() => { try { watchdog.ignoreDone(); } catch { /* ignore */ } }); } catch { /* ignore */ }
        await handle;
      } catch (error) {
        try { watchdog.ignoreDone(); } catch { /* ignore */ }
        try { console.error(`[agent] time warning failed ${error?.name ?? 'Error'}`); } catch { /* ignore */ }
      }
    };
    const warnWhenIdle = () => {
      const dueAt = Date.now();
      const poll = () => {
        warnTimer = null;
        try {
          if (closing) return;
          if (watchdog.warnReady(dueAt)) { void warnNow(dueAt); return; }
          warnTimer = setTimeout(poll, 500);
        } catch { /* never breaks the call */ }
      };
      poll();
    };
    const warning = createDeadline({ ms: callWarnMs(process.env.AGENT_CALL_WARN_SECONDS), onExpire: warnWhenIdle });

    // Registered before anything is opened, so a throw while publishing or starting still cleans up.
    ctx.addShutdownCallback(async () => {
      console.log('[agent] call ended');
      closing = true;
      watchdog.disarm();
      if (nudgeTimer) clearInterval(nudgeTimer);
      answerDeadline?.clear();
      warning.clear();
      if (warnTimer) clearTimeout(warnTimer);
      warnTimer = null;
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
        const { kind, instructions: opening } = chooseGreeting({ outbound: Boolean(call), remembered, setupDue });
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
        agent: new voice.Agent({ instructions: buildInstructions(prefs, { textFirst: identity.textFirst }), tools: buildTools({ camera, patientId: identity.patientId, phone: identity.phone, textAllow: identity.textAllow, textFirst: identity.textFirst, memory, setupDue, callerHeardAfter: t => (heardAny ? heardAt > t : null), onToolActivity: delta => watchdog.toolActivity(delta), onDisplay: display => { try { screen.show(display); } catch { /* video never breaks the call */ } } }) }),
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
