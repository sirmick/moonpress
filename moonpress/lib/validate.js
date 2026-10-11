// Validators for pass 2 output. Each returns a list of human-readable violations; empty means fine.
import { wordCount } from './book.js';

export const tokens = text => (text || '').match(/[A-Za-z']+/g) || [];

/**
 * Reading set: every word on a page must be a sight word of the book, or the new word of that page
 * or an earlier page, cumulative across the series in order.
 * books: [{slug, pages}] in series order; progression: { slug: { sight: [...] } }.
 * Returns violations [{slug, n, token, text}] and the set of words taught.
 */
export function vocabCheck(books, progression = {}) {
  const known = new Set();
  const violations = [];
  for (const b of books) {
    for (const w of progression[b.slug]?.sight || []) known.add(w.toLowerCase());
    for (const p of b.pages) {
      if (p.word) known.add(p.word.toLowerCase());
      for (const tok of tokens(p.text)) {
        if (!known.has(tok.toLowerCase())) violations.push({ slug: b.slug, n: p.n, token: tok, text: p.text });
      }
    }
  }
  return { violations, known };
}

const SLEEPY = /\b(asleep|sleep|sleeps|sleeping|goodnight|good night|nap|naps|dream|dreams|zzz)\b/i;

/** House rules for a written book. */
export function houseCheck(book, { pages = 12, maxWords = 25 } = {}) {
  const v = [];
  if (book.pages.length !== pages) v.push(`book has ${book.pages.length} pages, wants ${pages}`);
  book.pages.forEach((p, i) => {
    if (p.n !== i + 1) v.push(`page ${i + 1} is numbered ${p.n}`);
    if (!p.text?.trim()) v.push(`page ${p.n}: no text`);
    if (!p.beat?.trim()) v.push(`page ${p.n}: no beat`);
    if (wordCount(p.text) > maxWords) v.push(`page ${p.n}: ${wordCount(p.text)} words, limit ${maxWords}`);
    if (!['top', 'bottom'].includes(p.text_pos)) v.push(`page ${p.n}: text_pos "${p.text_pos}" is not top or bottom`);
    if (/[A-Za-z]/.test(p.beat || '') && p.text && p.beat.includes(p.text)) v.push(`page ${p.n}: beat repeats the page text`);
  });
  const last = book.pages[book.pages.length - 1];
  if (last && !SLEEPY.test(last.text || '')) v.push(`page ${last.n}: the last page should be the sleeping page (asleep, goodnight, nap)`);
  if (book.set !== 'reading' && book.refrain) {
    // The first two words of the refrain, in order, with any punctuation between them ("Hello, Seoul," says Pocket).
    const words = (book.refrain.match(/[a-z']+/gi) || []).slice(0, 2);
    const key = words.length ? new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^a-z]+'), 'i') : null;
    if (key && !book.pages.some(p => key.test(p.text || ''))) {
      v.push(`the refrain "${book.refrain}" never appears in the page text`);
    }
  }
  const tops = book.pages.filter(p => p.text_pos === 'top').length;
  if (book.pages.length >= 8 && tops === 0) v.push('no page uses text_pos top; about one in three should');
  if (book.pages.length >= 8 && tops > book.pages.length / 2) v.push(`${tops} pages use text_pos top; at most about one in three should`);
  return v;
}
