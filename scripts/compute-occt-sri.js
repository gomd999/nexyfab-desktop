#!/usr/bin/env node
/**
 * compute-occt-sri — Phase 5 launch step 10 (security).
 *
 * Computes a Subresource Integrity (SRI) hash for the OCCT loader JS that
 * `occt-worker.js` will eventually `importScripts('./opencascade.js')`. The
 * hash is written to `public/occt-worker/sri.json` and consumed at launcher
 * boot time (Phase 5 v2 — gated, not enforced today).
 *
 * Why SHA-384?
 *   - The browser SRI spec defines sha256, sha384, sha512. We pick **sha384**
 *     as the middle ground: matches what most CDNs publish, and the
 *     `<script integrity="sha384-…">` form is the most widely tested path.
 *   - SHA-256 has a smaller margin against future-collision worries.
 *   - SHA-512 is fine but doubles the header length for no real benefit.
 *
 * Why only the loader JS, not the WASM?
 *   - The HTML SRI spec only applies to `<script>` / `<link>` elements and
 *     `importScripts()` (per the workers spec). Raw WASM bytes are loaded
 *     via `WebAssembly.instantiateStreaming(fetch(…))`, which does NOT
 *     consult SRI metadata — there is no spec hook today. Integrity for
 *     the WASM itself comes from `Cross-Origin-Resource-Policy: same-origin`
 *     + the locked Cloudflare/Railway origin certificate.
 *   - The loader IS the only attack surface where a tampered byte could
 *     point Emscripten at a malicious WASM; pinning the loader hash means
 *     the WASM URL is captured inside a hashed file.
 *
 * Why JSON, not a `.txt`?
 *   - We may add multiple integrities later (e.g. the worker JS, the
 *     occt-import-js loader). A `{ "<filename>": "sha384-…" }` map keeps
 *     the file forward-compatible without versioning gymnastics.
 *
 * GRACEFUL DEGRADATION
 * --------------------
 *  - If `public/occt-worker/opencascade.js` is missing (Phase 4 build,
 *    `copy-occt.js` skipped, etc.) we WARN and exit 0. The launcher tolerates
 *    a missing `sri.json` by skipping integrity enforcement — same posture as
 *    copy-occt.
 *  - Idempotent: rerunning on the same file produces the same JSON content.
 *
 * Module exports `computeOcctSri({ root, fs, hashFn })` for tests so they can
 * inject a fake fs + a deterministic hash function.
 *
 * Usage:
 *   node scripts/compute-occt-sri.js
 */
'use strict';

const realFs = require('node:fs');
const realCrypto = require('node:crypto');
const path = require('node:path');

const SRC_REL = path.join('public', 'occt-worker', 'opencascade.js');
const OUT_REL = path.join('public', 'occt-worker', 'sri.json');

/** Track which sources we hash. Add more here when the worker grows. */
const TARGETS = [
  { rel: SRC_REL, key: 'opencascade.js' },
];

/**
 * Compute the SRI map.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]    - repo root (defaults to cwd)
 * @param {object} [opts.fs]      - fs injection point for tests
 * @param {(buf: Buffer) => string} [opts.hashFn] - injection point for the
 *        hash function (tests use a deterministic stub). Default uses sha384.
 * @returns {{ wrote: boolean, sri: Record<string, string>, warnings: string[], outPath: string }}
 *
 * Always returns; never throws. Warnings carry the human-readable reason
 * for any file that was not hashed.
 */
function computeOcctSri(opts) {
  const options = opts || {};
  const root = options.root != null ? options.root : process.cwd();
  const fs = options.fs != null ? options.fs : realFs;
  const hashFn = options.hashFn != null ? options.hashFn : defaultSha384;

  /** @type {Record<string, string>} */
  const sri = {};
  /** @type {string[]} */
  const warnings = [];

  for (const target of TARGETS) {
    const abs = path.join(root, target.rel);
    if (!safeExists(fs, abs)) {
      warnings.push(
        `source file missing: ${target.rel} — run \`npm run occt:copy\` first. ` +
          `Skipping (Phase 4 builds are unaffected).`,
      );
      continue;
    }

    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch (err) {
      warnings.push(
        `failed to read ${target.rel}: ${errMsg(err)} — skipping.`,
      );
      continue;
    }

    let digest;
    try {
      digest = hashFn(buf);
    } catch (err) {
      warnings.push(
        `failed to hash ${target.rel}: ${errMsg(err)} — skipping.`,
      );
      continue;
    }

    sri[target.key] = `sha384-${digest}`;
  }

  const outPath = path.join(root, OUT_REL);
  let wrote = false;

  // Only write the JSON if at least one target was hashed; otherwise we
  // would clobber a previous valid file with `{}` on a Phase 4 build.
  if (Object.keys(sri).length > 0) {
    const payload = JSON.stringify(
      {
        algorithm: 'sha384',
        generatedAt: new Date().toISOString(),
        files: sri,
      },
      null,
      2,
    ) + '\n';

    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, payload);
      wrote = true;
    } catch (err) {
      warnings.push(
        `failed to write ${OUT_REL}: ${errMsg(err)}.`,
      );
    }
  }

  return { wrote, sri, warnings, outPath };
}

/** SHA-384, base64-encoded (SRI canonical form). */
function defaultSha384(buf) {
  return realCrypto.createHash('sha384').update(buf).digest('base64');
}

function safeExists(fs, p) {
  try {
    return Boolean(fs.existsSync(p));
  } catch (_e) {
    return false;
  }
}

function errMsg(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

function main() {
  const result = computeOcctSri({});

  for (const w of result.warnings) {
    process.stderr.write(`[compute-occt-sri] WARN: ${w}\n`);
  }
  for (const [k, v] of Object.entries(result.sri)) {
    process.stdout.write(`[compute-occt-sri] ${k}: ${v}\n`);
  }
  if (result.wrote) {
    process.stdout.write(`[compute-occt-sri] wrote ${OUT_REL}\n`);
  } else if (result.warnings.length === 0) {
    process.stdout.write('[compute-occt-sri] no files to hash\n');
  }

  // ALWAYS exit 0 — Phase 5 launch step 10 must not block Phase 4 builds.
  process.exit(0);
}

module.exports = {
  computeOcctSri,
  SRC_REL,
  OUT_REL,
  TARGETS,
};

if (require.main === module) {
  main();
}
