import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wavPcm } from './speech.mjs';

function chunk(id, body) {
  const h = Buffer.alloc(8);
  h.write(id, 0, 'ascii');
  h.writeUInt32LE(body.length, 4);
  return Buffer.concat([h, body, body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

describe('wavPcm', () => {
  it('parses samples past an odd-length LIST chunk', () => {
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(1, 2); fmt.writeUInt32LE(48000, 4);
    fmt.writeUInt32LE(96000, 8); fmt.writeUInt16LE(2, 12); fmt.writeUInt16LE(16, 14);
    const data = Buffer.alloc(8);
    [0, 1000, -1000, 32767].forEach((v, i) => data.writeInt16LE(v, i * 2));
    const body = Buffer.concat([Buffer.from('WAVE'), chunk('fmt ', fmt), chunk('LIST', Buffer.from('abc')), chunk('data', data)]);
    const head = Buffer.alloc(8);
    head.write('RIFF', 0, 'ascii');
    head.writeUInt32LE(body.length, 4);
    const r = wavPcm(Buffer.concat([head, body]));
    assert.deepEqual([...r.samples], [0, 1000, -1000, 32767]);
    assert.equal(r.sampleRate, 48000);
    assert.equal(r.channels, 1);
  });
  it('rejects non-RIFF', () => {
    assert.throws(() => wavPcm(Buffer.from('hello world, not a wav')), /not a 16-bit PCM WAV/);
  });
});

describe('speechPcm input checks', () => {
  it('rejects empty, dash-leading and over-long text before running anything', async () => {
    const { speechPcm, MAX_SPEECH_CHARS } = await import('./speech.mjs');
    for (const t of ['', '  ', '-x', 'a'.repeat(MAX_SPEECH_CHARS + 1), 5]) {
      await assert.rejects(() => speechPcm(t), /bad speech text/);
    }
  });
});
