import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, SAFE_SCALE_DEFAULT, WIDTH, safeArea } from '../shared/video.mjs';
import { VOICE_INDICATOR, brandSvg, cardSvg, cleanText, detailParts, escapeXml, fitText, paintVoiceIndicator, renderSvg, textWidth, VERDICTS, voiceIndicatorBand } from './card.mjs';

globalThis.fetch = async () => { throw new Error('network used'); };

const item = (over = {}) => ({ food: 'Banana', verdict: 'ok', nutrients: null, portion: null, online: false, ...over });
const one = over => cardSvg({ items: [item(over)], more: 0, unjudged: false, seen: 1, online: false });

describe('brandSvg', () => {
  it('has the brand text and size', () => {
    const s = brandSvg();
    assert.ok(s.startsWith('<svg'));
    assert.ok(s.includes(`width="${WIDTH}" height="${HEIGHT}"`));
    for (const t of ['RenaLine', 'YOUR RENAL DIETITIAN', 'A calm companion for food choices', 'care team&#39;s limits', 'aria-label="RenaLine voice companion"']) assert.ok(s.includes(t), t);
    assert.ok(!s.includes('aria-label="RenaLine AI nutrition companion"'));
  });
});

describe('cardSvg single', () => {
  const cases = [['ok', 'YES'], ['limit', 'MAYBE'], ['avoid', 'NO'], ['unknown', 'CHECK']];
  for (const [verdict, word] of cases) {
    it(`draws ${verdict}`, () => {
      const s = one({ verdict, nutrients: { sodiumMg: 100, potassiumMg: 200, phosphorusMg: 50 }, portion: '1 serving' });
      assert.ok(s.includes(`>${word}<`), word);
      assert.ok(s.includes(VERDICTS[verdict].color));
      assert.ok(s.includes(`id="icon-${verdict}"`));
    });
  }
  it('builds concise nutrient cards from tool numbers only', () => {
    const s = one({ nutrients: { sodiumMg: 1, potassiumMg: 422.6, phosphorusMg: 26 }, portion: '118 g' });
    assert.ok(s.includes('SODIUM') && s.includes('1 mg'));
    assert.ok(s.includes('POTASSIUM') && s.includes('423 mg'));
    assert.ok(s.includes('PHOSPHORUS') && s.includes('26 mg'));
    assert.ok(s.includes('Portion: 118 g'));
  });
  it('skips bad numbers and placeholder portions', () => {
    assert.deepEqual(detailParts({ nutrients: { sodiumMg: -1, potassiumMg: NaN, phosphorusMg: 5 }, portion: 'Not estimated' }), { nutrients: ['Phosphorus 5 mg'], portion: null });
    assert.deepEqual(detailParts({ nutrients: null, portion: 'unknown' }), { nutrients: [], portion: null });
    assert.equal(detailParts({ portion: '' }).portion, null);
    const s = one({ nutrients: null });
    assert.ok(!s.includes('Sodium') && !s.includes('Portion'));
  });
  it('adds protein and carbs tiles in grams after the minerals, only when numbers are given', () => {
    assert.deepEqual(detailParts({ nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7, proteinG: 37.2, carbsG: 0 } }).nutrients, ['Sodium 5 mg', 'Potassium 6 mg', 'Phosphorus 7 mg', 'Protein 37 g', 'Carbs 0 g']);
    assert.deepEqual(detailParts({ nutrients: { sodiumMg: 5, proteinG: -1, carbsG: NaN } }).nutrients, ['Sodium 5 mg']);
    assert.deepEqual(detailParts({ nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7 } }).nutrients, ['Sodium 5 mg', 'Potassium 6 mg', 'Phosphorus 7 mg']);
  });
  it('lays 4 and 5 nutrients out in two rows that stay inside the card', () => {
    const tileYs = s => [...s.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="16" fill="#0C2029"/g)].map(m => [Number(m[1]), Number(m[2])]);
    const five = one({ nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7, proteinG: 37, carbsG: 0 }, portion: '120 g' });
    assert.equal(tileYs(five).length, 5);
    assert.ok(five.includes('PROTEIN') && five.includes('37 g') && five.includes('CARBS') && five.includes('0 g'));
    assert.equal(tileYs(one({ nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7, proteinG: 37 } })).length, 4);
    const three = tileYs(one({ nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7 } }));
    assert.equal(three.length, 3);
    assert.equal(new Set(three.map(([y]) => y)).size, 1);
    // Two rows: the first three tiles share one y, the last two share a lower one, and nothing overlaps.
    const ys = tileYs(five);
    assert.equal(new Set(ys.slice(0, 3).map(([y]) => y)).size, 1);
    assert.equal(new Set(ys.slice(3).map(([y]) => y)).size, 1);
    assert.ok(ys[3][0] >= ys[0][0] + ys[0][1]);
    // Every tile and every line of text stays inside the card panel, with a long name and the online tag too.
    for (const svg of [five, cardSvg({ items: [item({ food: 'Low sodium chicken noodle soup with vegetables', nutrients: { sodiumMg: 5, potassiumMg: 6, phosphorusMg: 7, proteinG: 37, carbsG: 0 }, portion: '1 cup (240 mL)' })], online: true })]) {
      const panel = svg.match(/<rect x="500" y="(\d+)" width="730" height="(\d+)" rx="28"/);
      assert.ok(panel);
      const top = Number(panel[1]), bottom = top + Number(panel[2]);
      for (const [y, h] of tileYs(svg)) assert.ok(y >= top && y + h <= bottom, `tile y ${y} h ${h}`);
      const textYs = [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"/g)].filter(m => Number(m[1]) >= 500 && !m.input.slice(m.index, m.index + 200).includes('>FOOD CHECK<')).map(m => Number(m[2]));
      assert.ok(textYs.length > 8);
      for (const y of textYs) assert.ok(y > top && y < bottom, `text y ${y}`);
    }
  });
  it('online tag only when online', () => {
    const on = cardSvg({ items: [item()], online: true });
    assert.ok(on.includes('FOUND ONLINE'));
    assert.ok(!one().includes('FOUND ONLINE'));
  });
});

describe('cardSvg multi and unjudged', () => {
  it('shows three rows then +N more', () => {
    const items = ['a1', 'b2', 'c3', 'd4'].map((food, i) => item({ food, verdict: ['avoid', 'limit', 'ok', 'ok'][i] }));
    const s = cardSvg({ items, more: 2, unjudged: false, seen: 6 });
    assert.ok(s.indexOf('A1') < s.indexOf('B2') && s.indexOf('B2') < s.indexOf('C3'));
    assert.ok(!s.includes('>D4<')); // the bare letters also occur in a colour code
    assert.ok(s.includes('+3 more'));
    assert.ok(!s.includes('Sodium'));
  });
  it('unjudged has no verdict word', () => {
    const s = cardSvg({ items: [item({ verdict: null }), item({ verdict: null }), item({ verdict: null })], unjudged: true, seen: 3, more: 0 });
    assert.ok(s.includes('I can see 3 foods') && s.includes('can&#39;t judge them right now'));
    for (const w of ['>YES<', '>NO<', '>MAYBE<', '>CHECK<']) assert.ok(!s.includes(w), w);
    const s1 = cardSvg({ items: [item({ verdict: null })], unjudged: true, seen: 1 });
    assert.ok(s1.includes('I can see one food') && s1.includes('judge it'));
  });
  it('empty display falls back to the brand screen', () => {
    assert.equal(cardSvg({ items: [] }), brandSvg());
    assert.equal(cardSvg(null), brandSvg());
  });
});

describe('layout', () => {
  // Every text element's estimated right edge, in design pixels.
  const rightEdges = svg => [...svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-family="[^"]*" font-size="([\d.]+)" font-weight="(\d+)" fill="[^"]*" text-anchor="(\w+)">([^<]*)<\/text>/g)]
    .map(([, x, size, weight, anchor, body]) => {
      const w = textWidth(body.replace(/&[a-z#0-9]+;/g, 'x'), Number(size), Number(weight) >= 700);
      return { body, left: anchor === 'middle' ? Number(x) - w / 2 : Number(x), right: Number(x) + (anchor === 'middle' ? w / 2 : w) };
    });
  const screens = {
    brand: brandSvg(),
    single: one({ verdict: 'limit', food: 'Great Value Original Homestyle Chicken Noodle Soup Family Size', nutrients: { sodiumMg: 6400, potassiumMg: 3100, phosphorusMg: 1200 }, portion: '1 cup (240 g) as prepared with water' }),
    plain: one({ verdict: 'avoid', food: 'Star fruit' }),
    multi: cardSvg({ items: ['Pickles in brine with extra garlic and dill', 'Orange juice', 'Apples'].map((food, i) => item({ food, verdict: ['avoid', 'limit', 'ok'][i], nutrients: { sodiumMg: 800 } })), more: 2 }),
    unjudged: cardSvg({ items: [item({ food: 'A very long unjudged food name that keeps going and going on' })], unjudged: true, seen: 4 }),
  };
  it('never draws text past the right edge of the card', () => {
    for (const [name, svg] of Object.entries(screens)) {
      for (const t of rightEdges(svg)) if (t.left >= 500) assert.ok(t.right <= 1230 - 20, `${name}: "${t.body}" ends at ${Math.round(t.right)}`);
    }
  });
  it('keeps the At a glance heading above the first row', () => {
    const svg = screens.multi;
    const headingY = Number(svg.match(/y="([\d.]+)"[^>]*>At a glance</)[1]);
    const firstRowTop = Math.min(...[...svg.matchAll(/<rect x="524" y="([\d.]+)" width="682" height="96"/g)].map(m => Number(m[1])));
    assert.ok(Number.isFinite(firstRowTop) && headingY + 10 <= firstRowTop, `${headingY} vs ${firstRowTop}`);
  });
  it('leaves room between the badge icon and its word, for every verdict', () => {
    for (const verdict of ['ok', 'limit', 'avoid', 'unknown']) {
      const svg = one({ verdict });
      const iconX = Number(svg.match(new RegExp(`id="icon-${verdict}" transform="translate\\(([\\d.]+)`))[1]);
      const wordX = Number(svg.match(new RegExp(`<text x="([\\d.]+)"[^>]*>${VERDICTS[verdict].word}<`))[1]);
      assert.ok(wordX - (iconX + 36) >= 10, `${verdict}: ${wordX - iconX - 36}`);
    }
  });
  it('wraps a long food name onto two lines instead of cutting it at the first', () => {
    const svg = screens.single;
    assert.ok(svg.includes('>Great Value Original Homestyle<') || svg.includes('>Great Value Original<'), 'first line holds whole words');
    assert.ok(svg.includes('Chicken'));
  });
  it('fades the scene light out so no box shows inside the frame', () => {
    assert.ok(/<radialGradient id="scene"[^>]*>.*stop-opacity="0"\/><\/radialGradient>/s.test(brandSvg()));
    assert.ok(!brandSvg().includes('<linearGradient id="scene"'));
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

describe('render and voice indicator', () => {
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
  it('paints a warm halo that breathes at rest and pulses while speaking', () => {
    const band = voiceIndicatorBand(SAFE_SCALE_DEFAULT);
    const base = new Uint8Array(WIDTH * HEIGHT * 4).fill(7);
    const a = base.slice(), b = base.slice(), c = base.slice(), d = base.slice();
    const s = SAFE_SCALE_DEFAULT;
    paintVoiceIndicator(a, 5, true, s); paintVoiceIndicator(b, 5, false, s);
    paintVoiceIndicator(c, 0, false, s); paintVoiceIndicator(d, 7, false, s);
    assert.notDeepEqual(a, b);
    assert.notDeepEqual(c, d);
    const area = safeArea(s);
    const centerX = Math.round(area.x + VOICE_INDICATOR.x * s);
    const centerY = Math.round(area.y + VOICE_INDICATOR.center * s);
    const center = (centerY * WIDTH + centerX) * 4;
    assert.ok(b[center] > 220 && b[center + 1] > 200 && b[center] > b[center + 2], 'idle core should read as warm cream');
    for (const p of [a, b, c, d]) {
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        const index = (y * WIDTH + x) * 4;
        if (p[index] === 7 && p[index + 1] === 7 && p[index + 2] === 7 && p[index + 3] === 7) continue;
        assert.ok(x >= band.left && x < band.right && y >= band.top && y < band.bottom, `outside indicator ${x},${y}`);
      }
    }
  });
  it('voice indicator band stays centered over the companion mark', () => {
    assert.deepEqual(voiceIndicatorBand(1), { top: 242, bottom: 478, left: 152, right: 388 });
    assert.equal(VOICE_INDICATOR.top, 242);
  });
  it('voice indicator stays inside the safe rect at 0.8 for every tick', () => {
    const s = SAFE_SCALE_DEFAULT, a = safeArea(s), band = voiceIndicatorBand(s);
    for (let t = 0; t <= 60; t++) for (const speaking of [true, false]) {
      const p = new Uint8Array(WIDTH * HEIGHT * 4).fill(7);
      paintVoiceIndicator(p, t, speaking, s);
      for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
        const index = (y * WIDTH + x) * 4;
        if (p[index] === 7 && p[index + 1] === 7 && p[index + 2] === 7 && p[index + 3] === 7) continue;
        assert.ok(x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height, `outside safe ${x},${y}`);
        assert.ok(x >= band.left && x < band.right && y >= band.top && y < band.bottom, `outside band ${x},${y}`);
      }
    }
  });
});

describe('safe area rendering', () => {
  const s = SAFE_SCALE_DEFAULT;
  const MX = Math.floor(0.09 * WIDTH), MY = Math.floor(0.09 * HEIGHT);
  const BG = [20, 40, 39, 255];
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
