// Publish: package whatever is stale and write catalog.json, the file the reader syncs from.
import fs from 'node:fs';
import { packageBook, packageable } from './package.js';

export const MIN_APP = 2;

export async function publish(store, { force = false, log = () => {} } = {}) {
  const entries = [];
  const order = [];
  for (const s of store.listSeries()) for (const slug of store.booksIn(s)) if (!order.includes(slug)) order.push(slug);
  for (const slug of store.listBooks()) if (!order.includes(slug)) order.push(slug);
  for (const slug of order) {
    const book = store.book(slug);
    if (!packageable(store, book)) continue;
    await packageBook(store, slug, { force, log });
    const state = store.state(slug);
    const dir = store.out(slug);
    const files = fs.readdirSync(dir).filter(f => f === 'book.json' || f.endsWith('.webp')).sort();
    const bytes = files.reduce((a, f) => a + fs.statSync(`${dir}/${f}`).size, 0);
    entries.push({ slug, title: book.title, set: book.set || 'bedtime', series: book.series || '',
                   hash: state.package.hash, bytes, pages: state.package.pages, files });
  }
  const catalog = { v: 1, minApp: MIN_APP, generated: new Date().toISOString(), books: entries };
  store.writeCatalog(catalog);
  log(`catalog: ${entries.length} books, ${(entries.reduce((a, e) => a + e.bytes, 0) / 1e6).toFixed(1)} MB`);
  return catalog;
}
