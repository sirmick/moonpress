// Pass 3: pictures. Reference sheets first, then cover and pages in parallel with the references attached.
import fs from 'node:fs';
import { imageJobs, seriesJobs, fill } from '../lib/prompts.js';
import { refPaths, refStamps, imageInputs, markStale } from '../lib/images.js';
import { castByPage, effective, pageKeys, backfillFraming } from '../lib/book.js';
import { toWebp } from '../lib/render.js';
import { writeBytes } from '../lib/store.js';
import { extFor } from '../lib/openrouter.js';
import { pool } from '../lib/log.js';

export const MASTER_QUALITY = 92;

async function generate({ or, cfg, log }, job, refBuffers, hint) {
  const prompt = job.prompt + (hint ? fill(cfg.prompts.t.regenHint, { reason: hint }) : '');
  const r = await or.image({ model: cfg.modelImage, prompt, refs: refBuffers, aspect: job.aspect, estimate: 0.05 });
  if (r.dry) { log(`  [dry run] ${job.key}: ${prompt.slice(0, 160)}…  refs: ${job.refs.join(', ') || 'none'}`); return null; }
  return { ...r, prompt };
}

/** Make the series' shared reference sheets (char and/or cast) that `names` need. */
export async function ensureSeriesRefs(store, series, names, { or, cfg, prompts, force = false, log = () => {} }) {
  if (!series) return 0;
  const sj = seriesJobs(series, prompts);
  const state = store.seriesState(series.name);
  let made = 0;
  for (const name of names) {
    const job = name === 'char' ? sj.char : sj.cast[name];
    if (!job) continue;
    const dst = store.seriesRef(series.name, name);
    if (fs.existsSync(dst) && !force) continue;
    log(`${series.name}: reference sheet ${name}`);
    const r = await generate({ or, cfg: { ...cfg, prompts }, log }, job, []);
    if (!r) continue;
    writeBytes(store.seriesWork(series.name, 'raw', `${name}.${extFor(r.mime)}`), r.buffer);
    if (fs.existsSync(dst)) fs.renameSync(dst, store.seriesWork(series.name, 'candidates', `${name}-${Date.now()}.webp`));
    writeBytes(dst, await toWebp(r.buffer, MASTER_QUALITY));
    state.refs[name] = { inputs: imageInputs(job, [], cfg.modelImage), model: cfg.modelImage, prompt: r.prompt, cost: r.cost, seconds: r.seconds, at: new Date().toISOString() };
    state.spend = (state.spend || 0) + r.cost;
    store.writeSeriesState(series.name, state);
    log(`  ${name}  $${r.cost.toFixed(3)}  ${r.seconds}s`);
    made++;
  }
  return made;
}

/** Which series reference sheets a book needs. */
export function seriesRefsNeeded(book, series) {
  const h = effective(book, series);
  if (h.set === 'reading') return [...new Set(Object.values(castByPage(book, h.castDesc)).flat())];
  return h.sharedChar ? ['char'] : [];
}

/**
 * Draw the given keys of a book (default: whatever is missing). Returns {drawn, cost, stale}.
 * opts.redo: keys to draw again even if present. opts.hints: {key: reason} appended to prompts.
 */
export async function drawBook(store, slug, { or, prompts, cfg, only = null, redo = [], force = false, hints = {}, log = () => {} }) {
  const book = store.book(slug), series = store.seriesOf(book), state = store.state(slug);
  if (backfillFraming(book, series)) { store.writeBook(slug, book); log(`${slug}: backfilled the composition sentence into book.json`); }
  const h = effective(book, series);
  await ensureSeriesRefs(store, series, seriesRefsNeeded(book, series), { or, cfg, prompts, log });
  const jobs = imageJobs(book, series, prompts, state);
  const ctx = { or, cfg: { ...cfg, prompts }, log };
  const wants = key => (!only || only.includes(key)) && (force || redo.includes(key) || !fs.existsSync(store.src(slug, key)));
  let cost = 0, drawn = 0;

  const draw = async job => {
    const refs = refPaths(store, book, series, job);
    const missing = refs.filter(r => !fs.existsSync(r.path));
    if (missing.length) throw new Error(`${slug}/${job.key}: reference sheet missing: ${missing.map(r => r.name).join(', ')}`);
    const r = await generate(ctx, job, refs.map(x => fs.readFileSync(x.path)), hints[job.key]);
    if (!r) return;
    const src = store.src(slug, job.key);
    writeBytes(store.work(slug, 'raw', `${job.key}.${extFor(r.mime)}`), r.buffer);
    if (fs.existsSync(src)) writeBytes(store.work(slug, 'candidates', `${job.key}-${Date.now()}.webp`), fs.readFileSync(src));
    writeBytes(src, await toWebp(r.buffer, MASTER_QUALITY));
    const prev = state.pages[job.key] || {};
    state.pages[job.key] = { write: prev.write,
      image: { inputs: imageInputs(job, refStamps(refs), cfg.modelImage), refs: job.refs, model: cfg.modelImage, prompt: r.prompt,
               cost: r.cost, seconds: r.seconds, stale: false, at: new Date().toISOString(), regens: (prev.image?.regens || 0) + (fs.existsSync(src) && prev.image ? 1 : 0) } };
    cost += r.cost; drawn++;
    state.spend = (state.spend || 0) + r.cost;
    store.writeState(slug, state);
    log(`  ${slug}/${job.key}  $${r.cost.toFixed(3)}  ${r.seconds}s`);
  };

  if (jobs.char && wants('char')) await draw(jobs.char);
  const rest = pageKeys(book).map(k => jobs[k]).filter(j => j && wants(j.key));
  await pool(rest, cfg.workers, draw);

  const stale = markStale(store, book, series, jobs, state, cfg.modelImage);
  store.writeState(slug, state);
  const staleNow = Object.entries(state.pages).filter(([, p]) => p.image?.stale).map(([k]) => k);
  log(`${slug}: drew ${drawn} images  $${cost.toFixed(3)}${staleNow.length ? `  stale (not redrawn): ${staleNow.join(', ')}` : ''}`);
  return { drawn, cost, stale: staleNow };
}
