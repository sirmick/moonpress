// Console output. Everything goes to stderr so stdout stays free for machine-readable output.
export const log = (...a) => console.error(...a);
export const usd = n => `$${(+n || 0).toFixed(3)}`;

/** Run fn over items with at most n in flight. Results in input order; the first error rejects. */
export async function pool(items, n, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) { const k = i++; results[k] = await fn(items[k], k); }
  }));
  return results;
}
