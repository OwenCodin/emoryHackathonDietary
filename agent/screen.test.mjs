import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { createScreen, cardMsFrom } from './screen.mjs';

const N = WIDTH * HEIGHT * 4;
const marker = svg => (svg.includes('YOUR RENAL DIETITIAN') ? 11 : svg.includes('YES') ? 22 : 33);
const okRender = async svg => new Uint8Array(N).fill(marker(svg));
const fallback = { frame: () => new Uint8Array(N).fill(99) };
const probe = f => f[0]; // pixel (0,0) is outside the wave band
const card = verdict => ({ items: [{ food: 'x', verdict, nutrients: null, portion: null, online: false }], more: 0, unjudged: false, seen: 1, online: false });
const make = (over = {}) => {
  const t = { now: 1000 };
  const logs = [];
  const screen = createScreen({ render: okRender, fallback, now: () => t.now, cardMs: 15000, log: m => logs.push(m), ...over });
  return { screen, t, logs };
};

describe('screen', () => {
  it('uses the fallback before idle is ready, then the brand screen', async () => {
    const { screen } = make();
    assert.equal(probe(screen.frame(0, false)), 99);
    await screen.flush();
    const a = screen.frame(0, false), b = screen.frame(1, true);
    assert.equal(probe(a), 11);
    assert.equal(a.length, N);
    assert.notEqual(a, b);
    a[0] = 5;
    assert.equal(probe(screen.frame(2, false)), 11);
  });
  it('shows a card, replaces it, and returns to idle after cardMs', async () => {
    const { screen, t } = make();
    await screen.flush();
    screen.show(card('ok')); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 22);
    screen.show(card('avoid')); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 33);
    t.now = 1000 + 15000 - 1;
    assert.equal(probe(screen.frame(0, false)), 33);
    t.now = 1000 + 15000;
    assert.equal(probe(screen.frame(0, false)), 11);
  });
  it('latest show wins when renders finish out of order', async () => {
    const gates = [];
    const render = svg => (svg.includes('YOUR RENAL') ? okRender(svg) : new Promise(res => gates.push(() => res(okRender(svg)))));
    const { screen } = make({ render });
    await screen.flush();
    screen.show(card('ok')); screen.show(card('avoid'));
    await new Promise(r => setImmediate(r));
    gates[1](); await new Promise(r => setImmediate(r));
    gates[0](); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 33);
  });
  it('a failed or slow card render keeps the previous screen', async () => {
    let mode = 'ok';
    const render = svg => (svg.includes('YOUR RENAL') || mode === 'ok' ? okRender(svg) : mode === 'fail' ? Promise.reject(new Error('x')) : new Promise(() => {}));
    const { screen, logs } = make({ render, renderTimeoutMs: 20 });
    await screen.flush();
    mode = 'fail'; screen.show(card('ok')); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 11);
    mode = 'hang'; screen.show(card('ok')); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 11);
    assert.equal(logs.filter(l => l.includes('card render failed')).length, 1);
  });
  it('a failed brand render uses the face, cards still work', async () => {
    const render = svg => (svg.includes('YOUR RENAL') ? Promise.reject(new Error('x')) : okRender(svg));
    const { screen, logs } = make({ render });
    await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 99);
    screen.show(card('ok')); await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 22);
    assert.equal(logs.length, 1);
  });
  it('ignores empty displays', async () => {
    const { screen } = make();
    await screen.flush();
    for (const d of [null, 'x', 5, {}, { items: [] }]) screen.show(d);
    await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 11);
  });
  it('frame never throws', async () => {
    const bad = { render: async () => ({ length: N }) };
    const { screen } = make(bad);
    await screen.flush();
    assert.equal(probe(screen.frame(0, false)), 99);
    const { screen: s2 } = make({ fallback: { frame: () => { throw new Error('x'); } }, render: async () => { throw new Error('y'); } });
    await s2.flush();
    const f = s2.frame(0, false);
    assert.equal(f.length, N);
  });
  it('frame returns zeros when painting and fallback both throw', async () => {
    const { screen } = make({ fallback: { frame: () => { throw new Error('x'); } } });
    await screen.flush();
    const f = screen.frame(0, undefined); // paints fine
    assert.equal(f.length, N);
    assert.equal(screen.frame(0, false).length, N);
  });
  it('cardMsFrom parses the env', () => {
    assert.equal(cardMsFrom({}), 15000);
    assert.equal(cardMsFrom({ AGENT_CARD_SECONDS: 'x' }), 15000);
    assert.equal(cardMsFrom({ AGENT_CARD_SECONDS: '0' }), 15000);
    assert.equal(cardMsFrom({ AGENT_CARD_SECONDS: '-3' }), 15000);
    assert.equal(cardMsFrom({ AGENT_CARD_SECONDS: '8' }), 8000);
    assert.equal(cardMsFrom({ AGENT_CARD_SECONDS: '9999' }), 120000);
  });
  it('real render smoke: idle frame is exact size and not the face', async () => {
    const real = createScreen({ log: () => {} });
    const face = createScreen({ render: async () => { throw new Error('x'); }, log: () => {} });
    await real.flush(); await face.flush();
    const a = real.frame(0, false), b = face.frame(0, false);
    assert.equal(a.length, N);
    assert.notDeepEqual(a, b);
  });
});
