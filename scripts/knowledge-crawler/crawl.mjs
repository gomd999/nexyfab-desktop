#!/usr/bin/env node
/**
 * Wave 1 knowledge crawler — downloads copyright-safe engineering PDFs
 * per docs/strategy/domain-expansion-plan.md §2.
 *
 * Rules enforced here (plan §2):
 *  - license metadata is MANDATORY: a source without a concrete license is refused
 *    ("provenance 없는 문서는 코퍼스 반입 금지").
 *  - robots.txt is fetched per host and Disallow rules for User-agent:* are honored.
 *  - throttle: >= 2s between any two HTTP requests.
 *  - no auth bypass: sources marked enabled:false (e.g. KDS manual-assisted) are skipped.
 *
 * Usage:  node crawl.mjs [--force] [--only id1,id2]
 * Output: data/<id>.pdf + data/<id>.meta.json (source URL, license, fetch date, sha256)
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 NexyFabKnowledge/0.1';
const THROTTLE_MS = 2000;

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const onlyArg = args.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.split('=')[1] ?? args[args.indexOf(onlyArg) + 1] ?? '').split(',').filter(Boolean) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;
async function throttledFetch(url, opts = {}) {
  const wait = lastRequestAt + THROTTLE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return fetch(url, { redirect: 'follow', ...opts, headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) } });
}

/** Minimal robots.txt check: parse User-agent:* group, test Disallow/Allow prefixes. */
const robotsCache = new Map();
async function robotsAllows(url) {
  const u = new URL(url);
  const origin = u.origin;
  if (!robotsCache.has(origin)) {
    let rules = null; // null => no usable robots.txt => allowed
    try {
      const res = await throttledFetch(origin + '/robots.txt');
      const ct = res.headers.get('content-type') || '';
      if (res.ok && !ct.includes('html')) {
        const text = await res.text();
        rules = [];
        let applies = false;
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.replace(/#.*$/, '').trim();
          if (!line) continue;
          const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
          if (!m) continue;
          const key = m[1].toLowerCase();
          const val = m[2].trim();
          if (key === 'user-agent') applies = val === '*';
          else if (applies && (key === 'disallow' || key === 'allow')) rules.push({ allow: key === 'allow', prefix: val });
        }
      } else if (!res.ok && res.status !== 404) {
        console.warn(`  [robots] ${origin}/robots.txt -> HTTP ${res.status} (treating as allowed, but flagged)`);
      }
    } catch (e) {
      console.warn(`  [robots] ${origin}/robots.txt fetch failed: ${e.message} (treating as allowed)`);
    }
    robotsCache.set(origin, rules);
  }
  const rules = robotsCache.get(origin);
  if (!rules || rules.length === 0) return true;
  const path = u.pathname + u.search;
  // longest-match wins (Google semantics)
  let best = null;
  for (const r of rules) {
    if (!r.prefix) continue; // "Disallow:" empty = allow all
    if (path.startsWith(r.prefix) && (!best || r.prefix.length > best.prefix.length)) best = r;
  }
  return !best || best.allow;
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const { sources } = JSON.parse(readFileSync(join(__dirname, 'sources.json'), 'utf8'));
  mkdirSync(DATA_DIR, { recursive: true });

  let okCount = 0, skipCount = 0, failCount = 0, totalBytes = 0;
  for (const src of sources) {
    const tag = `[${src.id}]`;
    if (ONLY && !ONLY.includes(src.id)) continue;
    if (src.enabled === false) {
      console.log(`${tag} SKIP — disabled (manual-assisted / not crawlable). ${src.licenseNote?.slice(0, 80) ?? ''}`);
      skipCount++;
      continue;
    }
    // Plan §2 hard gate: no provenance, no ingest.
    if (!src.license || !src.url || !src.publisher || src.license === 'MANUAL-VERIFY-REQUIRED') {
      console.error(`${tag} REFUSED — missing/unverified license metadata (plan §2: provenance 필수)`);
      failCount++;
      continue;
    }
    const pdfPath = join(DATA_DIR, `${src.id}.pdf`);
    const metaPath = join(DATA_DIR, `${src.id}.meta.json`);
    if (existsSync(pdfPath) && existsSync(metaPath) && !FORCE) {
      console.log(`${tag} SKIP — already downloaded (use --force to re-fetch)`);
      skipCount++;
      continue;
    }
    try {
      if (!(await robotsAllows(src.url))) {
        console.error(`${tag} BLOCKED by robots.txt — not downloading`);
        failCount++;
        continue;
      }
      console.log(`${tag} GET ${src.url}`);
      const res = await throttledFetch(src.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error(`not a PDF (first bytes: ${buf.subarray(0, 16).toString('latin1')})`);
      }
      writeFileSync(pdfPath, buf);
      const meta = {
        docId: src.id,
        title: src.title,
        publisher: src.publisher,
        sourceUrl: src.url,
        license: src.license,
        licenseNote: src.licenseNote ?? null,
        tags: src.tags ?? [],
        fetchedAt: new Date().toISOString(),
        sha256: sha256(buf),
        bytes: buf.length,
        contentType: res.headers.get('content-type'),
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      totalBytes += buf.length;
      okCount++;
      console.log(`${tag} OK — ${(buf.length / 1024 / 1024).toFixed(1)} MB, sha256=${meta.sha256.slice(0, 12)}…`);
    } catch (e) {
      failCount++;
      console.error(`${tag} FAIL — ${e.message}`);
    }
  }
  console.log(`\ndone: ${okCount} downloaded (${(totalBytes / 1024 / 1024).toFixed(1)} MB), ${skipCount} skipped, ${failCount} failed`);
  if (failCount > 0) process.exitCode = 1;
}

main();
