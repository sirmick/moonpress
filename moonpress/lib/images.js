// Reference sheets and image stamps.
import fs from 'node:fs';
import { stamp, stampBytes } from './stamp.js';
import { effective } from './book.js';

/** Where a job's reference sheets live: the book's own char sheet, or the series' shared char / cast sheets. */
export function refPaths(store, book, series, job) {
  const h = effective(book, series);
  return job.refs.map(name => {
    if (name === 'char') return { name, path: h.sharedChar ? store.seriesRef(book.series, 'char') : store.src(book.slug, 'char') };
    return { name, path: store.seriesRef(book.series, name) };
  });
}

export function refStamps(paths) {
  return paths.map(r => fs.existsSync(r.path) ? stampBytes(fs.readFileSync(r.path)) : null);
}

/** The stamp that decides whether an image is stale: template inputs, reference sheets, aspect, model. */
export function imageInputs(job, refStampList, model) {
  return stamp({ vars: job.vars, aspect: job.aspect, refs: refStampList, model });
}

/** Mark images whose inputs changed as stale in the state (advisory only; nothing is drawn). */
export function markStale(store, book, series, jobs, state, model) {
  const changed = [];
  for (const job of Object.values(jobs)) {
    const st = state.pages[job.key]?.image;
    if (!st || !fs.existsSync(store.src(book.slug, job.key))) continue;
    const now = imageInputs(job, refStamps(refPaths(store, book, series, job)), st.model || model);
    const stale = now !== st.inputs;
    if (stale !== !!st.stale) { st.stale = stale; changed.push(job.key); }
  }
  return changed;
}
