import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, SAFE_SCALE_DEFAULT, WIDTH, safeArea } from '../shared/video.mjs';
import { WAVE, brandSvg, cardSvg, cleanText, detailParts, escapeXml, fitText, paintWave, renderSvg, VERDICTS, waveBand } from './card.mjs';

globalThis.fetch = async () => { throw new Error('network used'); };

const item = (over = {}) => ({ food: 'Banana', verdict: 'ok', nutrients: null, portion: null, online: false, ...over });
const one = over => cardSvg({ items: [item(over)], more: 0, unjudged: false, seen: 1, online: false });

describe('brandSvg', () => {
  it('has the brand text and size', () => {
    const s = brandSvg();
    assert.ok(s.startsWith('<svg'));
    assert.ok(s.includes(`width="${WIDTH}" height="${HEIGHT}"`));
    for (const t of ['RenaLine', 'Your renal dietitian', 'Follows your care team&#39;s limits']) assert.ok(s.includes(t), t);
  });
});

describe('cardSvg single', () => {
  const cases = [['ok', 'YES'], ['limit', 'SMALL PORTION'], ['avoid', 'NO'], ['unknown', 'CAN&#39;T TELL']];
  for (const [verdict, word] of cases) {
    it(`draws ${verdict}`, () => {
      const s = one({ verdict });
      assert.ok(s.includes(`>${word}<`), word);
      assert.ok(s.includes(VERDICTS[verdict].color));
      assert.ok(s.includes(`id="icon-${verdict}"`));
    });
  }
  it('builds the detail line from tool numbers only', () => {
    const s = one({ nutrients: { sodiumMg: 1, potassiumMg: 422.6, phosphorusMg: 26 }, portion: '118 g' });
    assert.ok(s.includes('Sodium 1 mg · Potassium 423 mg · Phosphorus 26 mg'));
    assert.ok(s.includes('Portion: 118 g'));
  });
  it('skips bad numbers and placeholder portions', () => {
    assert.deepEqual(detailParts({ nutrients: { sodiumMg: -1, potassiumMg: NaN, phosphorusMg: 5 }, portion: 'Not estimated' }), { nutrients: ['Phosphorus 5 mg'], portion: null });
    assert.deepEqual(detailParts({ nutrients: null, portion: 'unknown' }), { nutrients: [], portion: null });
    assert.equal(detailParts({ portion: '' }).portion, null);
    const s = one({ nutrients: null });
    assert.ok(!s.includes('Sodium') && !s.includes('Portion'));
  });
  it('online tag only when online', () => {
    const on = cardSvg({ items: [item()], online: true });
    assert.ok(on.includes('Found online'));
    assert.ok(!one().includes('Found online'));
  });
});

describe('cardSvg multi and unjudged', () => {
  it('shows three rows then +N more', () => {
    const items = ['a1', 'b2', 'c3', 'd4'].map((food, i) => item({ food, verdict: ['avoid', 'limit', 'ok', 'ok'][i] }));
    const s = cardSvg({ items, more: 2, unjudged: false, seen: 6 });
    assert.ok(s.indexOf('A1') < s.indexOf('B2') && s.indexOf('B2') < s.indexOf('C3'));
    assert.ok(!s.includes('D4'));
    assert.ok(s.includes('+3 more'));
    assert.ok(!s.includes('Sodium'));
  });
  it('unjudged has no verdict word', () => {
    const s = cardSvg({ items: [item({ verdict: null }), item({ verdict: null }), item({ verdict: null })], unjudged: true, seen: 3, more: 0 });
    assert.ok(s.includes('I can see 3 foods') && s.includes('can&#39;t judge them right now'));
    for (const w of ['>YES<', '>NO<', '>SMALL PORTION<', 'CAN&#39;T TELL']) assert.ok(!s.includes(w), w);
    const s1 = cardSvg({ items: [item({ verdict: null })], unjudged: true, seen: 1 });
    assert.ok(s1.includes('I can see one food') && s1.includes('judge it'));
  });
  it('empty display falls back to the brand screen', () => {
    assert.equal(cardSvg({ items: [] }), brandSvg());
    assert.equal(cardSvg(null), brandSvg());
  });
});

describe('text safety', () => {
  it('escapes hostile names into a single svg root', () => {
    for (const food of ['<b>', 'Tom & Jerry\'s "best"', '</svg><script>alert(1)</script>']) {
      const s = one({ food });
      assert.ok(!s.includes('<script') && !s.includes('<b>'));
      assert.equal(s.split('<svg').length - 1, 1);
      assert.equal(s.split('</svg>').length - 1, 1);
    }
    const s = one({ food: 'Tom & Jerry\'s "best" <x>' });
    for (const e of ['&amp;', '&quot;', '&#39;', '&lt;']) assert.ok(s.includes(e), e);
    assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });
  it('cuts long names with an ellipsis', () => {
    for (const food of ['x'.repeat(200), 'word '.repeat(40)]) {
      const s = one({ food });
      assert.ok(s.includes('…'));
      assert.ok(s.length < 6000);
    }
    const f = fitText('x'.repeat(100), { max: 60, min: 60, width: 500, bold: true });
    assert.ok(f.text.endsWith('…'));
  });
  it('handles emoji and surrogate pairs', () => {
    assert.ok(one({ food: '🍌🍎' }).includes('This food'));
    assert.ok(one({ food: 'apple 🍎' }).includes('Apple'));
    const cut = cleanText('a😀b' + '𠮷'.repeat(10), 5);
    assert.equal(Array.from(cut).length, 5);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(cut));
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(fitText('𠮷'.repeat(200), { max: 60, min: 44, width: 400 }).text));
  });
  it('ignores personal keys', () => {
    const s = cardSvg({ items: [item()], name: 'Sam', phone: '+15551234567', patientId: 'demo', unjudged: false });
    for (const t of ['Sam', '5551234567', 'demo']) assert.ok(!s.includes(t), t);
  });
});

describe('render and wave', () => {
  it('renders exact size, offset 0, not flat', async () => {
    for (const svg of [brandSvg(), one({ verdict: 'avoid' })]) {
      const px = await renderSvg(svg);
      assert.ok(px instanceof Uint8Array);
      assert.equal(px.length, WIDTH * HEIGHT * 4);
      assert.equal(px.byteOffset, 0);
      assert.ok(px.some((b, i) => b !== px[i % 4]));
    }
  });
  it('rejects on timeout', async () => {
    await assert.rejects(renderSvg(brandSvg(), { timeoutMs: 0 }));
  });
  it('paints only inside the band and moves', () => {
    const band = waveBand(SAFE_SCALE_DEFAULT);
    const base = new Uint8Array(WIDTH * HEIGHT * 4).fill(7);
    const a = base.slice(), b = base.slice(), c = base.slice(), d = base.slice();
    const s = SAFE_SCALE_DEFAULT;
    paintWave(a, 5, true, s); paintWave(b, 5, false, s); paintWave(c, 0, false, s); paintWave(d, 7, false, s);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(c, d);
    for (const p of [a, b, c, d]) {
      for (let y = 0; y < HEIGHT; y++) {
        if (y >= band.top && y < band.bottom) continue;
        const row = y * WIDTH * 4;
        assert.ok(p.subarray(row, row + WIDTH * 4).every(v => v === 7), `row ${y}`);
      }
    }
  });
  it('waveBand at scale 1 is the old band', () => {
    assert.deepEqual(waveBand(1), { top: 505, bottom: 585, left: 135, right: 1145 });
    assert.equal(WAVE.top, 505);
  });
  it('wave stays inside the safe rect at 0.8 for every tick', () => {
    const s = SAFE_SCALE_DEFAULT, a = safeArea(s), band = waveBand(s);
    for (let t = 0; t <= 60; t++) for (const speaking of [true, false]) {
      const p = new Uint8Array(WIDTH * HEIGHT * 4).fill(7);
      paintWave(p, t, speaking, s);
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        if (p[(y * WIDTH + x) * 4] === 7) continue;
        assert.ok(x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height, `outside safe ${x},${y}`);
        assert.ok(y >= band.top && y < band.bottom, `outside band ${y}`);
      }
    }
  });
});

describe('safe area rendering', () => {
  const s = SAFE_SCALE_DEFAULT;
  const MX = Math.floor(0.09 * WIDTH), MY = Math.floor(0.09 * HEIGHT);
  const BG = [15, 36, 48, 255];
  const bandOnly = px => {
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      if (x >= MX && x < WIDTH - MX && y >= MY && y < HEIGHT - MY) continue;
      const i = (y * WIDTH + x) * 4;
      if (BG.some((v, k) => px[i + k] !== v)) return false;
    }
    return true;
  };
  const insideHasContent = px => {
    for (let y = MY; y < HEIGHT - MY; y++) for (let x = MX; x < WIDTH - MX; x++) {
      const i = (y * WIDTH + x) * 4;
      if (px[i] !== BG[0] || px[i + 1] !== BG[1] || px[i + 2] !== BG[2]) return true;
    }
    return false;
  };
  const many = n => Array.from({ length: n }, (_, k) => item({ food: `Food number ${k + 1}`, verdict: ['ok', 'limit', 'avoid', 'unknown'][k % 4] }));
  const displays = {
    brand: null,
    ok: { items: [item({ verdict: 'ok' })] },
    limit: { items: [item({ verdict: 'limit', food: 'A very long food name that goes on and on for a while', nutrients: { sodiumMg: 300, potassiumMg: 400, phosphorusMg: 100 }, portion: 'half cup' })] },
    avoid: { items: [item({ verdict: 'avoid' })] },
    unknown: { items: [item({ verdict: 'unknown' })] },
    multi: { items: many(4), more: 2 },
    unjudged: { items: [item()], unjudged: true, seen: 2 },
    online: { items: [item()], online: true },
  };
  for (const [name, d] of Object.entries(displays)) {
    it(`keeps the outer 9% background-only: ${name}`, async () => {
      const svg = d ? cardSvg(d, { scale: s }) : brandSvg({ scale: s });
      const px = await renderSvg(svg);
      assert.equal(px.length, WIDTH * HEIGHT * 4);
      assert.ok(bandOnly(px), 'content in the margin');
      assert.ok(insideHasContent(px));
    });
  }
  it('scale 1 reproduces the old layout', async () => {
    assert.ok(brandSvg({ scale: 1 }).includes('scale(1)'));
    const svg = cardSvg(displays.ok, { scale: 1 });
    assert.ok(svg.includes('scale(1)'));
    const px = await renderSvg(svg);
    assert.ok(!bandOnly(px));
  });
});
