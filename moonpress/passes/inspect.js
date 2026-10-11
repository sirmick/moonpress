// Pass 4: a vision model looks at each page as the child will see it and picks one action.
import fs from 'node:fs';
import { stamp, stampBytes } from '../lib/stamp.js';
import { effective, pageKeys, pageOf, effectiveTextPos } from '../lib/book.js';
import { imageJobs, fill } from '../lib/prompts.js';
import { refPaths } from '../lib/images.js';
import { composite, encodeWebp, toWebp } from '../lib/render.js';
import { writeBytes } from '../lib/store.js';
import { extFor } from '../lib/openrouter.js';
import { drawBook, MASTER_QUALITY } from './draw.js';

const CHECKS = ['text', 'character', 'content', 'panel', 'contrast', 'extras'];
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['checks', 'action'],
  properties: {
    checks: { type: 'object', additionalProperties: false, required: CHECKS,
              properties: Object.fromEntries(CHECKS.map(c => [c, { type: 'string', description: '"ok" or a short phrase saying what is wrong' }])) },
    action: { type: 'object', additionalProperties: false, required: ['do', 'to', 'crop', 'px', 'instruction', 'reason'],
              properties: { do: { type: 'string', enum: ['ok', 'text_pos', 'crop', 'border', 'edit', 'regen'] },
                            to: { type: 'string', enum: ['', 'top', 'bottom'] },
                            crop: { type: 'array', items: { type: 'number' }, description: '[x, y, w, h] fractions, or empty' },
                            px: { type: 'integer' }, instruction: { type: 'string' }, reason: { type: 'string' } } },
  },
};

function cleanCrop(c) {
  if (!Array.isArray(c) || c.length !== 4) return null;
  let [x, y, w, h] = c.map(Number);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  w = Math.min(1, Math.max(0.6, w)); h = w;                       // source and target are both 3:4, so a unit square keeps the shape
  x = Math.min(1 - w, Math.max(0, x)); y = Math.min(1 - h, Math.max(0, y));
  return [x, y, w, h].map(v => Math.round(v * 1000) / 1000);
}

export function inspectInputs(store, slug, key, page, state) {
  const e = state.pages[key]?.edit || {};
  return stamp({ src: stampBytes(fs.readFileSync(store.src(slug, key))), text: page?.text || '', word: page?.word || '',
                 text_pos: page ? effectiveTextPos(page, state) : null, crop: e.crop || null, border: e.border || 0 });
}

async function renderFor(store, book, key, state, set) {
  const page = pageOf(book, key), e = state.pages[key]?.edit || {};
  const c = await composite(fs.readFileSync(store.src(book.slug, key)), { page, set, text_pos: page ? effectiveTextPos(page, state) : undefined, crop: e.crop, border: e.border });
  return encodeWebp(c, 80);
}

export async function inspectBook(store, slug, { or, prompts, cfg, auto = false, maxRegens = 1, only = null, force = false, log = () => {} }) {
  const book = store.book(slug), series = store.seriesOf(book);
  let state = store.state(slug);
  const h = effective(book, series);
  const jobs = imageJobs(book, series, prompts, state);
  const keys = pageKeys(book).filter(k => fs.existsSync(store.src(slug, k)) && (!only || only.includes(k)));
  const report = [];
  let cost = 0;

  for (const key of keys) {
    const page = pageOf(book, key);
    let entry = state.pages[key] || (state.pages[key] = {});
    let passes = 0;
    while (true) {
      const inputs = inspectInputs(store, slug, key, page, state);
      // Unchanged since last time: skip, unless the last verdict was a redraw that never got its second look.
      if (!force && entry.inspect?.in === inputs && entry.inspect.verdict !== 'redrawn' && passes === 0) { report.push({ key, ...entry.inspect, skipped: true }); break; }
      const comp = await renderFor(store, book, key, state, h.set);
      const refs = refPaths(store, book, series, jobs[key]).filter(r => fs.existsSync(r.path)).map(r => ({ buffer: fs.readFileSync(r.path), mime: 'image/webp' }));
      const user = [
        `Book: "${book.title}" (${h.set} set). ${key === 'cover' ? 'This is the cover; it has no text panel.' : `Page ${page.n} of ${book.pages.length}.`}`,
        `Scene the illustrator was asked for: ${key === 'cover' ? book.cover : page.beat}`,
        page ? `Words on the page: ${page.word ? `[${page.word}] ` : ''}${page.text}` : '',
        page && h.set !== 'reading' ? `The panel is at the ${effectiveTextPos(page, state)}.` : '',
        h.set === 'reading' ? `Characters expected: ${(jobs[key].vars.names || []).join(', ') || 'none'}.` : `Main character: ${h.character}`,
        'The first image is the page as the child sees it. The following image(s) are the character reference sheet(s).',
      ].filter(Boolean).join('\n');
      const r = await or.chat({ model: cfg.modelVision, system: prompts.inspect, user, images: [{ buffer: comp, mime: 'image/webp' }, ...refs],
                                schema: SCHEMA, schemaName: 'inspection', maxTokens: 800, estimate: 0.02 });
      if (r.dry) { log(`  [dry run] would inspect ${slug}/${key}`); break; }
      cost += r.cost;
      const { checks, action } = r.json;
      const problems = CHECKS.filter(c => checks[c] && checks[c].toLowerCase() !== 'ok');
      const regens = entry.image?.regens || 0;
      let applied = false, verdict = 'ok';
      entry.edit = entry.edit || {};
      if (action.do === 'text_pos' && page && ['top', 'bottom'].includes(action.to)) { entry.edit.text_pos = action.to; applied = true; verdict = 'fixed'; }
      else if (action.do === 'crop') { const c = cleanCrop(action.crop); if (c) { entry.edit.crop = c; if (['top', 'bottom'].includes(action.to) && page) entry.edit.text_pos = action.to; applied = true; verdict = 'fixed'; } }
      else if (action.do === 'border') { entry.edit.border = Math.min(120, Math.max(20, action.px || 50)); applied = true; verdict = 'fixed'; }
      else if (action.do === 'edit' || action.do === 'regen') {
        verdict = 'proposed';
        if (auto && regens < maxRegens) {
          if (action.do === 'edit') {
            const prompt = fill(prompts.t.edit, { instruction: action.instruction });
            const ir = await or.image({ model: cfg.modelImage, prompt, refs: [fs.readFileSync(store.src(slug, key))], aspect: jobs[key].aspect, estimate: 0.05 });
            cost += ir.cost;
            writeBytes(store.work(slug, 'candidates', `${key}-${Date.now()}.webp`), fs.readFileSync(store.src(slug, key)));
            writeBytes(store.work(slug, 'raw', `${key}-edit.${extFor(ir.mime)}`), ir.buffer);
            writeBytes(store.src(slug, key), await toWebp(ir.buffer, MASTER_QUALITY));
            entry.image = { ...entry.image, edited: action.instruction, cost: (entry.image?.cost || 0) + ir.cost, regens: regens + 1, at: new Date().toISOString() };
            state.spend = (state.spend || 0) + ir.cost;
            delete entry.edit.crop; delete entry.edit.border;
          } else {
            store.writeState(slug, state);
            await drawBook(store, slug, { or, prompts, cfg, redo: [key], hints: { [key]: action.reason }, log });
            state = store.state(slug); entry = state.pages[key];
            entry.image.regens = regens + 1;
          }
          applied = true; verdict = 'redrawn';
          log(`  ${slug}/${key}: ${action.do} applied (${action.instruction || action.reason})`);
        }
      }
      if (!['ok', 'proposed', 'redrawn'].includes(verdict) || (verdict === 'ok' && problems.length)) verdict = verdict === 'ok' ? 'noted' : verdict;
      entry.inspect = { in: inspectInputs(store, slug, key, page, state), verdict, checks, action, applied, model: cfg.modelVision, at: new Date().toISOString() };
      state.pages[key] = entry;
      store.writeState(slug, state);
      const summary = problems.length ? problems.map(c => `${c}: ${checks[c]}`).join('; ') : 'ok';
      log(`  ${slug}/${key}: ${verdict} [${action.do}] ${summary}`);
      report.push({ key, ...entry.inspect });
      passes++;
      // A redrawn or edited picture gets looked at once more, without further spending on it.
      if (verdict === 'redrawn' && passes < 2) { entry.inspect.in = null; continue; }
      break;
    }
  }
  state.spend = (state.spend || 0) + cost;
  store.writeState(slug, state);
  await writeReview(store, book, state, h.set, report);
  const counts = report.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
  log(`${slug}: inspected ${report.length} pages  $${cost.toFixed(3)}  ${JSON.stringify(counts)}  review: ${store.work(slug, 'review.html')}`);
  return { report, cost, counts };
}

async function writeReview(store, book, state, set, report) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cards = [];
  for (const r of report) {
    const img = (await renderFor(store, book, r.key, state, set)).toString('base64');
    const st = state.pages[r.key] || {};
    const checks = r.checks ? Object.entries(r.checks).map(([k, v]) => `<li class="${v.toLowerCase() === 'ok' ? 'ok' : 'bad'}"><b>${k}</b> ${esc(v)}</li>`).join('') : '';
    const act = r.action ? `${r.action.do}${r.action.to ? ' → ' + r.action.to : ''}${r.action.instruction ? ': ' + esc(r.action.instruction) : ''}${r.action.reason ? ': ' + esc(r.action.reason) : ''}` : '';
    cards.push(`<div class="card ${esc(r.verdict)}"><img src="data:image/webp;base64,${img}"><div class="meta"><div class="t">${esc(r.key)} <span class="v">${esc(r.verdict)}${r.skipped ? ' (unchanged)' : ''}${st.image?.stale ? ' · STALE' : ''}</span></div>
      <ul>${checks}</ul><div class="a">${act}${r.applied ? ' <em>applied</em>' : ''}</div>
      ${st.edit && Object.keys(st.edit).length ? `<div class="e">edit: ${esc(JSON.stringify(st.edit))}</div>` : ''}</div></div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><title>${esc(book.title)} · review</title>
<style>body{font:14px system-ui;margin:16px;background:#f3f0e8;color:#222}h1{font-size:18px}.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.card{background:#fff;border-radius:8px;overflow:hidden;border:2px solid #ddd}.card.fixed,.card.redrawn{border-color:#d9a400}.card.proposed{border-color:#c0392b}.card.noted{border-color:#e67e22}
.card img{width:100%;display:block}.meta{padding:8px}.t{font-weight:600}.v{font-weight:400;color:#666}ul{margin:6px 0;padding-left:18px}li.ok{color:#888}li.bad{color:#b3412f}.a{margin-top:4px}.e{color:#666;font-size:12px}</style>
<h1>${esc(book.title)} <small>${esc(book.slug)} · $${(state.spend || 0).toFixed(2)} spent</small></h1><div class="cards">${cards.join('')}</div>`;
  writeBytes(store.work(book.slug, 'review.html'), html);
}
