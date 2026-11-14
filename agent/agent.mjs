import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { drawFace } from './face.mjs';
import { FPS, HEIGHT, WIDTH } from '../shared/video.mjs';
import { buildTools } from './tools.mjs';
import { runAgent } from './chert-rooms.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { greeting, instructions } from './prompt.mjs';


const agent = defineAgent({
  entry: async ctx => {
    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    // Chert prepares a room before a caller exists. Join promptly so Chert can
    // find us, but wait before opening a paid model session or sending video.
    const caller = await ctx.waitForParticipant();
    console.log(`[agent] call joined caller=${caller.identity}`);

    // Video: one camera track, published by this agent. The Mac shows video only
    // from the participant that speaks, so the picture and the voice stay together.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let tick = 0, speaking = false;
    // A failed frame must never take the call down: the timer callback has no caller to catch for it.
    const frame = () => {
      try { source.captureFrame(new VideoFrame(drawFace(tick++, speaking), WIDTH, HEIGHT, VideoBufferType.RGBA)); }
      catch (error) { console.error('[agent] video frame failed', error); }
    };
    frame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(frame, 1000 / FPS);

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
    ctx.addShutdownCallback(async () => {
      console.log('[agent] call ended');
      clearInterval(timer);
      // Close each resource even if an earlier one fails.
      for (const close of [() => session.close(), () => track.close(), () => source.close()]) {
        try { await close(); } catch (error) { console.error('[agent] shutdown step failed', error); }
      }
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions, tools: buildTools({ patientId: 'demo' }) }),
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
    console.log(`[agent] session started model=${model}`);
    // Greet once when chert dev reports that FaceTime is ready (bridge_ready in the
    // room metadata): the Mac ends the call if it hears nothing within 10 seconds
    // of that. Participant arrival alone is not readiness, so there is no greeting
    // on it. Without the signal there is no greeting, and the caller speaks first.
    const stopGreeting = greetOnBridgeReady(ctx.room, () => {
      console.log('[agent] greeting requested');
      return session.generateReply({ instructions: greeting });
    });
    ctx.addShutdownCallback(async () => stopGreeting());
  },
});

export default agent;

// Your own LiveKit project when .env.local has its three LIVEKIT_ values; otherwise Chert rooms through chert dev.
runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'renal-dietitian' });
