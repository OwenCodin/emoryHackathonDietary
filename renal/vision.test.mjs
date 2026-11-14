import assert from 'node:assert/strict';
import test from 'node:test';
import { describeImage } from './vision.mjs';

test('describeImage asks for generic food names on plates, fridges and shelves and keeps printed label text', async () => {
  const captured = [];
  const ai = {
    models: {
      generateContent: async (params) => {
        captured.push(params);
        return { text: JSON.stringify({ kind: 'fridge', foods: [{ name: 'lettuce', grams: null }], label: null }) };
      },
    },
  };
  const seen = await describeImage({ jpeg: Buffer.from([1, 2, 3]) }, { ai });
  assert.equal(seen.ok, true);
  assert.equal(seen.kind, 'fridge');
  const text = captured[0].contents[0].parts.find((part) => typeof part.text === 'string').text;
  assert.match(text, /plate, fridge or shelf/);
  assert.match(text, /generic food name/);
  assert.match(text, /without brand names/);
  assert.match(text, /low sodium|unsalted|smoked/);
  assert.match(text, /exactly as printed/);
  assert.match(text, /product name/);
});
