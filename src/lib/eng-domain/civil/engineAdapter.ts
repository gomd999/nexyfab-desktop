/**
 * eng-domain/civil/engineAdapter — bridge from the DomainModule gate chain to the
 * REAL, verified engineering-core calculators (통합: 새 스파인 + 기존 엔진).
 *
 * The audit (2026-07) confirmed `scripts/engineering-core` is correct, complete
 * (simple_beam = 휨·전단·처짐; retaining_wall = 전도·활동·지지력·편심·지진), KDS-cited,
 * and 121/121 tested against published examples — strictly better than the pure-TS
 * re-derivations that were here first. So the civil module's gates now CALL those
 * calculators instead of re-computing the physics.
 *
 * The `.mjs` engine is loaded via the established webpackIgnore dynamic-import
 * pattern (same as the mechanical drawing routes) — `scripts/engineering-core` is
 * copied into the standalone runtime image, and present at repo root under vitest.
 *
 * Honesty carried through: a calculator THROWS on a missing required input / a
 * load gate (하중 없음) — 하중을 지어내지 않는다. The adapter turns any throw into
 * `{ ok:false, reason }`, which the module maps to a FAILED gate (패키지 미산출),
 * never a fabricated pass.
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface EngineCheck {
  pass: boolean;
  [k: string]: unknown;
}

export interface EngineCalcResult {
  ok: boolean;
  verdict?: 'PASS' | 'FAIL';
  checks?: Record<string, EngineCheck>;
  /** Calculator honesty status ('검증'/'draft'…) — restated, not fabricated. */
  status?: string;
  /** Present iff !ok — the throw reason (INPUT_GATE / load gate / invalid). */
  reason?: string;
}

interface Registry {
  runCalculator: (
    id: string,
    input: Record<string, unknown>,
    std?: string,
  ) => { verdict: string; checks: Record<string, EngineCheck>; status?: string };
}

let _reg: Registry | null = null;

async function loadRegistry(): Promise<Registry> {
  if (_reg) return _reg;
  const p = join(process.cwd(), 'scripts', 'engineering-core', 'registry.mjs');
  _reg = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as unknown as Registry;
  return _reg;
}

/**
 * Run a real engineering-core calculator. A throw (missing required input, load
 * gate, or invalid parameter) becomes `{ ok:false, reason }` — the caller maps
 * that to a failed gate. Never fabricates a result.
 */
export async function runEngineCalc(
  id: string,
  input: Record<string, unknown>,
): Promise<EngineCalcResult> {
  try {
    const reg = await loadRegistry();
    const r = reg.runCalculator(id, input, 'KDS');
    return {
      ok: true,
      verdict: r.verdict as 'PASS' | 'FAIL',
      checks: r.checks ?? {},
      ...(r.status ? { status: r.status } : {}),
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Flatten a calculator check's numeric fields into gate metrics (pass excluded). */
export function checkMetrics(check: EngineCheck): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(check)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}
