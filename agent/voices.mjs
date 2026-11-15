// The two voices a caller can choose in setup, each with a short recorded sample so they can hear it first.
// The samples are 24 kHz mono 16-bit PCM made once with Gemini speech (see agent/voices/README.md).
import { readFile } from 'node:fs/promises';
import { AudioFrame } from '@livekit/rtc-node';

export const SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 480; // 20 ms
export const VOICE_SAMPLES = Object.freeze([
  Object.freeze({ number: 1, voice: 'Puck', text: 'This is voice one. I am here to help you eat well for your kidneys.', file: new URL('./voices/voice-1.pcm', import.meta.url) }),
  Object.freeze({ number: 2, voice: 'Sulafat', text: 'This is voice two. I am here to help you eat well for your kidneys.', file: new URL('./voices/voice-2.pcm', import.meta.url) }),
]);

// PCM bytes as 20 ms AudioFrames, with a short silence after so two samples do not run together. Pure.
export function pcmFrames(pcm, { tailMs = 400 } = {}) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const total = samples.length + Math.round(SAMPLE_RATE * tailMs / 1000);
  const frames = [];
  for (let i = 0; i < total; i += FRAME_SAMPLES) {
    const data = new Int16Array(FRAME_SAMPLES);
    if (i < samples.length) data.set(samples.subarray(i, Math.min(i + FRAME_SAMPLES, samples.length)));
    frames.push(new AudioFrame(data, SAMPLE_RATE, 1, FRAME_SAMPLES));
  }
  return frames;
}

const streamOf = frames => new ReadableStream({ start(controller) { for (const f of frames) controller.enqueue(f); controller.close(); } });

// Queues both samples on the session, in order, ahead of the model's next reply. Returns how many were queued.
// Never throws: a missing file or a session that cannot play audio gives 0.
export async function playVoiceSamples(session, { read = readFile } = {}) {
  try {
    const loaded = [];
    for (const s of VOICE_SAMPLES) loaded.push({ s, frames: pcmFrames(await read(s.file)) });
    for (const { s, frames } of loaded) session.say(s.text, { audio: streamOf(frames), allowInterruptions: false, addToChatCtx: false });
    return loaded.length;
  } catch {
    return 0;
  }
}
