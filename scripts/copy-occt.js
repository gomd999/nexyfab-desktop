#!/usr/bin/env node
/**
 * copy-occt — Phase 5 launch step 1.
 *
 * Copies the `opencascade.js` package's WASM kernel + JS loader from
 * `node_modules/opencascade.js/dist/` into `public/occt-worker/` so the
 * worker bundle at `/occt-worker/` can `importScripts('./opencascade.js')`
 * at runtime (see `occt-worker/PHASE_5_INTEGRATION.md` § Step 1).
 *
 * Source files (npm package layout, `opencascade.js@1.1.x`):
 *   node_modules/opencascade.js/dist/opencascade.wasm.js   (Emscripten loader)
 *   node_modules/opencascade.js/dist/opencascade.wasm.wasm (OCCT binary)
 *
 * Destination (must drop the inner `.wasm` segment so the loader's default
 * `locateFile('opencascade.wasm')` resolves correctly):
 *   public/occt-worker/opencascade.js
 *   public/occt-worker/opencascade.wasm
 *
 * BEHAVIOUR
 * ---------
 *  - If `node_modules/opencascade.js/dist/` is missing (package not installed,
 *    Docker layer didn't pull it, etc.) we WARN and exit 0. Phase 5 launch is
 *    optional today; build must not break on a stub-only deployment.
 *  - `public/occt-worker/` is created if it does not exist (mkdir -p).
 *  - Copy is `copyFileSync` — overwrites existing files atomically per file.
 *  - No retries, no checksums. The downstream `scripts/check-occt-readiness.js`
 *    will catch tiny-file / placeholder corruption (>= 1 MB threshold).
 *  - Exit code is ALWAYS 0 — this script is wired into `prebuild` and must
 *    never block a Phase 4 (stub-only) build. Use `npm run occt:check
 *    --mode=wasm` as the failing gate when a deployment intends to ship the
 *    real kernel.
 *
 * Module exports `copyOcct({ root, fs })` for the vitest suite — tests inject
 * a fake fs Map so they never touch the real working tree.
 *
 * Usage:
 *   node scripts/copy-occt.js              (CLI; uses cwd as root, real fs)
 *   const { copyOcct } = require('./scripts/copy-occt.js')   (tests/embed)
 */
'use strict';

const realFs = require('node:fs');
const path = require('node:path');

/** Repo-root-relative source dir inside node_modules. */
const SRC_DIR_REL = path.join('node_modules', 'opencascade.js', 'dist');

/** Repo-root-relative destination dir inside the Next.js public folder. */
const DST_DIR_REL = path.join('public', 'occt-worker');

/**
 * File rename map. The npm package ships files prefixed `opencascade.wasm.*`
 * but the Emscripten loader's default `locateFile` looks for plain
 * `opencascade.wasm`. We drop the inner `.wasm` segment at copy time so the
 * worker doesn't need a custom `locateFile` hook.
 *
 * src (under node_modules dist) → dst (under public/occt-worker)
 */
const FILES = [
  { src: 'opencascade.wasm.js', dst: 'opencascade.js' },
  { src: 'opencascade.wasm.wasm', dst: 'opencascade.wasm' },
];

/**
 * Run the copy.
 *
 * @param {object} [opts]
 * @param {string} [opts.root]   - repo root (defaults to cwd)
 * @param {object} [opts.fs]     - fs injection point for tests
 * @returns {{ copied: string[], skipped: string[], warnings: string[], srcDir: string, dstDir: string }}
 *
 * Always returns; never throws. Warnings carry the human-readable reason for
 * any file that did not get copied (missing source, copy error, etc.).
 */
function copyOcct(opts) {
  const options = opts || {};
  const root = options.root != null ? options.root : process.cwd();
  const fs = options.fs != null ? options.fs : realFs;

  const srcDir = path.join(root, SRC_DIR_REL);
  const dstDir = path.join(root, DST_DIR_REL);

  /** @type {string[]} */
  const copied = [];
  /** @type {string[]} */
  const skipped = [];
  /** @type {string[]} */
  const warnings = [];

  // ─── short-circuit: package missing entirely ──────────────────────────────
  // We treat the absence of the whole dist dir as "package not installed"
  // and skip cleanly. Individual missing files (corrupted install) WARN.
  if (!safeExists(fs, srcDir)) {
    warnings.push(
      `opencascade.js npm package not found at ${SRC_DIR_REL} — skipping copy. ` +
        `Run \`npm install opencascade.js\` to enable Phase 5 WASM kernel.`,
    );
    return { copied, skipped: FILES.map((f) => f.dst), warnings, srcDir, dstDir };
  }

  // ─── ensure destination dir exists (mkdir -p) ─────────────────────────────
  try {
    fs.mkdirSync(dstDir, { recursive: true });
  } catch (err) {
    warnings.push(
      `failed to create destination dir ${DST_DIR_REL}: ` + errMsg(err) +
        ` — skipping all copies.`,
    );
    return { copied, skipped: FILES.map((f) => f.dst), warnings, srcDir, dstDir };
  }

  // ─── per-file copy ────────────────────────────────────────────────────────
  for (const file of FILES) {
    const srcAbs = path.join(srcDir, file.src);
    const dstAbs = path.join(dstDir, file.dst);

    if (!safeExists(fs, srcAbs)) {
      warnings.push(
        `source file missing: ${path.join(SRC_DIR_REL, file.src)} — ` +
          `the npm package may be corrupted or a different version. Skipping.`,
      );
      skipped.push(file.dst);
      continue;
    }

    try {
      fs.copyFileSync(srcAbs, dstAbs);
      copied.push(file.dst);
    } catch (err) {
      warnings.push(
        `copy failed for ${file.src} → ${file.dst}: ` + errMsg(err),
      );
      skipped.push(file.dst);
    }
  }

  return { copied, skipped, warnings, srcDir, dstDir };
}

/** existsSync wrapped so a mock that throws is treated as "missing". */
function safeExists(fs, p) {
  try {
    return Boolean(fs.existsSync(p));
  } catch (_e) {
    return false;
  }
}

/** Normalise unknown thrown values to a string message. */
function errMsg(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

/** CLI entry — runs the copy, logs human-readable summary, exits 0. */
function main() {
  const result = copyOcct({});

  for (const w of result.warnings) {
    // Single prefix so log aggregators can grep one tag.
    process.stderr.write(`[copy-occt] WARN: ${w}\n`);
  }
  for (const f of result.copied) {
    process.stdout.write(`[copy-occt] copied ${f}\n`);
  }
  if (result.copied.length === 0 && result.warnings.length === 0) {
    process.stdout.write('[copy-occt] no files to copy (unexpected)\n');
  }

  // Phase 5 launch step 1: ALWAYS exit 0. Build must not block on this.
  // The `npm run occt:check --mode=wasm` gate is where wasm-mode deployments
  // fail loudly if the copy didn't produce the expected blobs.
  process.exit(0);
}

module.exports = {
  copyOcct,
  SRC_DIR_REL,
  DST_DIR_REL,
  FILES,
};

if (require.main === module) {
  main();
}
