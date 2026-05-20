import type * as THREE from 'three';
import { verifyGeneratedModel, formatVerificationCritique, type ModelConstraints, type ModelVerificationResult } from './verifyGeneratedModel';

/**
 * scadCorrectionLoop — the AI generate → render → verify → fix loop, as a pure,
 * side-effect-free orchestrator.
 *
 * The model generates code; we render it to geometry; Layer-1 verification
 * (verifyGeneratedModel) gates it. On a render failure or a verification ERROR,
 * the critique is fed back so the model repairs the code — bounded by a retry
 * cap. Warning-severity findings (slivers, a heavy mesh, a thin wall) do NOT
 * block convergence; they ride along on the accepted result's `warnings`.
 * Generation and rendering are injected, so this is unit-testable without an
 * AI, a renderer, or React. (Wire it to callAI + compile in the panel.)
 *
 * The full ModelConstraints set flows through `opts.constraints`, so callers
 * can require a single connected body (`requireSingleBody`, an ERROR that the
 * loop will try to repair) or set a triangle budget (`maxTriangles`, an
 * advisory warning) and have the loop honour them.
 */

export interface CorrectionLoopDeps {
  /** Produce code. First call: prior=null, critique=null. Repairs pass the
   *  previous code + the critique to fix. */
  generate: (prior: string | null, critique: string | null, attempt: number) => Promise<string>;
  /** Render code → geometry. Throws (rejects) on a compile/render error. */
  render: (code: string) => Promise<THREE.BufferGeometry>;
}

export interface CorrectionLoopOptions {
  maxAttempts?: number;
  constraints?: ModelConstraints;
}

export interface CorrectionAttempt {
  attempt: number;
  code: string;
  /** Render error (if rendering threw) — takes priority over verification. */
  renderError?: string;
  /** Layer-1 verification critique (empty when it passed). */
  critique: string;
  ok: boolean;
}

export interface CorrectionLoopResult {
  ok: boolean;
  attempts: number;
  code: string;
  geometry?: THREE.BufferGeometry;
  /** The blocking critique/error when !ok; empty when ok. */
  finalCritique: string;
  /** Advisory (warning-severity) critique on the accepted model — non-blocking
   *  notes like sliver facets, a heavy mesh, or a thin wall. Empty when clean. */
  warnings: string;
  history: CorrectionAttempt[];
}

export async function runScadCorrectionLoop(
  deps: CorrectionLoopDeps,
  opts: CorrectionLoopOptions = {},
): Promise<CorrectionLoopResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const history: CorrectionAttempt[] = [];
  let prior: string | null = null;
  let critique: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const code = await deps.generate(prior, critique, attempt);

    let geometry: THREE.BufferGeometry | undefined;
    let renderError: string | undefined;
    try {
      geometry = await deps.render(code);
    } catch (e) {
      renderError = e instanceof Error ? e.message : String(e);
    }

    // Render error short-circuits Layer-1 (no geometry to verify).
    let result: ModelVerificationResult | undefined;
    if (geometry) result = verifyGeneratedModel(geometry, opts.constraints);
    const verifyCritique = result ? formatVerificationCritique(result) : '';

    // Block ONLY on a render failure or an ERROR-severity check (result.pass is
    // true when the only failures are warnings). Warnings are advisory: they're
    // fed back so the model *can* improve, and surfaced on the accepted result,
    // but they never force the loop to burn through its retries.
    const hasError = result ? !result.pass : false;
    const blocking = renderError ? `RENDER ERROR: ${renderError}` : (hasError ? verifyCritique : '');
    const ok = !blocking;

    history.push({ attempt, code, renderError, critique: verifyCritique, ok });

    if (ok) {
      return { ok: true, attempts: attempt, code, geometry, finalCritique: '', warnings: verifyCritique, history };
    }
    // Feed the critique back for the next repair attempt.
    prior = code;
    critique = blocking;
  }

  const last = history[history.length - 1]!;
  return { ok: false, attempts: history.length, code: last.code, finalCritique: last.renderError ? `RENDER ERROR: ${last.renderError}` : last.critique, warnings: '', history };
}
