// OpenRouter client. Text, vision and image models all go through the one chat-completions endpoint.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL = 'https://openrouter.ai/api/v1/chat/completions';

export class BudgetExceeded extends Error {}

export function readKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  for (const f of [path.join(os.homedir(), 'openrouter.token'), path.resolve('openrouter.token'), path.resolve('..', 'openrouter.token')]) {
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
  }
  return null;
}

export function sniffMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return 'application/octet-stream';
}

export function dataUrl(buf, mime = sniffMime(buf)) {
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
}

export function extFor(mime) { return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime] || 'bin'; }

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Escape double quotes that sit inside string values: the usual way a model breaks its own JSON
 * (`"note": "Olive says "hello" here"`). A quote inside a string is one that is not followed, after
 * whitespace, by a structural character.
 */
export function repairJson(src) {
  let out = '', inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (!inStr) { if (ch === '"') inStr = true; out += ch; continue; }
    if (ch === '\\') { out += ch + (src[i + 1] ?? ''); i++; continue; }
    if (ch === '"') {
      const next = src.slice(i + 1).match(/^\s*([,}\]:]|$)/);
      if (next) { inStr = false; out += ch; } else out += '\\"';
      continue;
    }
    if (ch === '\n') { out += '\\n'; continue; }
    out += ch;
  }
  return out;
}

/** Pull the first JSON object out of a reply that may have prose around it, repairing the common slips. */
export function extractJson(text) {
  const candidates = [text];
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) candidates.push(m[1]);
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(text.slice(a, b + 1));
  for (const c of candidates) {
    try { return JSON.parse(c); } catch {}
    try { return JSON.parse(repairJson(c)); } catch {}
  }
  throw new Error(text.trim() ? 'no JSON in reply: ' + text.slice(0, 200) : 'empty reply');
}

export class OpenRouter {
  /**
   * @param {object} o
   * @param {string} o.key
   * @param {number} [o.budget] USD this client may spend before refusing further paid calls
   * @param {boolean} [o.dryRun] never call the network; return {dry: true}
   * @param {(s: string) => void} [o.log]
   */
  constructor({ key, budget = Infinity, dryRun = false, log = () => {} } = {}) {
    this.key = key; this.budget = budget; this.dryRun = dryRun; this.log = log;
    this.spent = 0; this.calls = 0;
  }

  guard(estimate) {
    if (this.spent + estimate > this.budget) {
      throw new BudgetExceeded(`budget of $${this.budget.toFixed(2)} would be exceeded (spent $${this.spent.toFixed(3)})`);
    }
  }

  async post(body, { tries = 3, timeout = 240_000 } = {}) {
    if (!this.key) throw new Error('no OpenRouter key: set OPENROUTER_API_KEY or put it in ~/openrouter.token');
    let last;
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const r = await fetch(URL, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + this.key, 'Content-Type': 'application/json',
                     'HTTP-Referer': 'https://github.com/sirmick/moonpress', 'X-Title': 'Moonpress' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(timeout),
        });
        const text = await r.text();
        let d; try { d = JSON.parse(text); } catch { d = { error: { message: `HTTP ${r.status}: ${text.slice(0, 200)}` } }; }
        if (d.error) {
          const code = d.error.code || r.status;
          last = `${code}: ${d.error.message || JSON.stringify(d.error)}`;
          if ([400, 401, 402, 403].includes(+code)) break;
          await sleep(3000 * (attempt + 1)); continue;
        }
        this.calls++;
        const cost = d.usage?.cost || 0; this.spent += cost;
        return d;
      } catch (e) {
        last = String(e); await sleep(5000);
      }
    }
    throw new Error('OpenRouter request failed: ' + last);
  }

  /**
   * Text (or vision) completion. Returns {text, json?, cost, usage, seconds}.
   * images: [{buffer, mime?}] attached before the user text. schema: JSON schema for strict JSON output.
   */
  async chat({ model, system, user, images = [], schema, schemaName = 'reply', maxTokens = 8000, temperature, estimate = 0.05 }) {
    if (this.dryRun) return { dry: true, text: '', json: null, cost: 0 };
    this.guard(estimate);
    const content = [];
    for (const im of images) content.push({ type: 'image_url', image_url: { url: dataUrl(im.buffer, im.mime) } });
    content.push({ type: 'text', text: user });
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content });
    const body = { model, messages, max_tokens: maxTokens };
    if (temperature !== undefined) body.temperature = temperature;
    if (schema) body.response_format = { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } };
    const t = Date.now();
    let cost = 0, lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {           // a reply that is not valid JSON is asked for again, twice
      const d = await this.post(body);
      const msg = d.choices?.[0]?.message || {};
      const text = typeof msg.content === 'string' ? msg.content : (msg.content || []).map(c => c.text || '').join('');
      cost += d.usage?.cost || 0;
      const out = { text, cost, usage: d.usage, seconds: Math.round((Date.now() - t) / 100) / 10, model: d.model || model };
      if (schema) {
        try { out.json = extractJson(text); }
        catch (e) { lastErr = e; this.log(`  ${model}: reply was not valid JSON (${e.message.slice(0, 60)}), asking again`); continue; }
      }
      this.log(`  ${model}  $${cost.toFixed(4)}  ${out.seconds}s`);
      return out;
    }
    throw new Error(`${model} did not return valid JSON: ${lastErr?.message}`);
  }

  /**
   * Image generation. refs: [Buffer] attached as references. Returns {buffer, mime, cost, seconds, text}.
   */
  async image({ model, prompt, refs = [], aspect = '3:4', size = '1K', estimate = 0.07 }) {
    if (this.dryRun) return { dry: true, cost: 0 };
    this.guard(estimate);
    const content = [{ type: 'text', text: prompt }];
    for (const r of refs) content.push({ type: 'image_url', image_url: { url: dataUrl(r) } });
    const body = { model, modalities: ['image', 'text'], image_config: { aspect_ratio: aspect, image_size: size },
                   messages: [{ role: 'user', content }] };
    const t = Date.now();
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = await this.post(body);
      const msg = d.choices?.[0]?.message || {};
      const imgs = msg.images || [];
      if (imgs.length) {
        const url = imgs[0].image_url.url;
        const [head, b64] = url.split(',', 2);
        const mime = (head.match(/^data:([^;]+)/) || [])[1] || 'image/png';
        return { buffer: Buffer.from(b64, 'base64'), mime, cost: d.usage?.cost || 0,
                 seconds: Math.round((Date.now() - t) / 100) / 10, text: msg.content || '' };
      }
      last = 'no image in response: ' + String(msg.content).slice(0, 200);
      await sleep(3000);
    }
    throw new Error('image generation failed: ' + last);
  }
}
