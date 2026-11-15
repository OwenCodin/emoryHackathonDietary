import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attachAudioLevelMeter, measureAudioLevel } from './audio-level.mjs';

describe('agent audio level meter', () => {
  it('measures real floating-point and signed PCM frame amplitude', () => {
    assert.equal(measureAudioLevel({ data: new Float32Array(20) }), 0);
    assert.ok(measureAudioLevel({ data: new Float32Array(20).fill(0.2) }) > 0.5);
    assert.ok(measureAudioLevel({ data: new Int16Array(20).fill(12000) }) > 0.9);
    assert.equal(measureAudioLevel({ data: new Uint8Array(1) }), null);
  });

  it('measures byte-backed PCM without changing the forwarded frame', async () => {
    const pcm = new Int16Array(20).fill(8192);
    const bytes = new Uint8Array(pcm.buffer);
    const frame = { data: bytes };
    let forwarded = false;
    let level = null;
    const output = { captureFrame(value) { forwarded = value === frame; } };
    assert.equal(attachAudioLevelMeter(output, value => { level = value; }), true);
    await output.captureFrame(frame);
    assert.equal(forwarded, true);
    assert.ok(level > 0);
  });

  it('leaves incompatible output objects alone', () => {
    assert.equal(attachAudioLevelMeter(null, () => {}), false);
    assert.equal(attachAudioLevelMeter({ captureFrame() {} }, null), false);
  });
});
