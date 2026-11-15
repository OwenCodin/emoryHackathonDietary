import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { VOICE_MENU } from './prefs.mjs';
import { SAMPLE_RATE, VOICE_SAMPLES, pcmFrames, playVoiceSamples } from './voices.mjs';

describe('voice samples', () => {
  it('has a recorded sample of two to eight seconds for each of the two voices, both in the voice menu', async () => {
    assert.deepEqual(VOICE_SAMPLES.map(s => s.number), [1, 2]);
    for (const s of VOICE_SAMPLES) {
      assert.ok(Object.values(VOICE_MENU).includes(s.voice), s.voice);
      const seconds = (await readFile(s.file)).byteLength / 2 / SAMPLE_RATE;
      assert.ok(seconds >= 2 && seconds <= 8, `${s.number}: ${seconds}`);
      assert.ok(!/\bman|woman|male|female\b/i.test(s.text));
    }
  });
  it('cuts PCM into 20 ms frames and adds a short silence', () => {
    const pcm = Buffer.alloc(2 * 1000, 1);
    const frames = pcmFrames(pcm, { tailMs: 100 });
    assert.equal(frames.length, Math.ceil((1000 + 2400) / 480));
    for (const f of frames) { assert.equal(f.sampleRate, 24000); assert.equal(f.channels, 1); assert.equal(f.samplesPerChannel, 480); }
    assert.equal(frames.at(-1).data.every(x => x === 0), true);
  });
  it('queues both samples in order, uninterruptible and outside the chat history', async () => {
    const said = [];
    const session = { say: (text, options) => { said.push({ text, options }); } };
    assert.equal(await playVoiceSamples(session), 2);
    assert.deepEqual(said.map(s => s.text), VOICE_SAMPLES.map(s => s.text));
    for (const s of said) {
      assert.equal(s.options.allowInterruptions, false);
      assert.equal(s.options.addToChatCtx, false);
      assert.ok(s.options.audio instanceof ReadableStream);
    }
  });
  it('queues nothing and never throws when a file is missing or the session cannot speak', async () => {
    const said = [];
    assert.equal(await playVoiceSamples({ say: () => said.push(1) }, { read: async () => { throw new Error('missing'); } }), 0);
    assert.equal(said.length, 0);
    assert.equal(await playVoiceSamples({ say: () => { throw new Error('no audio'); } }), 0);
  });
});
