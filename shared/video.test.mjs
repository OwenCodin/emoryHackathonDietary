import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { FPS, HEIGHT, SAFE_SCALE_DEFAULT, WIDTH, safeArea, safeScaleFrom, safeTransform } from './video.mjs';

const VIDEO_URL = pathToFileURL(new URL('./video.mjs', import.meta.url).pathname).href;
const from = v => safeScaleFrom({ VIDEO_SAFE_SCALE: v });

describe('safeScaleFrom', () => {
  it('defaults when unset, empty or invalid', () => {
    for (const env of [undefined, null, {}]) assert.equal(safeScaleFrom(env), 0.8);
    for (const v of ['', '   ', 'abc', 'NaN', 'Infinity', null, undefined, {}, true]) assert.equal(from(v), 0.8, String(v));
  });
  it('parses and clamps', () => {
    const cases = [['1', 1], ['0.7', 0.7], [' 0.9 ', 0.9], ['0.2', 0.5], ['0', 0.5], ['3', 1], ['-1', 0.5], [0.75, 0.75]];
    for (const [v, want] of cases) assert.equal(from(v), want, String(v));
    assert.equal(SAFE_SCALE_DEFAULT, 0.8);
  });
});

describe('safeArea and safeTransform', () => {
  it('computes the rectangle', () => {
    assert.deepEqual(safeArea(0.8), { x: 128, y: 72, width: 1024, height: 576, scale: 0.8 });
    assert.deepEqual(safeArea(1), { x: 0, y: 0, width: 1280, height: 720, scale: 1 });
    assert.ok(Object.isFrozen(safeArea(0.8)));
    assert.equal(safeTransform(1), 'translate(0 0) scale(1)');
    assert.equal(safeTransform(0.8), 'translate(128 72) scale(0.8)');
  });
});

describe('read once at import', () => {
  const run = v => {
    const code = `import(${JSON.stringify(VIDEO_URL)}).then(m => console.log(JSON.stringify({ s: m.SAFE_SCALE, safe: m.SAFE, w: m.WIDTH, h: m.HEIGHT, f: m.FPS })))`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, VIDEO_SAFE_SCALE: v }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  it('uses VIDEO_SAFE_SCALE from the environment', () => {
    for (const [v, want] of [['1', 1], ['abc', 0.8], ['0.2', 0.5]]) {
      const o = run(v);
      assert.equal(o.s, want);
      assert.equal(o.safe.scale, want);
      assert.deepEqual([o.w, o.h, o.f], [WIDTH, HEIGHT, FPS]);
    }
  });
});
