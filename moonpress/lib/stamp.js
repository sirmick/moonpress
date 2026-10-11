// Stamps: short content hashes used to decide what is stale.
import { createHash } from 'node:crypto';

/** Canonical JSON: sorted keys, no whitespace, undefined dropped. Stable across key order. */
export function canonical(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** 12 hex chars of SHA-256 over the canonical JSON of v. */
export function stamp(v) {
  return createHash('sha256').update(canonical(v)).digest('hex').slice(0, 12);
}

/** Same, over raw bytes. */
export function stampBytes(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
}

/** Git blob SHA-1 of a file's bytes: what the GitHub contents API uses as the file's sha. */
export function blobSha(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
}
