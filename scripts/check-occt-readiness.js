#!/usr/bin/env node
/**
 * check-occt-readiness — verify the OCCT worker bundle that will ship to
 * `/occt-worker/` actually has the files the runtime expects, BEFORE the
 * Next.js build copies `public/` into the deployment artefact.
 *
 * NexyFab Pro own-CAD (ADR-013). Phase 5 launch readiness gate.
 *
 * The Phase 4 stub at `public/occt-worker/occt-worker.js` is harmless on its
 * own — it answers every wire op with synthetic bboxes. The Phase 5 swap
 * adds `public/occt-worker/opencascade.wasm` (~12 MB raw) which the stub
 * worker tries to `importScripts` to enter "real OCCT" mode. If that file
 * is missing in production, `detectOcctMode()` in `src/lib/occt/runtimeMode.ts`
 * silently falls back to `'stub'` and the badge says "CAD kernel: simulated".
 *
 * The whole point of this script is to make that footgun loud:
 *
 *   - In `stub` mode (Phase 4 baseline) we only check the worker JS exists.
 *   - In `wasm` mode (Phase 5 launch) we additionally check the WASM blob
 *     exists and is bigger than 1 MB — a 4 KB placeholder file is almost
 *     certainly a botched copy from `node_modules/`, not a real kernel.
 *   - In `auto` mode the script *detects* which mode the deployment is
 *     trying to be in: WASM present ⇒ 'wasm', otherwise ⇒ 'stub'. This is
 *     the mode `prebuild` runs in — it adapts to whichever phase the repo
 *     is currently at without needing a config flip.
 *
 * Output is JSON on stdout so CI can grep `.errors[]` for blocking issues
 * and `.warnings[]` for soft signals (e.g. tiny WASM file in auto mode).
 *
 * Exit code: 0 if `errors.length === 0`, 1 otherwise. Warnings never block.
 *
 * Usage:
 *   node scripts/check-occt-readiness.js --mode=auto    (default)
 *   node scripts/check-occt-readiness.js --mode=stub    (forbid WASM check)
 *   node scripts/check-occt-readiness.js --mode=wasm    (require WASM)
 *
 * The module also exports `checkOcctReadiness({ mode, root, fs })` for the
 * sibling vitest suite — tests inject a mock `fs` instead of touching the
 * real working tree.
 */
'use strict';

const realFs = require('node:fs');
const path = require('node:path');

/** Repo-root-relative paths the checker cares about. */
const WORKER_JS_REL = 'public/occt-worker/occt-worker.js';
const WASM_REL = 'public/occt-worker/opencascade.wasm';

/**
 * 1 MB threshold. Real OCCT WASM is ~12 MB; the bare opencascade.js loader
 * stub or an accidentally-empty file will be well under this. Anything
 * smaller earns a "placeholder file?" warning (and an error in `wasm` mode).
 */
const MIN_WASM_BYTES = 1 * 1024 * 1024;

const VALID_MODES = new Set(['stub', 'wasm', 'auto']);

/**
 * Run the readiness check.
 *
 * @param {object} [opts]
 * @param {'stub'|'wasm'|'auto'} [opts.mode='auto']
 * @param {string} [opts.root]            - repo root (defaults to cwd)
 * @param {object} [opts.fs]              - fs injection point for tests
 * @returns {{ mode: 'stub'|'wasm', warnings: string[], errors: string[] }}
 *
 * Notes:
 *   - `mode` in the RETURN is always concrete ('stub' or 'wasm'). 'auto'
 *     resolves to one of those based on file presence.
 *   - An invalid `mode` input is reported in `errors` and the resolved mode
 *     defaults to 'stub' (the safer assumption — no WASM gating).
 */
function checkOcctReadiness(opts) {
  const options = opts || {};
  const requestedMode = options.mode != null ? options.mode : 'auto';
  const root = options.root != null ? options.root : process.cwd();
  const fs = options.fs != null ? options.fs : realFs;

  const warnings = [];
  const errors = [];

  if (!VALID_MODES.has(requestedMode)) {
    errors.push(
      `invalid mode '${requestedMode}': must be one of stub|wasm|auto`,
    );
    return { mode: 'stub', warnings, errors };
  }

  const workerJsAbs = path.join(root, WORKER_JS_REL);
  const wasmAbs = path.join(root, WASM_REL);

  const workerJsExists = safeExists(fs, workerJsAbs);
  const wasmExists = safeExists(fs, wasmAbs);
  const wasmSize = wasmExists ? safeSize(fs, wasmAbs) : 0;

  // ─── resolve requested → concrete mode ────────────────────────────────
  let mode;
  if (requestedMode === 'auto') {
    // Auto-detect: the worker is the same file in both phases — only the
    // WASM blob differs. Big-enough WASM → real kernel deployment intended.
    // Anything smaller/missing → stub-only deployment.
    if (wasmExists && wasmSize >= MIN_WASM_BYTES) {
      mode = 'wasm';
    } else {
      mode = 'stub';
      if (wasmExists && wasmSize < MIN_WASM_BYTES) {
        warnings.push(
          `auto: opencascade.wasm present but only ${wasmSize} bytes ` +
            `(< ${MIN_WASM_BYTES}) — placeholder file? Treating as stub mode.`,
        );
      }
    }
  } else {
    mode = requestedMode;
  }

  // ─── shared check: worker JS must always be present ───────────────────
  if (!workerJsExists) {
    errors.push(
      `missing ${WORKER_JS_REL} — run the copy step from occt-worker/CONFIG.md ` +
        `(\`cp occt-worker/occt-worker.js public/occt-worker/occt-worker.js\`)`,
    );
  }

  // ─── wasm mode: WASM blob is mandatory and must be plausibly real ─────
  if (mode === 'wasm') {
    if (!wasmExists) {
      errors.push(
        `mode=wasm requires ${WASM_REL} but the file is missing — ` +
          `did the prebuild copy from node_modules/opencascade.js/dist/ run?`,
      );
    } else if (wasmSize < MIN_WASM_BYTES) {
      // In wasm mode a tiny file is a HARD error — we promised real OCCT.
      errors.push(
        `${WASM_REL} is only ${wasmSize} bytes (< ${MIN_WASM_BYTES}) — ` +
          `placeholder file? Real OCCT WASM is ~12 MB raw.`,
      );
    }
  }

  // ─── stub mode: the WASM SHOULD NOT be there (would confuse the worker) ─
  if (requestedMode === 'stub' && wasmExists) {
    warnings.push(
      `mode=stub but ${WASM_REL} is present (${wasmSize} bytes) — the ` +
        `worker will try to load it; intended for Phase 4 baseline only.`,
    );
  }

  return { mode, warnings, errors };
}

/**
 * fs.existsSync wrapped so any injected mock that throws on missing path
 * is treated as "doesn't exist" instead of crashing the script.
 */
function safeExists(fs, p) {
  try {
    return Boolean(fs.existsSync(p));
  } catch (_e) {
    return false;
  }
}

/**
 * fs.statSync(p).size with the same defensive wrap as safeExists. Returns
 * 0 if the file vanished between the exists check and the stat (TOCTOU)
 * or if the mock doesn't implement statSync.
 */
function safeSize(fs, p) {
  try {
    const st = fs.statSync(p);
    return typeof st.size === 'number' ? st.size : 0;
  } catch (_e) {
    return 0;
  }
}

/**
 * Parse `--mode=...` out of an argv slice. Last occurrence wins so a CI
 * wrapper that appends `--mode=wasm` to a base command can override.
 * Returns 'auto' when no `--mode=` flag is present.
 */
function parseModeArg(argv) {
  let mode = 'auto';
  for (const a of argv) {
    if (typeof a !== 'string') continue;
    if (a.startsWith('--mode=')) {
      mode = a.slice('--mode='.length);
    }
  }
  return mode;
}

/** CLI entry — prints JSON, exits 0/1. */
function main() {
  const mode = parseModeArg(process.argv.slice(2));
  const result = checkOcctReadiness({ mode });
  // Stdout JSON: one line, machine-readable. CI greps `.errors[]`.
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.errors.length === 0 ? 0 : 1);
}

module.exports = {
  checkOcctReadiness,
  parseModeArg,
  WORKER_JS_REL,
  WASM_REL,
  MIN_WASM_BYTES,
  VALID_MODES,
};

// Run only when invoked directly (`node scripts/check-occt-readiness.js`),
// not when require()d by the vitest suite.
if (require.main === module) {
  main();
}
