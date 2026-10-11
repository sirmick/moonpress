// Package: src/ + edits -> out/ (device folder) and view/ (composites). Deterministic and cheap, so it
// runs whenever its stamp changed.
import fs from 'node:fs';
import { stamp, stampBytes } from '../lib/stamp.js';
import { effective, pageKeys, pageOf, effectiveTextPos } from '../lib/book.js';
import { processPage, composite, encodeWebp } from '../lib/render.js';
import { writeBytes } from '../lib/store.js';

export const DEVICE_QUALITY = 85;

export function packageInputs(store, book, state) {
  const h = effective(book, store.seriesOf(book));
  const pages = [];
  for (const key of pageKeys(book)) {
    const src = store.src(book.slug, key);
    if (!fs.existsSync(src)) continue;
    const p = pageOf(book, key), e = state.pages[key]?.edit || {};
    pages.push({ key, src: stampBytes(fs.readFileSync(src)), crop: e.crop || null,
                 text: p?.text || '', text_pos: p ? effectiveTextPos(p, state) : null, word: p?.word || '' });
  }
  return { set: h.set, title: book.title, frame: h.frame, pages };
}

/** True when the book has a cover image, so it can be packaged at all. */
export function packageable(store, book) { return fs.existsSync(store.src(book.slug, 'cover')); }

export async function packageBook(store, slug, { force = false, log = () => {} } = {}) {
  const book = store.book(slug), state = store.state(slug);
  if (!packageable(store, book)) { log(`${slug}: no cover image, not packaged`); return { packaged: false }; }
  const inputs = packageInputs(store, book, state);
  const hash = stamp(inputs);
  const outManifest = store.out(slug, 'book.json');
  const complete = inputs.pages.every(p => fs.existsSync(store.out(slug, `${p.key}.webp`)) && fs.existsSync(store.view(slug, `${p.key}.webp`)));
  if (!force && state.package?.hash === hash && fs.existsSync(outManifest) && complete) return { packaged: false, hash, unchanged: true };

  const h = effective(book, store.seriesOf(book));
  const manifestPages = [];
  for (const p of inputs.pages) {
    const srcBuf = fs.readFileSync(store.src(slug, p.key));
    const page = pageOf(book, p.key);
    const opts = { crop: p.crop || undefined, frame: h.frame };
    const device = await processPage(srcBuf, opts);
    writeBytes(store.out(slug, `${p.key}.webp`), await encodeWebp(device, DEVICE_QUALITY));
    const view = await composite(srcBuf, { page, set: h.set, text_pos: p.text_pos, ...opts });
    writeBytes(store.view(slug, `${p.key}.webp`), await encodeWebp(view, DEVICE_QUALITY));
    if (page) manifestPages.push({ n: page.n, image: `${p.key}.webp`, text: page.text, text_pos: p.text_pos, word: page.word || '' });
  }
  // stale leftovers from a shorter book
  for (const dir of [store.out(slug), store.view(slug)]) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.webp') && !inputs.pages.some(p => `${p.key}.webp` === f)) fs.unlinkSync(`${dir}/${f}`);
    }
  }
  const manifest = { slug, title: book.title, set: h.set, cover: 'cover.webp', pages: manifestPages };
  fs.writeFileSync(outManifest, JSON.stringify(manifest, null, 1) + '\n');
  state.package = { hash, at: new Date().toISOString(), pages: manifestPages.length };
  store.writeState(slug, state);
  log(`${slug}: packaged ${manifestPages.length} pages (${hash})`);
  return { packaged: true, hash, pages: manifestPages.length };
}
