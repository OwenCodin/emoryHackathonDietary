import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { createOrbPainter } from './orb.mjs';

const blank = () => {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;
  return pixels;
};

describe('orb animation', () => {
  it('paints within the video buffer and smoothly responds to real audio-level input', () => {
    const paint = createOrbPainter({ now: () => 0 });
    const quiet = blank();
    const loud = blank();
    paint(quiet, { state: 'speaking', outputLevel: 0, time: 1000 });
    paint(loud, { state: 'speaking', outputLevel: 0.8, time: 1040 });
    assert.equal(quiet.length, WIDTH * HEIGHT * 4);
    assert.ok(quiet.some((value, index) => value !== loud[index]));
  });

  it('keeps reduced motion free of listening and speaking ripple rings', () => {
    const paint = createOrbPainter({ reducedMotion: true, now: () => 0 });
    const quiet = blank();
    const loud = blank();
    paint(quiet, { state: 'speaking', outputLevel: 0, time: 1000 });
    paint(loud, { state: 'speaking', outputLevel: 1, time: 1000 });
    assert.equal(quiet.length, HEIGHT * WIDTH * 4);
    assert.ok(!quiet.some((value, index) => value !== loud[index]));
  });
});
