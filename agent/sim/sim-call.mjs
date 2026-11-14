// Simulated Chert call: a developer tool, not part of npm test.
// It creates a LiveKit room, joins as "chert-bridge-sim", has the agent dispatched into it, publishes a
// silent caller microphone, sets the chert_bridge_ready room metadata, then measures what the agent
// publishes (greeting timing, silence before the signal, video size). One RESULT line per call.
//
// Run against an already running agent (npm start, or node --env-file=.env.local agent/agent.mjs start):
//   node --env-file=.env.local agent/sim/sim-call.mjs [--seconds N] [--calls N] [--image PATH] [--say TEXT]... [--expect-cart-switch] [--outbound]
// --image PATH publishes a facetime-remote-video track showing that picture (1280x720, about 5 frames a second).
// --say TEXT (repeatable) speaks the text into the caller microphone after the greeting, using macOS say.
// --expect-cart-switch checks that the agent's video goes face, then cart (magenta), then face; run against an agent
// started with AGENT_FAKE_CART=1.
// --outbound simulates Track C's callPatient: dispatches the agent with outbound metadata before the bridge joins and
// checks that the agent already publishes audio and video.
// With --say or --image listening ends at the earlier of ready + SECONDS and 44 s after the call started.
// Exit 0 only if every call passes all checks; otherwise exit 1 naming the failed checks.
import { existsSync } from 'node:fs';
import sharp from 'sharp';
import {
  AudioFrame, AudioSource, AudioStream, LocalAudioTrack, LocalVideoTrack, Room, RoomEvent, TrackKind, TrackSource,
  VideoBufferType, VideoFrame, VideoSource, VideoStream,
} from '@livekit/rtc-node';
import { AccessToken, AgentDispatchClient, RoomServiceClient, TrackType } from 'livekit-server-sdk';
import { HEIGHT, WIDTH } from '../../shared/video.mjs';
import { followsFaceCartFace, isMagenta } from './fake-cart.mjs';
import { MAX_SPEECH_CHARS, speechPcm } from './speech.mjs';

const USAGE = '[sim] usage: node --env-file=.env.local agent/sim/sim-call.mjs [--seconds N] [--calls N] [--image PATH] [--say TEXT]... [--expect-cart-switch] [--outbound]';

function intArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const raw = process.argv[i + 1];
  if (!/^[1-9]\d*$/.test(raw ?? '')) { console.log(USAGE); process.exit(1); }
  return Number(raw);
}
const SECONDS = intArg('--seconds', 14);
const CALLS = intArg('--calls', 1);

function textArgs(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a !== name) return;
    const v = process.argv[i + 1];
    if (typeof v !== 'string' || !v.trim() || v.startsWith('-') || (name === '--say' && v.length > MAX_SPEECH_CHARS)) { console.log(USAGE); process.exit(1); }
    out.push(v);
  });
  return out;
}
const SAYS = textArgs('--say');
const IMAGES = textArgs('--image');
if (IMAGES.length > 1 || (IMAGES.length === 1 && !existsSync(IMAGES[0]))) { console.log(USAGE); process.exit(1); }
const IMAGE = IMAGES[0] ?? null;
const EXPECT_CART = process.argv.includes('--expect-cart-switch');
const OUTBOUND = process.argv.includes('--outbound');
const SCRIPTED = SAYS.length > 0 || IMAGE !== null;

const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const agentName = process.env.AGENT_NAME || 'renal-dietitian';
if (!url || !apiKey || !apiSecret) {
  console.log('[sim] LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set; run with node --env-file=.env.local');
  process.exit(1);
}
const host = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const rooms = new RoomServiceClient(host, apiKey, apiSecret);
const dispatch = new AgentDispatchClient(host, apiKey, apiSecret);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const identity = OUTBOUND ? 'chert-bridge-out-sim' : 'chert-bridge-sim';
const QUIET_WINDOW_MS = 3000;
const CALL_CAP_MS = 44000;
let activeRoom = null; // the room being used now, so the watchdog can delete it

async function deleteRoomQuietly(name) {
  try { await rooms.deleteRoom(name); }
  catch (error) { console.error(`[sim] WARNING: could not delete room ${name}: ${error?.message ?? 'unknown'}`); }
}

async function runCall(n) {
  const t0 = Date.now();
  const log = (...a) => console.log(`[sim call ${n} ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
  const roomName = `sim-${Date.now()}-${n}`;
  const room = new Room();
  let micTimer = null, camTimer = null, camTrack = null, camSource = null, framesSent = 0;
  const stats = { audioFrames: 0, loudFrames: 0, firstLoudAt: null, peak: 0, lastLoudAt: 0, videoFrames: 0, videoSize: null, agentIdentity: null, timeline: [] };
  try {
    await rooms.createRoom({ name: roomName, emptyTimeout: 60 });
    activeRoom = roomName;
    const grant = new AccessToken(apiKey, apiSecret, { identity, ttl: '10m' });
    grant.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      stats.agentIdentity = participant.identity;
      if (track.kind === TrackKind.KIND_AUDIO) {
        const reader = new AudioStream(track).getReader();
        (async () => {
          for (;;) {
            const { value, done } = await reader.read().catch(() => ({ done: true }));
            if (done) break;
            const data = value.data;
            let peak = 0;
            for (let i = 0; i < data.length; i += 8) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
            stats.audioFrames++;
            if (peak > stats.peak) stats.peak = peak;
            if (peak > 500) {
              stats.loudFrames++;
              stats.lastLoudAt = Date.now();
              if (!stats.firstLoudAt) { stats.firstLoudAt = Date.now(); log('agent audio is audible'); }
            }
          }
        })();
      } else {
        const reader = new VideoStream(track).getReader();
        let lastSampleAt = 0;
        (async () => {
          for (;;) {
            const { value, done } = await reader.read().catch(() => ({ done: true }));
            if (done) break;
            stats.videoFrames++;
            stats.videoSize = `${value.frame.width}x${value.frame.height}`;
            if (EXPECT_CART && Date.now() - lastSampleAt >= 500) {
              lastSampleAt = Date.now();
              try {
                const rgba = value.frame.convert(VideoBufferType.RGBA);
                const i = ((Math.floor(rgba.height / 2) * rgba.width) + Math.floor(rgba.width / 2)) * 4;
                const kind = isMagenta(rgba.data[i], rgba.data[i + 1], rgba.data[i + 2]) ? 'cart' : 'face';
                if (stats.timeline[stats.timeline.length - 1] !== kind && stats.timeline.length < 30) stats.timeline.push(kind);
              } catch { /* sampling must never stop the reader */ }
            }
          }
        })();
      }
    });

    if (OUTBOUND) {
      // Track C's callPatient: the agent is dispatched into the prepared room before the bridge exists.
      await dispatch.createDispatch(roomName, agentName, { metadata: JSON.stringify({ outbound: true, reason: 'dinner_checkin', bridgeIdentity: identity }) });
      log('dispatched agent (outbound)');
      const dispatchedAt = Date.now();
      const pubDeadline = dispatchedAt + 20000;
      stats.agentPublishedBeforeBridge = false;
      stats.secondsToAgentPublished = null;
      while (Date.now() < pubDeadline && !stats.agentPublishedBeforeBridge) {
        try {
          const list = await rooms.listParticipants(roomName);
          stats.agentPublishedBeforeBridge = list.some(p => p.identity !== identity
            && p.tracks.some(t => t.type === TrackType.AUDIO) && p.tracks.some(t => t.type === TrackType.VIDEO));
        } catch { /* poll again */ }
        if (!stats.agentPublishedBeforeBridge) await sleep(250);
      }
      if (stats.agentPublishedBeforeBridge) {
        stats.secondsToAgentPublished = Number(((Date.now() - dispatchedAt) / 1000).toFixed(2));
        log('agent publishing audio and video before bridge joined');
      } else {
        log('WARNING: agent not publishing audio and video within 20 s');
      }
    }

    await room.connect(url, await grant.toJwt(), { autoSubscribe: true, dynacast: false });
    log('joined room as', identity);

    // A silent microphone named like Chert's, so the agent has caller audio to bind to.
    const source = new AudioSource(48000, 1);
    const mic = LocalAudioTrack.createAudioTrack('facetime-remote-audio', source);
    await room.localParticipant.publishTrack(mic, { source: TrackSource.SOURCE_MICROPHONE });
    const silence = new Int16Array(480);
    const startSilence = () => { micTimer = setInterval(() => { source.captureFrame(new AudioFrame(silence, 48000, 1, 480)).catch(() => {}); }, 10); };
    const stopSilence = () => { if (micTimer) clearInterval(micTimer); micTimer = null; };
    startSilence();

    // A picture, named like Chert's caller video, sent about 5 times a second.
    if (picture) {
      camSource = new VideoSource(WIDTH, HEIGHT);
      camTrack = LocalVideoTrack.createVideoTrack('facetime-remote-video', camSource);
      await room.localParticipant.publishTrack(camTrack, { source: TrackSource.SOURCE_CAMERA, simulcast: false });
      const send = () => {
        try { camSource.captureFrame(new VideoFrame(picture, WIDTH, HEIGHT, VideoBufferType.RGBA)); framesSent++; } catch { /* keep going */ }
      };
      send();
      camTimer = setInterval(send, 200);
    }

    if (!OUTBOUND) {
      await dispatch.createDispatch(roomName, agentName, { metadata: JSON.stringify({ sim: true }) });
      log('dispatched agent', agentName);
    }

    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && stats.audioFrames === 0) await sleep(250);
    if (stats.audioFrames === 0) log('WARNING: no agent audio within 20 s');
    // The agent's track is subscribed (silence frames count). Watch it for a quiet window before the
    // signal: an agent that greets on join would speak here, and must fail spokeBeforeReady.
    await sleep(QUIET_WINDOW_MS);
    const preReadyLoud = stats.loudFrames;

    await rooms.updateRoomMetadata(roomName, JSON.stringify({ chert_call: 'sim', chert_bridge_ready: true, at: new Date().toISOString() }));
    const readyAt = Date.now();
    log('set chert_bridge_ready; listening for', SECONDS, 's');
    const replies = [];
    let listenEndAt = 0;
    if (!SCRIPTED) {
      await sleep(SECONDS * 1000);
      listenEndAt = Date.now();
    } else {
      const endAt = Math.min(readyAt + SECONDS * 1000, t0 + CALL_CAP_MS);
      const left = () => endAt - Date.now();
      const nap = async ms => { await sleep(Math.max(0, Math.min(ms, left()))); };
      // Wait until agent audio has been quiet for quietMs, after first waiting (up to firstMs) for any sound after `since`.
      const waitQuiet = async (since, firstMs, quietMs, totalMs) => {
        const stop = Math.min(endAt, Date.now() + totalMs);
        const firstBy = Math.min(stop, Date.now() + firstMs);
        while (Date.now() < firstBy && stats.lastLoudAt <= since) await sleep(100);
        if (stats.lastLoudAt <= since) return false;
        while (Date.now() < stop && Date.now() - stats.lastLoudAt < quietMs) await sleep(100);
        return true;
      };
      if (SAYS.length > 0) {
        await waitQuiet(readyAt, 15000, 1500, 25000);
        for (let k = 0; k < speech.length && left() > 0; k++) {
          log('speaking');
          stopSilence();
          const pcm = speech[k];
          for (let i = 0; i + 480 <= pcm.length && left() > 0; i += 480) {
            await source.captureFrame(new AudioFrame(pcm.slice(i, i + 480), 48000, 1, 480));
          }
          startSilence();
          const spokeAt = Date.now();
          const replied = await waitQuiet(spokeAt, 15000, 1500, 25000);
          replies.push({ replied, secondsToReply: replied ? Number(((stats.lastLoudAt - spokeAt) / 1000).toFixed(1)) : null });
        }
        await nap(2000);
      } else {
        await nap(left());
      }
      listenEndAt = Date.now();
    }

    if (OUTBOUND) {
      try {
        const list = await rooms.listParticipants(roomName);
        stats.agentAudioTracksAtEnd = list.filter(p => p.identity !== identity)
          .reduce((sum, p) => sum + p.tracks.filter(t => t.type === TrackType.AUDIO).length, 0);
      } catch { stats.agentAudioTracksAtEnd = null; }
    }

    const result = {
      call: n,
      agentIdentity: stats.agentIdentity,
      spokeBeforeReady: preReadyLoud > 0,
      greeted: stats.loudFrames > preReadyLoud,
      secondsFromReadyToFirstSound: stats.firstLoudAt ? Number(((stats.firstLoudAt - readyAt) / 1000).toFixed(2)) : null,
      audibleSeconds: Number((stats.loudFrames * 0.01).toFixed(1)),
      audioFrames: stats.audioFrames, peak: stats.peak,
      videoFrames: stats.videoFrames, videoSize: stats.videoSize,
    };
    result.callSeconds = Number(((listenEndAt - t0) / 1000).toFixed(1));
    if (OUTBOUND) {
      result.agentPublishedBeforeBridge = stats.agentPublishedBeforeBridge === true;
      result.secondsToAgentPublished = stats.secondsToAgentPublished;
      result.agentAudioTracksAtEnd = stats.agentAudioTracksAtEnd;
    }
    if (EXPECT_CART) {
      result.videoTimeline = stats.timeline;
      result.cartSwitch = followsFaceCartFace(stats.timeline);
    }
    if (SCRIPTED) {
      result.image = picture !== null;
      result.imageFramesSent = framesSent;
      result.says = SAYS.length;
      result.replies = replies;
    }
    const failed = [];
    if (result.spokeBeforeReady) failed.push('spokeBeforeReady');
    if (!result.greeted) failed.push('greeted');
    if (result.secondsFromReadyToFirstSound === null || result.secondsFromReadyToFirstSound > 10) failed.push('firstSoundWithin10s');
    if (result.videoSize !== `${WIDTH}x${HEIGHT}`) failed.push('videoSize');
    if (SCRIPTED) {
      if (picture && framesSent < 5) failed.push('imagePublished');
      if (SAYS.length > 0 && (replies.length < SAYS.length || replies.some(r => !r.replied))) failed.push('repliedToSay');
    }
    if (EXPECT_CART && !result.cartSwitch) failed.push('cartSwitch');
    if (OUTBOUND && result.agentPublishedBeforeBridge !== true) failed.push('agentPublishedBeforeBridge');
    if (OUTBOUND && result.agentAudioTracksAtEnd !== 1) failed.push('oneAgentAudioTrack');
    if ((SCRIPTED || EXPECT_CART || OUTBOUND) && result.callSeconds > 45) failed.push('callUnder45s');
    result.failed = failed;
    result.pass = failed.length === 0;
    return result;
  } finally {
    if (micTimer) clearInterval(micTimer);
    if (camTimer) clearInterval(camTimer);
    try { await camTrack?.close(); } catch { /* ignore */ }
    try { await camSource?.close(); } catch { /* ignore */ }
    await room.disconnect().catch(() => {});
    await deleteRoomQuietly(roomName);
    activeRoom = null;
  }
}

const watchdog = setTimeout(async () => {
  console.log('[sim] FAIL timeout');
  if (activeRoom) await deleteRoomQuietly(activeRoom);
  process.exit(1);
}, CALLS * (SECONDS + (SAYS.length > 0 ? 60 : 45) + (OUTBOUND ? 20 : 0)) * 1000);
watchdog.unref();

// Speech and picture are prepared once, before any call (the watchdog above already covers this).
const speech = [];
for (const text of SAYS) speech.push(await speechPcm(text));
const picture = IMAGE
  ? new Uint8Array(await sharp(IMAGE).resize(WIDTH, HEIGHT, { fit: 'contain', background: '#ffffff' }).ensureAlpha().raw().toBuffer())
  : null;

const results = [];
for (let n = 1; n <= CALLS; n++) {
  let result;
  try {
    result = await runCall(n);
  } catch (error) {
    result = { call: n, pass: false, failed: [`error: ${error?.message ?? 'unknown'}`] };
  }
  results.push(result);
  console.log('RESULT ' + JSON.stringify(result));
  if (n < CALLS) await sleep(2000);
}

const bad = results.filter(r => !r.pass);
if (bad.length === 0) {
  console.log(`[sim] PASS ${results.length}/${results.length} calls`);
  process.exit(0);
}
for (const r of bad) console.log(`[sim] FAIL call ${r.call}: ${r.failed.join(', ')}`);
process.exit(1);
