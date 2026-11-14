import { fileURLToPath } from 'node:url';
import { defineAgent, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { createFaceFrames } from './face.mjs';
import { FPS, HEIGHT, WIDTH } from '../shared/video.mjs';
import { watchCaller } from './camera.mjs';
import { buildTools, endCall, withTimeout } from './tools.mjs';
import { getCartFrame } from '../actions/index.mjs';
import { createVideoPicker } from './video.mjs';
import { createFakeCart } from './sim/fake-cart.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { greeting, instructions } from './prompt.mjs';


const agent = defineAgent({
  entry: async ctx => {
    // Registered before connecting so no caller video track is missed.
    const camera = watchCaller(ctx.room);
    await ctx.connect();
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
    const caller = await ctx.waitForParticipant();
    console.log(`[agent] call joined caller=${caller.identity}`);

    const joinedAt = Date.now();

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
    const session = new voice.AgentSession({
      llm: new google.realtime.RealtimeModel({ model, voice: 'Puck' }),
    });
    session.on(voice.AgentSessionEventTypes.AgentStateChanged, event => { speaking = event.newState === 'speaking'; });
    // Tool name and ok only: arguments and outputs contain what the caller said.
    session.on(voice.AgentSessionEventTypes.FunctionToolsExecuted, event => {
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

    // Registered before anything is opened, so a throw while publishing or starting still cleans up.
    ctx.addShutdownCallback(async () => {
      console.log('[agent] call ended');
      if (timer) clearInterval(timer);
      // Close each resource even if an earlier one fails or hangs: every step has its own time limit.
      // stopCart goes first so a cart from this call cannot block or leak into the next one.
      const steps = [
        ['cart', () => endCall()],
        ['session', () => session.close()],
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
      const requestedAt = Date.now();
      try {
        await sessionReady;
        console.log(`[agent] greeting requested waited_ms=${Date.now() - requestedAt}`);
        await session.generateReply({ instructions: greeting });
      } catch (error) {
        console.error(`[agent] greeting failed ${error?.name ?? 'Error'}: ${String(error?.message ?? 'unknown').slice(0, 200)}`);
      }
    });
    ctx.addShutdownCallback(async () => stopGreeting());

    try {
      frame();
      await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
      timer = setInterval(frame, 1000 / FPS);
      await session.start({
        room: ctx.room,
        agent: new voice.Agent({ instructions, tools: buildTools({ camera, patientId: 'demo' }) }),
        record: false,
        inputOptions: {
          participantIdentity: caller.identity,
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
