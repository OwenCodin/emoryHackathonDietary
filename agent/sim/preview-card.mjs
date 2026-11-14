// Offline preview of the idle screen and sample verdict cards as PNG files.
// Usage: node agent/sim/preview-card.mjs <outDir>   (outDir must be outside the repository)
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { HEIGHT, WIDTH } from '../../shared/video.mjs';
import { brandSvg, cardSvg, paintWave, renderSvg } from '../card.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const isInside = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const refuse = message => { console.error(`preview-card: ${message}`); process.exit(1); };

const arg = process.argv[2];
if (!arg) refuse('usage: node agent/sim/preview-card.mjs <outDir outside the repository>');
const outDir = resolve(arg);
if (isInside(REPO_ROOT, outDir)) refuse('refusing to write inside the repository');
await mkdir(outDir, { recursive: true });
if (isInside(await realpath(REPO_ROOT), await realpath(outDir))) refuse('refusing to write inside the repository');

const it = (food, verdict, over = {}) => ({ food, verdict, nutrients: null, portion: null, online: false, ...over });
const one = i => ({ items: [i], more: 0, unjudged: false, seen: 1, online: i.online });
const samples = [
  ['03-yes-banana', one(it('Banana', 'ok', { nutrients: { sodiumMg: 1, potassiumMg: 422, phosphorusMg: 26 }, portion: '1 medium (118 g)' }))],
  ['04-small-portion-long-name', one(it('Great Value Original Homestyle Hearty Chicken Noodle Soup With Extra Vegetables, Family Size', 'limit', { nutrients: { sodiumMg: 640, potassiumMg: 310, phosphorusMg: 120 }, portion: '1 cup (240 g)' }))],
  ['05-no', one(it('Star fruit', 'avoid'))],
  ['06-cant-tell', one(it('Mystery casserole', 'unknown'))],
  ['07-fridge-three', { items: [it('Pickles', 'avoid'), it('Orange juice', 'limit'), it('Apples', 'ok'), it('Eggs', 'ok')], more: 1, unjudged: false, seen: 5, online: false }],
  ['08-unjudged', { items: [it('Milk', null), it('Cheese', null), it('Bread', null)], more: 0, unjudged: true, seen: 3, online: false }],
  ['09-online', one(it("Trader Joe's Mango Salsa", 'limit', { online: true, nutrients: { sodiumMg: 180, potassiumMg: null, phosphorusMg: 10 }, portion: '2 tbsp (30 g)' }))],
  ['10-escaping', one(it('</svg><script>alert(1)</script> & "quotes"', 'ok'))],
];

const written = [];
const save = async (name, pixels) => {
  const file = join(outDir, `${name}.png`);
  await sharp(Buffer.from(pixels), { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toFile(file);
  written.push(file);
};

const brand = await renderSvg(brandSvg());
const idle = brand.slice(); paintWave(idle, 5, false);
await save('01-idle', idle);
const talking = brand.slice(); paintWave(talking, 5, true);
await save('02-idle-speaking', talking);
for (const [name, display] of samples) {
  const px = await renderSvg(cardSvg(display));
  paintWave(px, 5, true);
  await save(name, px);
}
for (const f of written) console.log(f);
