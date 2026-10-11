// Prompt templates and the image jobs built from them.
import fs from 'node:fs';
import path from 'node:path';
import { PKG } from './config.js';
import { effective, castByPage, effectiveTextPos, pageKeys } from './book.js';

const DIR = path.join(PKG, 'prompts');

export function loadPrompts(store = null) {
  const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');
  return {
    t: JSON.parse(read('templates.json')),
    styles: JSON.parse(read('styles.json')),
    houseStyle: store?.houseStyle() ?? read('house-style.md'),
    plan: read('plan.md'),
    write: read('write.md'),
    inspect: read('inspect.md'),
  };
}

export function fill(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''));
}

/**
 * Reference sheets a series provides: a shared main character and/or a cast.
 * Returns { char?: {vars}, cast: { Name: {vars} } } with prompt and aspect filled in.
 */
export function seriesJobs(series, prompts) {
  const t = prompts.t, out = { cast: {} };
  if (!series) return out;
  if (series.character) {
    const vars = { style: series.style || '', palette: series.palette || '', character: series.character };
    out.char = { key: 'char', vars, prompt: fill(t.bedtime.char, vars), aspect: '1:1', refs: [] };
  }
  for (const [name, desc] of Object.entries(series.cast || {})) {
    const vars = { style: series.style || '', palette: series.palette || '', desc };
    out.cast[name] = { key: name, vars, prompt: fill(t.reading.cast, vars), aspect: '1:1', refs: [] };
  }
  return out;
}

/**
 * Image jobs for one book: a map key -> { key, prompt, aspect, refs: [name], vars }.
 * refs name reference sheets: 'char' (book or series), or cast names (series).
 * `vars` is everything the stamp should cover (template wording excluded).
 */
export function imageJobs(book, series, prompts, state = null) {
  const t = prompts.t, h = effective(book, series), out = {};
  const total = book.pages.length;
  const framing = h.framing ? ' ' + h.framing.trim() : '';      // stamped as part of vars; the wording around it is not
  if (h.set === 'reading') {
    const who = castByPage(book, h.castDesc);
    const pages = [[0, { beat: book.cover }], ...book.pages.map(p => [p.n, p])];
    for (const [n, p] of pages) {
      const key = n === 0 ? 'cover' : `p${String(n).padStart(2, '0')}`;
      const names = who[key] || [];
      const chars = names.map(m => h.castDesc[m] + '.').join(' ') || 'none';
      const refnote = names.length ? fill(t.reading.refnote, { names: names.join(', ') }) : '';
      const vars = { style: h.style, palette: h.palette, chars, names, beat: p.beat, framing };
      out[key] = { key, vars, prompt: fill(t.reading.page, { ...vars, refnote }), aspect: '3:4', refs: names };
    }
    return out;
  }
  const common = fill(t.bedtime.common, h);
  if (!h.sharedChar) {
    const vars = { style: h.style, palette: h.palette, character: h.character };
    out.char = { key: 'char', vars, prompt: fill(t.bedtime.char, vars), aspect: '1:1', refs: [] };
  }
  {
    const vars = { style: h.style, palette: h.palette, sky: h.sky, title: book.title, cover: book.cover, character: h.character, framing };
    out.cover = { key: 'cover', vars, prompt: common + fill(t.bedtime.cover, vars), aspect: '3:4', refs: ['char'] };
  }
  for (const p of book.pages) {
    const key = `p${String(p.n).padStart(2, '0')}`;
    const vars = { style: h.style, palette: h.palette, sky: h.sky, character: h.character, n: p.n, total,
                   timePhrase: h.timePhrase, beat: p.beat, text_pos: effectiveTextPos(p, state), framing };
    out[key] = { key, vars, prompt: common + fill(t.bedtime.page, vars), aspect: '3:4', refs: ['char'] };
  }
  return out;
}

export { pageKeys };
