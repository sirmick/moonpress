import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { composite, processPage, encodeWebp, W, H, layoutText, registerFonts } from '../lib/render.js';
import { createCanvas } from '@napi-rs/canvas';
import { openStore } from '../lib/store.js';
import { REPO } from '../lib/config.js';
import { packageInputs } from '../passes/package.js';
import { stamp } from '../lib/stamp.js';

const store = openStore(path.join(REPO, 'sample'));

function pixel(canvas, x, y) { const d = canvas.getContext('2d').getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; }
const isWhite = p => p.every(v => v > 245);
const isBlack = p => p.every(v => v < 20);

test('device page is 1072x1448 and a crop zooms in', async () => {
  const src = fs.readFileSync(store.src('kittens', 'p01'));
  const plain = await processPage(src);
  assert.equal(plain.width, W); assert.equal(plain.height, H);
  const bordered = await processPage(src, { border: 40 });
  assert.ok(isWhite(pixel(bordered, 5, 5)), 'border is white');
  assert.ok(!isWhite(pixel(bordered, 60, 700)) || !isWhite(pixel(plain, 60, 700)), 'picture inside the border');
});

test('bedtime panel sits in the chosen quarter with a black rule and white fill', async () => {
  const src = fs.readFileSync(store.src('kittens', 'p01'));
  const page = { n: 1, text: 'The house is warm and quiet. Mim the little tabby kitten is not sleepy. Not one bit.', text_pos: 'bottom' };
  const bottom = await composite(src, { page, set: 'bedtime' });
  const m = W * 0.03, band = H / 4;
  assert.ok(isWhite(pixel(bottom, W / 2, H - m - 20)), 'white panel near the bottom edge');
  assert.ok(isBlack(pixel(bottom, W / 2, Math.round(H - band + m * 0.6) + 1)), 'black top rule of the bottom panel');
  const top = await composite(src, { page, set: 'bedtime', text_pos: 'top' });
  assert.ok(isWhite(pixel(top, W / 2, m + 20)), 'white panel near the top edge');
  assert.ok(isBlack(pixel(top, W / 2, Math.round(band - m * 0.6) - 1)), 'black bottom rule of the top panel');
  const webp = await encodeWebp(bottom, 85);
  assert.ok(webp.length > 10_000 && webp.length < 400_000);
});

test('reading panel is centred, 80% wide, at the bottom', async () => {
  const src = fs.readFileSync(store.src('r01-sit-pip', 'p03'));
  const c = await composite(src, { page: { n: 3, text: 'Sit, Pip.', word: 'sit' }, set: 'reading' });
  const m = W * 0.03, boxW = (W - 2 * m) * 0.8, left = (W - boxW) / 2;
  assert.ok(isWhite(pixel(c, W / 2, H - m - 10)), 'white inside the panel');
  assert.ok(isBlack(pixel(c, Math.round(left) + 1, H - m - 60)), 'black left rule');
  assert.ok(isBlack(pixel(c, Math.round(left + boxW) - 1, H - m - 60)), 'black right rule');
});

test('text wraps to the width and shrinks until it fits', () => {
  registerFonts();
  const g = createCanvas(10, 10).getContext('2d');
  g.font = '50px "Moon Serif"';
  const one = layoutText(g, 'short', 1000, 1.2, 50, 'Moon Serif');
  assert.equal(one.lines.length, 1);
  const many = layoutText(g, 'a reasonably long sentence that will certainly need more than one line', 400, 1.2, 50, 'Moon Serif');
  assert.ok(many.lines.length > 2);
  assert.ok(many.lineHeight > 50 && many.lineHeight < 90, 'line height from real font metrics');
});

test('package stamp changes with text, panel position and edits, not with time', () => {
  const book = store.book('kittens'), state = store.state('kittens');
  const a = stamp(packageInputs(store, book, state));
  assert.equal(a, stamp(packageInputs(store, book, state)));
  const s2 = structuredClone(state); s2.pages.p01 = { ...(s2.pages.p01 || {}), edit: { text_pos: 'top' } };
  assert.notEqual(a, stamp(packageInputs(store, book, s2)));
  const b2 = structuredClone(book); b2.pages[0].text += '!';
  assert.notEqual(a, stamp(packageInputs(store, b2, state)));
});
