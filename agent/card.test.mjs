import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEIGHT, WIDTH } from '../shared/video.mjs';
import { cleanText, escapeXml, panelSvg, renderSvg, sceneSvg, UI_TOKENS } from './card.mjs';

describe('call UI scene', () => {
  it('uses the 16:9 video frame, calm design tokens and single-panel layout', () => {
    const svg = sceneSvg();
    assert.ok(svg.includes(`width="${WIDTH}" height="${HEIGHT}"`));
    assert.ok(svg.includes('Ready'));
    assert.ok(svg.includes('safeTransform') === false);
    assert.equal(UI_TOKENS.transitionMs, 400);
    assert.equal(UI_TOKENS.type.body, 22);
    assert.ok(!svg.includes('<image'));
    assert.ok(panelSvg().includes('Today'));
  });

  it('renders each panel type without introducing a second card', () => {
    const events = [
      { type: 'summary', meters: [{ key: 'fluid', label: 'Fluid', used: 400, limit: 1200, unit: 'ml' }] },
      { type: 'verdict', verdict: 'yes', food: 'Apples', reason: 'Reason supplied by the backend.' },
      { type: 'verdict', verdict: 'caution', food: 'Soup', reason: 'Reason supplied by the backend.' },
      { type: 'verdict', verdict: 'no', food: 'Snack', reason: 'Reason supplied by the backend.' },
      { type: 'note', heading: 'A note', body: 'Information from the agent.' },
      { type: 'cart', items: [{ name: 'Apples' }], status: 'draft' },
    ];
    for (const event of events) {
      const svg = panelSvg(event);
      assert.equal(svg.split('<rect x="110" y="415"').length - 1, 2);
    }
    assert.ok(panelSvg(events[1]).includes('YES'));
    assert.ok(panelSvg(events[2]).includes('CAUTION'));
    assert.ok(panelSvg(events[3]).includes('NO'));
    assert.ok(panelSvg(events[5]).includes('Draft'));
  });

  it('escapes hostile user strings and truncates long display text', () => {
    const svg = panelSvg({
      type: 'verdict', verdict: 'no', food: '</text><script>', reason: 'A & B'.repeat(60),
    });
    assert.ok(!svg.includes('<script>'));
    assert.ok(svg.includes('&lt;/text&gt;'));
    assert.ok(svg.includes('…'));
    assert.equal(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
    assert.equal(cleanText('a\u0000  b', 10), 'a b');
  });

  it('renders exact-size RGBA output', async () => {
    const pixels = await renderSvg(panelSvg({
      type: 'note', heading: 'Call your dietitian', body: 'Information provided by the agent.',
    }));
    assert.ok(pixels instanceof Uint8Array);
    assert.equal(pixels.length, WIDTH * HEIGHT * 4);
    assert.ok(pixels.some((value, index) => value !== pixels[index % 4]));
  });
});
