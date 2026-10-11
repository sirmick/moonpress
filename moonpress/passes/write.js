// Pass 2: page text and beats. The LLM writes what varies between pages; the template assembles prompts later.
import { stamp } from '../lib/stamp.js';
import { headerVars, pageOut, effective } from '../lib/book.js';
import { houseCheck, vocabCheck } from '../lib/validate.js';
import { blankPage } from '../lib/store.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['pages'],
  properties: { pages: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['n', 'text', 'beat', 'text_pos', 'word'],
    properties: { n: { type: 'integer' }, text: { type: 'string' }, beat: { type: 'string' },
                  text_pos: { type: 'string', enum: ['top', 'bottom'] }, word: { type: 'string' } } } } },
};

function exampleBook(store, book) {
  const h = effective(book, store.seriesOf(book));
  const slugs = [...store.booksIn(book.series || ''), ...store.listBooks()];
  for (const s of slugs) {
    if (s === book.slug) continue;
    const b = store.book(s);
    if (b && (b.set || 'bedtime') === h.set && b.pages.length && b.pages.every(p => p.text && p.beat)) return b;
  }
  return null;
}

/** Pages that need writing: empty ones, and ones whose inputs changed while their output is untouched. */
export function pagesToWrite(book, series, state, { force = false } = {}) {
  const hv = headerVars(book, series);
  return book.pages.filter(p => {
    if (force) return true;
    if (!p.text?.trim() || !p.beat?.trim()) return true;
    const key = `p${String(p.n).padStart(2, '0')}`, w = state.pages[key]?.write;
    if (!w) return false;                                   // never generated: human-authored
    const inNow = stamp({ ...hv, n: p.n }), outNow = stamp(pageOut(p));
    return inNow !== w.in && outNow === w.out;
  });
}

export async function writeBook(store, slug, { or, prompts, cfg, force = false, log = () => {} }) {
  const book = store.book(slug), series = store.seriesOf(book), state = store.state(slug);
  const h = effective(book, series);
  if (!book.pages.length) book.pages = Array.from({ length: cfg.pages }, (_, i) => blankPage(i + 1));
  const todo = pagesToWrite(book, series, state, { force });
  if (!todo.length) { log(`${slug}: nothing to write`); return { written: 0 }; }
  if (!book.title) throw new Error(`${slug}: no title; run plan first`);

  const keep = book.pages.filter(p => !todo.includes(p) && p.text);
  const ex = exampleBook(store, book);
  const seriesEntry = (series?.books || []).find(b => typeof b === 'object' && b.slug === slug) || {};
  const header = { set: h.set, title: book.title, synopsis: book.synopsis || '', setting: book.setting || seriesEntry.hint || '',
                   character: h.character, refrain: h.refrain, palette: h.palette, sky: h.sky, cover: h.cover,
                   timePhrase: h.timePhrase, pages: book.pages.length };
  if (h.set === 'reading') { header.cast = h.cast; header.castDesc = h.castDesc; header.progression = series?.progression?.[slug]; }

  let violations = [];
  let written = null, cost = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = [
      '# House style\n\n' + prompts.houseStyle,
      series?.brief ? `# Series\n\n${series.brief}` : '',
      '# This book\n\n```json\n' + JSON.stringify(header, null, 1) + '\n```',
      ex ? `# A finished book from the same shelf, for voice and rhythm\n\n\`\`\`json\n${JSON.stringify({ title: ex.title, refrain: ex.refrain, pages: ex.pages.map(p => ({ n: p.n, text: p.text, beat: p.beat, text_pos: p.text_pos })) }, null, 1)}\n\`\`\`` : '',
      keep.length ? `# Pages to keep exactly as they are\n\n\`\`\`json\n${JSON.stringify(keep.map(p => ({ n: p.n, text: p.text, beat: p.beat, text_pos: p.text_pos, word: p.word })), null, 1)}\n\`\`\`` : '',
      `# Write these pages\n\n${todo.map(p => p.n).join(', ')} of ${book.pages.length}.` +
        (written ? `\n\n# Your previous attempt\n\n\`\`\`json\n${JSON.stringify(written, null, 1)}\n\`\`\`\n\n# Violations to fix\n\n- ${violations.join('\n- ')}` : ''),
    ].filter(Boolean).join('\n\n');
    const r = await or.chat({ model: cfg.modelText, system: prompts.write, user: parts, schema: SCHEMA, schemaName: 'pages', maxTokens: 6000, estimate: 0.08 });
    if (r.dry) { log(`${slug}: [dry run] would write pages ${todo.map(p => p.n).join(', ')}\n\n${parts.slice(0, 1500)}…`); return { written: 0, dry: true }; }
    cost += r.cost;
    written = r.json.pages.filter(p => todo.some(t => t.n === p.n));
    const trial = structuredClone(book);
    for (const p of written) {
      const target = trial.pages.find(t => t.n === p.n); if (!target) continue;
      target.text = p.text.trim(); target.beat = p.beat.trim(); target.text_pos = p.text_pos; if (h.set === 'reading') target.word = p.word.trim(); else delete target.word;
    }
    violations = houseCheck(trial, { pages: book.pages.length });
    if (h.set === 'reading' && series) {
      const order = store.booksIn(series.name);
      const upTo = order.slice(0, order.indexOf(slug) + 1).map(s => s === slug ? trial : store.book(s)).filter(Boolean);
      const vc = vocabCheck(upTo.map(b => ({ slug: b.slug, pages: b.pages })), series.progression || {});
      violations.push(...vc.violations.filter(v => v.slug === slug).map(v => `page ${v.n}: "${v.token}" has not been taught yet (${v.text})`));
    }
    const missing = todo.filter(t => !written.some(p => p.n === t.n)).map(t => t.n);
    if (missing.length) violations.push(`pages ${missing.join(', ')} were not written`);
    if (!violations.length) { Object.assign(book, { pages: trial.pages }); break; }
    log(`${slug}: attempt ${attempt + 1} has ${violations.length} violation(s): ${violations.slice(0, 3).join('; ')}`);
    if (attempt === 2) { Object.assign(book, { pages: trial.pages }); log(`${slug}: keeping the last attempt despite violations`); }
  }
  const hv = headerVars(book, series);
  for (const p of todo) {
    const key = `p${String(p.n).padStart(2, '0')}`;
    const page = book.pages.find(t => t.n === p.n);
    state.pages[key] = { ...(state.pages[key] || {}), write: { in: stamp({ ...hv, n: p.n }), out: stamp(pageOut(page)), model: cfg.modelText, at: new Date().toISOString() } };
  }
  state.spend = (state.spend || 0) + cost;
  store.writeBook(slug, book); store.writeState(slug, state);
  log(`${slug}: wrote ${todo.length} pages  $${cost.toFixed(3)}${violations.length ? `  (${violations.length} violations remain)` : ''}`);
  return { written: todo.length, cost, violations };
}
