/** Fail-closed release gate joining AI intent, part generation and assembly evidence. */
export type AiGenerationStage =
  | 'intent' | 'decomposition' | 'part_geometry' | 'assembly_solve'
  | 'interference' | 'motion' | 'step_roundtrip' | 'complete';

export type Pair = { partA: string; partB: string };
export type IntendedContact = Pair & { justification: string };

export type AiGenerationEvidence = {
  intent: { unresolved: string[]; conflicts: string[] };
  decomposition: { valid: boolean; independentPartCount: number; errors: string[] };
  parts: Array<{ instanceId: string; manufacturingPassed: boolean; errors: string[] }>;
  assembly?: {
    converged: boolean;
    finalMaxResidual: number;
    tolerance: number;
    unsupportedResiduals: number;
    approximateDoF: number;
    allowedDoF: number;
  };
  interference?: {
    checked: boolean;
    method: 'precise' | 'conservative' | 'none';
    overlaps: Pair[];
    intendedContacts: IntendedContact[];
  };
  motion?: { required: boolean; checked: boolean; collisionFree: boolean };
  stepRoundtrip?: { passed: boolean; errors: string[] };
};

export type AiGenerationDecision = {
  stage: AiGenerationStage;
  status: 'pass' | 'review_required' | 'blocked';
  errors: string[];
  warnings: string[];
};

const pairKey = ({ partA, partB }: Pair): string => [partA, partB].sort().join('::');

export function evaluateAiGeneration(e: AiGenerationEvidence): AiGenerationDecision {
  if (e.intent.conflicts.length || e.intent.unresolved.length) {
    return { stage: 'intent', status: 'blocked', errors: [...e.intent.conflicts, ...e.intent.unresolved], warnings: [] };
  }
  if (!e.decomposition.valid || e.decomposition.independentPartCount < 1 || e.decomposition.errors.length) {
    return { stage: 'decomposition', status: 'blocked', errors: e.decomposition.errors.length ? e.decomposition.errors : ['No independent parts were produced.'], warnings: [] };
  }
  const badParts = e.parts.filter(part => !part.manufacturingPassed || part.errors.length);
  if (e.parts.length !== e.decomposition.independentPartCount || badParts.length) {
    const errors = badParts.flatMap(part => part.errors.length ? part.errors.map(error => `${part.instanceId}: ${error}`) : [`${part.instanceId}: manufacturing verification failed`]);
    if (e.parts.length !== e.decomposition.independentPartCount) errors.push('Generated part count does not match decomposition.');
    return { stage: 'part_geometry', status: 'blocked', errors, warnings: [] };
  }
  if (!e.assembly) return { stage: 'assembly_solve', status: 'blocked', errors: ['Assembly solve was not run.'], warnings: [] };
  if (!e.assembly.converged || !Number.isFinite(e.assembly.finalMaxResidual) || e.assembly.finalMaxResidual > e.assembly.tolerance || e.assembly.unsupportedResiduals > 0) {
    return { stage: 'assembly_solve', status: 'blocked', errors: ['Mate solver did not produce a fully supported result within tolerance.'], warnings: [] };
  }
  if (e.assembly.approximateDoF < 0) return { stage: 'assembly_solve', status: 'blocked', errors: ['Assembly is over-constrained.'], warnings: [] };
  if (e.assembly.approximateDoF > e.assembly.allowedDoF) return { stage: 'assembly_solve', status: 'review_required', errors: [], warnings: [`Assembly has ${e.assembly.approximateDoF - e.assembly.allowedDoF} undeclared degree(s) of freedom.`] };
  if (!e.interference?.checked || e.interference.method === 'none') {
    return { stage: 'interference', status: 'blocked', errors: ['Interference verification was not run.'], warnings: [] };
  }
  const declared = new Map(e.interference.intendedContacts.map(contact => [pairKey(contact), contact.justification.trim()]));
  const accidental = e.interference.overlaps.filter(pair => !declared.get(pairKey(pair)));
  if (accidental.length) return { stage: 'interference', status: 'blocked', errors: accidental.map(pair => `Accidental overlap: ${pairKey(pair)}`), warnings: [] };
  if (e.interference.method !== 'precise') {
    return { stage: 'interference', status: 'review_required', errors: [], warnings: ['Only conservative interference verification is available.'] };
  }
  if (e.motion?.required && (!e.motion.checked || !e.motion.collisionFree)) {
    return { stage: 'motion', status: 'blocked', errors: [e.motion.checked ? 'Motion sweep found a collision.' : 'Required motion sweep was not run.'], warnings: [] };
  }
  if (!e.stepRoundtrip?.passed || e.stepRoundtrip.errors.length) {
    return { stage: 'step_roundtrip', status: 'blocked', errors: e.stepRoundtrip?.errors.length ? e.stepRoundtrip.errors : ['STEP roundtrip verification was not run or failed.'], warnings: [] };
  }
  return { stage: 'complete', status: 'pass', errors: [], warnings: [] };
}

export type GenerationFailure = { stage: AiGenerationStage; fingerprint: string; attempt: number };
export type RepairDecision = { action: 'retry_stage' | 'request_input' | 'manual_review' | 'stop'; rollbackTo: AiGenerationStage; reason: string };

/** Bounded stage-local recovery: never regenerates already verified upstream evidence. */
export function planGenerationRepair(failure: GenerationFailure, previousFingerprints: readonly string[], maxAttempts = 3): RepairDecision {
  const repeats = previousFingerprints.filter(value => value === failure.fingerprint).length;
  if (failure.attempt >= maxAttempts || repeats >= maxAttempts - 1) return { action: 'stop', rollbackTo: failure.stage, reason: 'Repeated identical failure; preserved the last verified state.' };
  if (failure.stage === 'intent') return { action: 'request_input', rollbackTo: 'intent', reason: 'Requirements need authoritative user input.' };
  if (failure.stage === 'interference' || failure.stage === 'assembly_solve') return { action: 'manual_review', rollbackTo: failure.stage, reason: 'Mate or placement changes can alter design intent and require review.' };
  if (failure.stage === 'complete') return { action: 'stop', rollbackTo: 'complete', reason: 'A completed result does not require repair.' };
  return { action: 'retry_stage', rollbackTo: failure.stage, reason: 'Retry only the failed stage using structured gate feedback.' };
}
