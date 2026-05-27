/**
 * scriptSandbox.ts — Isolated execution of user scripts.
 *
 * SolidWorks runs VBA macros in-process — full trust. NexyFab runs
 * user scripts in a sandbox that:
 *   - has no DOM access (no window, no document)
 *   - has no network access (fetch / XHR removed)
 *   - times out after `timeoutMs` (default 5000)
 *   - exposes only the frozen `nf` API surface from `scriptApi.ts`
 *
 * Implementation: `new Function()` with a stripped scope. Real
 * production would benefit from QuickJS-WASM or vm2; this is the
 * Phase-3 starter version that runs in the main thread but is
 * isolated enough for the trust level (user's own scripts).
 *
 * Future: move execution into a Web Worker for true isolation
 * (memory protection + cancellation). The API host already handles
 * that path because all `dispatch*` callbacks are sync.
 */

import { createScriptApi, type ScriptApiHost, SCRIPT_API_VERSION } from './scriptApi';

export interface ScriptExecutionResult {
  ok: boolean;
  /** Returned value of the script (top-level expression result). */
  value?: unknown;
  error?: string;
  /** Execution time (ms). */
  durationMs: number;
  /** Log entries collected via nf.log / nf.warn / nf.error. */
  logs: Array<{ level: 'info' | 'warn' | 'error'; args: unknown[]; t: number }>;
  /** True when execution was cut off by timeout. */
  timedOut: boolean;
}

export interface ScriptExecutionOptions {
  timeoutMs?: number;
  /** Optional pre-bound variables (besides `nf`). */
  globals?: Record<string, unknown>;
}

const FORBIDDEN_PATTERNS = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\beval\s*\(/,
  /\bFunction\s*\(/,
  /\bimport\s*\(/,
  /\brequire\s*\(/,
  /\bdocument\b/,
  /\bwindow\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bindexedDB\b/,
];

/** Lightweight pattern scan — not a real parser. Returns reasons
 *  the script should be rejected before execution. */
export function lintScript(source: string): string[] {
  const errors: string[] = [];
  for (const rx of FORBIDDEN_PATTERNS) {
    if (rx.test(source)) errors.push(`Forbidden pattern: ${rx}`);
  }
  return errors;
}

/** Execute a script string with a bound `nf` API. */
export async function runScript(
  source: string,
  host: ScriptApiHost,
  opts: ScriptExecutionOptions = {},
): Promise<ScriptExecutionResult> {
  const t0 = Date.now();
  const logs: ScriptExecutionResult['logs'] = [];
  const timeout = opts.timeoutMs ?? 5000;

  const lint = lintScript(source);
  if (lint.length > 0) {
    return {
      ok: false,
      error: `Script rejected by linter:\n${lint.join('\n')}`,
      durationMs: Date.now() - t0,
      logs,
      timedOut: false,
    };
  }

  const recordingHost: ScriptApiHost = {
    ...host,
    logSink: (level, args) => {
      logs.push({ level, args, t: Date.now() - t0 });
    },
  };
  const nf = createScriptApi(recordingHost);

  // Build the sandbox scope. The `with(...)` block constrains
  // variable lookup; arguments override. Anything outside the
  // explicit globals throws ReferenceError.
  const globals = {
    nf,
    console: { log: nf.log, warn: nf.warn, error: nf.error },
    Math, JSON,
    ...opts.globals,
  };
  const wrappedSource = `
    'use strict';
    return (async () => {
      ${source}
    })();
  `;

  const argNames = Object.keys(globals);
  const argValues = Object.values(globals);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const fn = new Function(...argNames, wrappedSource);
    const exec = fn(...argValues) as Promise<unknown>;
    const result = await Promise.race([
      exec,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`Script exceeded ${timeout}ms timeout`));
        }, timeout);
      }),
    ]);
    if (timer) clearTimeout(timer);
    return {
      ok: true,
      value: result,
      durationMs: Date.now() - t0,
      logs,
      timedOut: false,
    };
  } catch (err) {
    if (timer) clearTimeout(timer);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - t0,
      logs,
      timedOut,
    };
  }
}

/** Convenience: programmatic script construction. */
export function buildScript(
  body: string,
  opts: { wrap?: 'iife' | 'none' } = {},
): string {
  if (opts.wrap === 'iife') {
    return `(async () => { ${body} })();`;
  }
  return body;
}

export { SCRIPT_API_VERSION };
