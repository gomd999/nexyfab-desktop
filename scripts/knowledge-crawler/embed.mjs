/**
 * Cloudflare Workers AI embeddings helper (@cf/baai/bge-m3, 1024-dim, multilingual ko/en).
 * Auth resolution order:
 *   1. env CLOUDFLARE_AI_API_TOKEN (a token that actually has Workers AI permission)
 *   2. wrangler OAuth token from ~/.wrangler/config/default.toml (scope ai:write).
 *      NOTE: the CLOUDFLARE_API_TOKEN values in Downloads/.env do NOT have Workers AI
 *      permission (tested 2026-07-11) — hence the wrangler OAuth fallback.
 *      If you get "Authentication error", run `npx wrangler whoami` once from a
 *      directory WITHOUT a wrangler.toml to refresh the OAuth token, then retry.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '6b5d2f94e36884439ea67b1f912c44fb';
const MODEL = '@cf/baai/bge-m3';

export function resolveToken() {
  if (process.env.CLOUDFLARE_AI_API_TOKEN) return process.env.CLOUDFLARE_AI_API_TOKEN;
  const tomlPath = join(homedir(), '.wrangler', 'config', 'default.toml');
  const toml = readFileSync(tomlPath, 'utf8');
  const m = toml.match(/oauth_token\s*=\s*"([^"]+)"/);
  if (!m) throw new Error(`no oauth_token in ${tomlPath} — run: npx wrangler login`);
  const exp = toml.match(/expiration_time\s*=\s*"([^"]+)"/);
  if (exp && new Date(exp[1]).getTime() < Date.now()) {
    console.warn('[embed] wrangler OAuth token looks expired — if auth fails, run `npx wrangler whoami` (from a dir without wrangler.toml) to refresh it.');
  }
  return m[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Embed an array of strings -> array of 1024-dim vectors. Batches + retries. */
export async function embedTexts(texts, { batchSize = 50, token = resolveToken() } = {}) {
  const out = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let attempt = 0;
    for (;;) {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run/${MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: batch }),
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        out.push(...json.result.data);
        break;
      }
      attempt++;
      const msg = JSON.stringify(json?.errors ?? `HTTP ${res.status}`);
      if (attempt > 4 || res.status === 401 || res.status === 403 || json?.errors?.some((e) => e.code === 10000)) {
        throw new Error(`Workers AI embeddings failed (batch ${i / batchSize}): ${msg}`);
      }
      const backoff = 1500 * 2 ** attempt;
      console.warn(`[embed] retry ${attempt} in ${backoff}ms: ${msg}`);
      await sleep(backoff);
    }
    await sleep(400); // gentle pacing
  }
  return out;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}
