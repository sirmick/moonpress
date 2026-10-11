// Pass 1: series planning. Writes book headers for the books a series wants.
import { stamp } from '../lib/stamp.js';
import { planOut } from '../lib/book.js';
import { blankBook, writeJson } from '../lib/store.js';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['books'],
  properties: { books: { type: 'array', items: {
    type: 'object', additionalProperties: false,
    required: ['slug', 'title', 'synopsis', 'character', 'refrain', 'palette', 'sky', 'cover', 'style'],
    properties: { slug: { type: 'string' }, title: { type: 'string' }, synopsis: { type: 'string' }, character: { type: 'string' },
                  refrain: { type: 'string' }, palette: { type: 'string' }, sky: { type: 'string' }, cover: { type: 'string' }, style: { type: 'string' } } } } },
};

function wanted(series) {
  return (series.books || []).map(b => typeof b === 'string' ? { slug: b } : b);
}

export async function planSeries(store, name, { or, prompts, cfg, candidates = 1, force = false, log = () => {} }) {
  const series = store.series(name);
  if (!series) throw new Error(`no series "${name}"`);
  const todo = wanted(series).filter(b => force || !store.book(b.slug)?.title);
  if (!todo.length) { log(`${name}: every book already has a header`); return { planned: 0 }; }

  const shelf = store.listBooks().map(s => store.book(s)).filter(b => b.title && !todo.some(t => t.slug === b.slug))
    .map(b => ({ slug: b.slug, title: b.title, character: b.character || b.cast?.join(', '), palette: b.palette, style: (b.style || '').slice(0, 90) }));
  const fixed = {};
  for (const k of ['character', 'style', 'palette', 'timePhrase', 'set']) if (series[k]) fixed[k] = series[k];
  const styleLib = series.style ? null : Object.fromEntries(Object.entries(prompts.styles).filter(([k]) => !k.startsWith('_')));

  const user = [
    '# House style\n\n' + prompts.houseStyle,
    `# Series brief\n\n${series.title ? series.title + '\n\n' : ''}${series.brief || ''}`,
    Object.keys(fixed).length ? `# Fixed for every book in this series (use word for word)\n\n\`\`\`json\n${JSON.stringify(fixed, null, 1)}\n\`\`\`` : '',
    `# Books wanted\n\n\`\`\`json\n${JSON.stringify(todo, null, 1)}\n\`\`\`\n\nUse each slug exactly as given.`,
    shelf.length ? `# Already on the shelf (keep the new books different)\n\n\`\`\`json\n${JSON.stringify(shelf, null, 1)}\n\`\`\`` : '',
    styleLib ? `# Style library (pick one per book, copy its paragraph into "style")\n\n\`\`\`json\n${JSON.stringify(styleLib, null, 1)}\n\`\`\`` : '',
    Object.keys(fixed).length ? 'For fields that are fixed above, return the fixed text unchanged.' : '',
  ].filter(Boolean).join('\n\n');

  const results = [];
  let cost = 0;
  for (let i = 0; i < candidates; i++) {
    const r = await or.chat({ model: cfg.modelText, system: prompts.plan, user, schema: SCHEMA, schemaName: 'plan', maxTokens: 6000, estimate: 0.1 });
    if (r.dry) { log(`${name}: [dry run] would plan ${todo.map(t => t.slug).join(', ')}\n\n${user.slice(0, 1500)}…`); return { planned: 0, dry: true }; }
    cost += r.cost; results.push(r.json);
    writeJson(store.seriesWork(name, `plan-${i + 1}.json`), r.json);
  }
  const chosen = results[0];
  const planIn = stamp({ brief: series.brief, fixed, houseStyle: prompts.houseStyle, wanted: todo });
  let planned = 0;
  for (const t of todo) {
    const hdr = chosen.books.find(b => b.slug === t.slug);
    if (!hdr) { log(`${t.slug}: the plan did not include it`); continue; }
    const book = Object.assign(store.book(t.slug) || blankBook(t.slug, name), {
      series: name, set: series.set || 'bedtime', title: hdr.title, synopsis: hdr.synopsis, refrain: hdr.refrain, sky: hdr.sky, cover: hdr.cover,
      character: series.character ? '' : hdr.character, style: series.style ? '' : hdr.style, palette: series.palette ? '' : hdr.palette,
    });
    if (t.hint) book.setting = t.hint;
    if (!book.pages) book.pages = [];
    store.writeBook(t.slug, book);
    const state = store.state(t.slug);
    state.plan = { in: planIn, out: stamp(planOut(book)), model: cfg.modelText, at: new Date().toISOString() };
    state.spend = (state.spend || 0) + cost / todo.length;
    store.writeState(t.slug, state);
    planned++;
    log(`${t.slug}: "${hdr.title}"`);
  }
  log(`${name}: planned ${planned} books  $${cost.toFixed(3)}${candidates > 1 ? `  (${candidates} candidates in work/series/${name}/)` : ''}`);
  return { planned, cost, candidates: results };
}
