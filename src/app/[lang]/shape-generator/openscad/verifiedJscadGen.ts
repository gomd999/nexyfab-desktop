/**
 * verifiedJscadGen — wires the (previously stranded) scadCorrectionLoop into the
 * JSCAD generation path so a generation is RENDER-VERIFIED before it reaches the
 * user: generate → run in-process (runJscadCode → THREE geometry) → Layer-1
 * verify → on a render error or hard verification failure, feed the critique
 * back and regenerate, bounded by maxAttempts.
 *
 * Why this matters for "AI가 확실히 설계가 된다": the OpenScadPanel already
 * rendered the code and even computed a verification critique, but it never fed
 * that critique back — a broken generation just surfaced an error. This closes
 * the auto-repair loop so the common "the model emitted slightly-wrong code"
 * case self-heals instead of dead-ending.
 *
 * Pure orchestration over injected deps → unit-testable without AI/worker/React.
 */
import type * as THREE from 'three';
import { runScadCorrectionLoop, type CorrectionLoopResult } from '../analysis/scadCorrectionLoop';
import type { ModelConstraints } from './../analysis/verifyGeneratedModel';

export interface VerifiedJscadDeps {
  /** Generate JSCAD code. attempt 1: priorCode/critique null (fresh). Repair
   *  attempts pass the previous code + the blocking critique to fix. */
  aiGenerate: (args: {
    prompt: string;
    priorCode: string | null;
    critique: string | null;
    attempt: number;
  }) => Promise<{ code: string; description: string }>;
  /** Render JSCAD code → geometry. MUST reject/throw on a compile/render error. */
  render: (code: string) => Promise<THREE.BufferGeometry>;
}

export interface VerifiedJscadResult extends CorrectionLoopResult {
  /** Description from the accepted (or last) generation. */
  description: string;
}

export async function generateVerifiedJscad(
  prompt: string,
  deps: VerifiedJscadDeps,
  opts: { maxAttempts?: number; constraints?: ModelConstraints } = {},
): Promise<VerifiedJscadResult> {
  let description = '';
  const loop = await runScadCorrectionLoop(
    {
      generate: async (prior, critique, attempt) => {
        const r = await deps.aiGenerate({ prompt, priorCode: prior, critique, attempt });
        description = r.description ?? '';
        return r.code;
      },
      render: deps.render,
    },
    { maxAttempts: opts.maxAttempts ?? 3, constraints: opts.constraints },
  );
  return { ...loop, description };
}
