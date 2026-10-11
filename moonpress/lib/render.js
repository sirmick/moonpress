// The one renderer: crop, fit, autocontrast, text panel. A port of the reader's PageView.java,
// so what the inspector sees and what the web shows is what the device draws.
import path from 'node:path';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { PKG } from './config.js';

export const W = 1072, H = 1448;
const SERIF = 'Moon Serif', SANS = 'Moon Sans';
let fontsReady = false;

export function registerFonts() {
  if (fontsReady) return;
  const d = path.join(PKG, 'fonts');
  GlobalFonts.registerFromPath(path.join(d, 'NotoSerif-Regular.ttf'), SERIF);
  GlobalFonts.registerFromPath(path.join(d, 'NotoSerif-Bold.ttf'), SERIF);
  GlobalFonts.registerFromPath(path.join(d, 'Andika-Regular.ttf'), SANS);
  GlobalFonts.registerFromPath(path.join(d, 'Andika-Bold.ttf'), SANS);
  fontsReady = true;
}

export async function decode(buf) { return loadImage(buf); }

/** Re-encode any image bytes as WebP at the given quality, pixels untouched. */
export async function toWebp(buf, quality = 92) {
  const im = await loadImage(buf);
  const c = createCanvas(im.width, im.height);
  c.getContext('2d').drawImage(im, 0, 0);
  return c.encode('webp', quality);
}

/** PIL-style autocontrast: per channel, clip `cutoff` of pixels at each end and stretch. */
export function autocontrast(g, w, h, cutoff = 0.005) {
  const id = g.getImageData(0, 0, w, h), d = id.data, cut = w * h * cutoff;
  for (let ch = 0; ch < 3; ch++) {
    const hist = new Uint32Array(256);
    for (let i = ch; i < d.length; i += 4) hist[d[i]]++;
    let lo = 0, hi = 255, acc = 0;
    while (lo < 255 && (acc += hist[lo]) <= cut) lo++;
    acc = 0; while (hi > 0 && (acc += hist[hi]) <= cut) hi--;
    if (hi <= lo) continue;
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = (v - lo) * 255 / (hi - lo);
    for (let i = ch; i < d.length; i += 4) d[i] = lut[d[i]];
  }
  g.putImageData(id, 0, 0);
}

export const FRAMES = ['full', 'square', 'rounded'];

/**
 * A book's frame policy, the same on every page: 'full' runs the picture to the edges; 'square' and
 * 'rounded' inset it in a white margin as wide as the text panel's margin (3% of the width), so the
 * panel the reader draws lines up exactly with the picture's inner edge.
 */
export function frameFor(kind, width = W) {
  const k = FRAMES.includes(kind) ? kind : 'full';
  return { kind: k, width: k === 'full' ? 0 : Math.round(width * 0.03) };
}

/**
 * A mask: a 1072x1448 PNG with alpha, a solid colour at the edges fading to transparent inwards, laid
 * over every page of a book to hide inconsistent edges in the model's pictures. `width` is the fade in
 * pixels, `radius` rounds the inner corners (0 for square), `colour` is any CSS colour.
 */
export function makeMask({ colour = '#fff', fade = 160, radius = 0, width = W, height = H } = {}) {
  const c = createCanvas(width, height), g = c.getContext('2d');
  g.fillStyle = colour; g.fillRect(0, 0, width, height);
  const id = g.getImageData(0, 0, width, height), d = id.data;
  const hx = width / 2, hy = height / 2, r = Math.max(0, Math.min(radius, hx, hy));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Signed distance to a rounded rectangle the size of the page; negative inside.
      const qx = Math.abs(x + 0.5 - hx) - (hx - r), qy = Math.abs(y + 0.5 - hy) - (hy - r);
      const dist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const inside = -dist;                                    // distance in from the edge
      const t = Math.min(1, Math.max(0, inside / fade));
      const alpha = 1 - t * t * (3 - 2 * t);                   // smoothstep: opaque at the edge, clear past the fade
      d[(y * width + x) * 4 + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(id, 0, 0);
  return c.encode('png');
}

/**
 * Device page: optional unit crop [x, y, w, h] of the source, centre-crop to 3:4, resize to
 * 1072x1448, autocontrast, the book's mask if it has one, then the book's frame. Returns a canvas.
 */
export async function processPage(srcBuf, { crop, frame = 'full', mask = null, contrast = true, width = W, height = H } = {}) {
  const im = await loadImage(srcBuf);
  let sx = 0, sy = 0, sw = im.width, sh = im.height;
  if (crop && crop.length === 4) {
    sx = crop[0] * im.width; sy = crop[1] * im.height; sw = crop[2] * im.width; sh = crop[3] * im.height;
  }
  const target = width / height, cur = sw / sh;
  if (cur > target) { const nw = sh * target; sx += (sw - nw) / 2; sw = nw; }
  else if (cur < target) { const nh = sw / target; sy += (sh - nh) / 2; sh = nh; }
  const c = createCanvas(width, height), g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.fillStyle = '#fff'; g.fillRect(0, 0, width, height);
  g.drawImage(im, sx, sy, sw, sh, 0, 0, width, height);
  if (contrast) autocontrast(g, width, height);
  if (mask) g.drawImage(await loadImage(mask), 0, 0, width, height);
  const f = typeof frame === 'string' ? frameFor(frame, width) : frame;
  if (!f || f.kind === 'full' || !f.width) return c;
  const b = f.width;
  const framed = createCanvas(width, height), fg = framed.getContext('2d');
  fg.imageSmoothingEnabled = true; fg.imageSmoothingQuality = 'high';
  fg.fillStyle = '#fff'; fg.fillRect(0, 0, width, height);
  fg.save();
  if (f.kind === 'rounded') { fg.beginPath(); fg.roundRect(b, b, width - 2 * b, height - 2 * b, b); fg.clip(); }
  fg.drawImage(c, 0, 0, width, height, b, b, width - 2 * b, height - 2 * b);
  fg.restore();
  return framed;
}

function metrics(g, size, family) {
  const m = g.measureText('Hg');
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  if (asc > 0 && desc >= 0) return { asc, desc };
  // Fallback to the fonts' hhea metrics if the canvas does not report them.
  return family === SERIF ? { asc: size * 1.069, desc: size * 0.293 } : { asc: size * 0.98, desc: size * 0.33 };
}

/** Greedy word wrap with the current g.font. Android line height is (ascent + descent) * mult. */
export function layoutText(g, text, maxWidth, mult, size, family) {
  const { asc, desc } = metrics(g, size, family);
  const lineHeight = (asc + desc) * mult;
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      if (g.measureText(line + ' ' + w).width <= maxWidth) line += ' ' + w;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  return { lines, lineHeight, asc, height: lines.length * lineHeight };
}

function drawLayout(g, layout, cx, top) {
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  layout.lines.forEach((line, i) => g.fillText(line, cx, top + i * layout.lineHeight + layout.asc));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = '#fff'; g.fill();
  g.lineWidth = 4; g.strokeStyle = '#000'; g.stroke();
}

/** Bedtime panel: top or bottom quarter, serif, largest size that fits from 5% of the width down to 3.4%. */
export function drawBedtimePanel(g, w, h, text, textTop) {
  registerFonts();
  const band = h / 4, m = w * 0.03;
  const r = textTop ? { x: m, y: m, w: w - 2 * m, h: band - m * 1.6 } : { x: m, y: h - band + m * 0.6, w: w - 2 * m, h: band - m * 1.6 };
  const pad = m * 1.2, innerW = Math.floor(r.w - 2 * pad), innerH = Math.floor(r.h - 2 * pad);
  let layout;
  for (let size = w * 0.05; size >= w * 0.034; size -= 2) {
    g.font = `${size}px "${SERIF}"`;
    layout = layoutText(g, text, innerW, 1.2, size, SERIF);
    if (layout.height <= innerH) break;
  }
  roundRect(g, r.x, r.y, r.w, r.h, m);
  g.fillStyle = '#000';
  drawLayout(g, layout, r.x + pad + innerW / 2, r.y + pad + (innerH - layout.height) / 2);
}

/** Reading panel: the new word very big, the sentence big, 80% wide at the bottom, grows to 42% of the height. */
export function drawReadingPanel(g, w, h, text, word) {
  registerFonts();
  const m = w * 0.03, pad = m * 0.96, boxW = (w - 2 * m) * 0.8, left = (w - boxW) / 2;
  const innerW = Math.floor(boxW - 2 * pad), maxInner = h * 0.42 - 2 * pad - m;
  let wl = null, tl = null, gap = 0, textSize = 0, wordSize = 0;
  for (let scale = 1; scale >= 0.5; scale -= 0.05) {
    textSize = w * 0.064 * scale; wordSize = w * 0.102 * scale;
    if (word) { g.font = `700 ${wordSize}px "${SANS}"`; wl = layoutText(g, word, innerW, 1, wordSize, SANS); }
    if (text) { g.font = `${textSize}px "${SANS}"`; tl = layoutText(g, text, innerW, 1.15, textSize, SANS); }
    gap = wl && tl ? textSize * 0.35 : 0;
    if ((wl?.height || 0) + gap + (tl?.height || 0) <= maxInner) break;
  }
  const inner = (wl?.height || 0) + gap + (tl?.height || 0);
  if (inner <= 0) return;
  const y = h - m - inner - 2 * pad;
  roundRect(g, left, y, boxW, inner + 2 * pad, m);
  g.fillStyle = '#000';
  let top = y + pad;
  if (wl) { g.font = `700 ${wordSize}px "${SANS}"`; drawLayout(g, wl, left + pad + innerW / 2, top); top += wl.height + gap; }
  if (tl) { g.font = `${textSize}px "${SANS}"`; drawLayout(g, tl, left + pad + innerW / 2, top); }
}

/**
 * Composite: the processed page with the panel drawn, exactly as the reader shows it.
 * page: { text, word, text_pos } (null for the cover). set: 'bedtime' | 'reading'.
 */
export async function composite(srcBuf, { page, set = 'bedtime', text_pos, crop, frame = 'full', mask = null } = {}) {
  const c = await processPage(srcBuf, { crop, frame, mask });
  const g = c.getContext('2d');
  if (page) {
    if (set === 'reading') drawReadingPanel(g, W, H, page.text || '', page.word || '');
    else if (page.text) drawBedtimePanel(g, W, H, page.text, (text_pos || page.text_pos) === 'top');
  }
  return c;
}

export function encodeWebp(canvas, quality = 85) { return canvas.encode('webp', quality); }
export function encodePng(canvas) { return canvas.encode('png'); }
