// Run configuration: content root, models, budget. CLI flags override environment, environment overrides defaults.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));          // moonpress/lib
export const PKG = path.resolve(HERE, '..');                                // moonpress/
export const REPO = path.resolve(PKG, '..');                                // repo root

export const DEFAULTS = {
  content: process.env.NIGHTSTAND || path.join(REPO, 'sample'),
  modelText: process.env.MOONPRESS_MODEL_TEXT || 'anthropic/claude-sonnet-5.5',
  modelVision: process.env.MOONPRESS_MODEL_VISION || 'anthropic/claude-sonnet-5.5',
  modelImage: process.env.MOONPRESS_MODEL_IMAGE || 'google/gemini-3.1-flash-lite-image',
  budget: +(process.env.MOONPRESS_BUDGET || 5),
  workers: 3,
  pages: 12,
};

export function config(overrides = {}) {
  const c = { ...DEFAULTS };
  for (const [k, v] of Object.entries(overrides)) if (v !== undefined) c[k] = v;
  c.content = path.resolve(c.content);
  return c;
}
