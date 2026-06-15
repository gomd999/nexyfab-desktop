/**
 * /api/occt/diagnostic — Phase 5 launch step 11 (Agent — e2e scaffold).
 *
 * Read-only diagnostic JSON used by the Playwright e2e suite under
 * `e2e/occt/*.spec.ts` to decide whether the real OCCT WASM is shipped at
 * `/occt-worker/opencascade.wasm`. The spec polls this endpoint before
 * attempting to instantiate the 65 MB Emscripten module in the browser,
 * so a missing/short WASM short-circuits with a clear skip-marker instead of
 * hanging on `Module()`.
 *
 * SHAPE
 * -----
 *   {
 *     "ok": boolean,                 // wasm present + size > minBytes
 *     "wasm": {
 *       "url": "/occt-worker/opencascade.wasm",
 *       "exists": boolean,
 *       "sizeBytes": number,         // 0 if not present
 *       "sha256": string | null      // hex digest of the .wasm contents
 *     },
 *     "loader": {
 *       "url": "/occt-worker/opencascade.js",
 *       "exists": boolean,
 *       "sizeBytes": number
 *     },
 *     "worker": {
 *       "url": "/occt-worker/occt-worker.js",
 *       "exists": boolean
 *     },
 *     "mode": "wasm" | "wasm-stub" | "stub",
 *     "checkedAt": string            // ISO timestamp
 *   }
 *
 * INTENTIONALLY DEBUG-ONLY
 * ------------------------
 * - Read-only (filesystem stat + sha256 over the .wasm).
 * - Does NOT touch the kernel — no Embind, no Worker spawn — so polling from
 *   tests cannot inadvertently boot OCCT in the Next.js server runtime.
 * - Cache-Control `no-store` so the e2e webServer's hot-reload cycle doesn't
 *   serve a stale answer between `playwright test` runs.
 *
 * The hash is included so a deploy verifier can compare against the build-time
 * digest emitted by `scripts/copy-occt.js`; mismatches indicate a partial copy
 * or a corrupted CDN object.
 */

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Minimum size below which we treat the .wasm as a placeholder (truncated). */
const MIN_WASM_BYTES = 1_000_000; // 1 MB — real opencascade.wasm is ~65 MB

interface FileInfo {
  url: string;
  exists: boolean;
  sizeBytes: number;
  sha256?: string | null;
}

async function statPublicFile(relUrl: string): Promise<{ exists: boolean; sizeBytes: number; absPath: string }> {
  // `public/` is the static-serve root in Next.js. Strip the leading slash so
  // `path.join` doesn't treat it as an absolute path on Windows.
  const cleaned = relUrl.replace(/^\/+/, '');
  const absPath = path.join(process.cwd(), 'public', cleaned);
  try {
    const stat = await fs.stat(absPath);
    return { exists: stat.isFile(), sizeBytes: stat.size, absPath };
  } catch {
    return { exists: false, sizeBytes: 0, absPath };
  }
}

async function sha256OfFile(absPath: string): Promise<string | null> {
  try {
    const buf = await fs.readFile(absPath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

export async function GET(): Promise<NextResponse> {
  const wasmRel = '/occt-worker/opencascade.wasm';
  const loaderRel = '/occt-worker/opencascade.js';
  const workerRel = '/occt-worker/occt-worker.js';

  const [wasmStat, loaderStat, workerStat] = await Promise.all([
    statPublicFile(wasmRel),
    statPublicFile(loaderRel),
    statPublicFile(workerRel),
  ]);

  // Only hash the wasm — the .js loader is small and not load-bearing for
  // integrity verification. Skip the hash if the file is missing or tiny
  // (avoids reading a 4-byte placeholder into memory).
  const wasmSha = wasmStat.exists && wasmStat.sizeBytes >= MIN_WASM_BYTES
    ? await sha256OfFile(wasmStat.absPath)
    : null;

  const wasm: FileInfo = {
    url: wasmRel,
    exists: wasmStat.exists,
    sizeBytes: wasmStat.sizeBytes,
    sha256: wasmSha,
  };
  const loader: FileInfo = {
    url: loaderRel,
    exists: loaderStat.exists,
    sizeBytes: loaderStat.sizeBytes,
  };
  const worker: FileInfo = {
    url: workerRel,
    exists: workerStat.exists,
    sizeBytes: workerStat.sizeBytes,
  };

  const ok = wasm.exists && wasm.sizeBytes >= MIN_WASM_BYTES && loader.exists && worker.exists;
  // Mode inference mirrors `src/lib/occt/runtimeMode.ts` semantics. The
  // request handler can't introspect the *browser* fetch, but it CAN report
  // what the next browser fetch would find — that's what e2e needs.
  const mode: 'wasm' | 'wasm-stub' | 'stub' = ok
    ? 'wasm'
    : (loader.exists ? 'wasm-stub' : 'stub');

  return NextResponse.json(
    {
      ok,
      wasm,
      loader,
      worker,
      mode,
      minWasmBytes: MIN_WASM_BYTES,
      checkedAt: new Date().toISOString(),
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
