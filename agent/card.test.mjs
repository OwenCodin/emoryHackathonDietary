import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { WAVE, brandSvg, cardSvg, cleanText, detailParts, escapeXml, fitText, paintWave, renderSvg, VERDICTS } from './card.mjs';

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
    const base = new Uint8Array(WIDTH * HEIGHT * 4).fill(7);
    const a = base.slice(), b = base.slice(), c = base.slice(), d = base.slice();
    paintWave(a, 5, true); paintWave(b, 5, false); paintWave(c, 0, false); paintWave(d, 7, false);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(c, d);
    for (const p of [a, b, c, d]) {
      for (let y = 0; y < HEIGHT; y++) {
        if (y >= WAVE.top && y < WAVE.bottom) continue;
        const row = y * WIDTH * 4;
        assert.ok(p.subarray(row, row + WIDTH * 4).every(v => v === 7), `row ${y}`);
      }
    }
  });
});
