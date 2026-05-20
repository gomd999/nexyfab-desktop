import type * as THREE from 'three';
import { verifyGeneratedModel, formatVerificationCritique, type ModelConstraints } from './verifyGeneratedModel';

/**
 * scadCorrectionLoop — the AI generate → render → verify → fix loop, as a pure,
 * side-effect-free orchestrator.
 *
 * The model generates code; we render it to geometry; Layer-1 verification
 * (verifyGeneratedModel) gates it. On a render failure or a verification ERROR,
 * the critique is fed back so the model repairs the code — bounded by a retry
 * cap. Generation and rendering are injected, so this is unit-testable without
 * an AI, a renderer, or React. (Wire it to callAI + compile in the panel.)
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
    const verifyCritique = geometry
      ? formatVerificationCritique(verifyGeneratedModel(geometry, opts.constraints))
      : '';
    const blocking = renderError ? `RENDER ERROR: ${renderError}` : verifyCritique;
    const ok = !blocking;

    history.push({ attempt, code, renderError, critique: verifyCritique, ok });

    if (ok) {
      return { ok: true, attempts: attempt, code, geometry, finalCritique: '', history };
    }
    // Feed the critique back for the next repair attempt.
    prior = code;
    critique = blocking;
  }

  const last = history[history.length - 1]!;
  return { ok: false, attempts: history.length, code: last.code, finalCritique: last.renderError ? `RENDER ERROR: ${last.renderError}` : last.critique, history };
}
