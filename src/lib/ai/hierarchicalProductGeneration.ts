import type { FeatureTree } from '@/lib/cad/featureTree';
import { generationArtifactHash } from './generationRunState';
import type { ComponentDefinition, ProductDecompositionPlan, ProductSubassembly } from './productDecomposition';
import { geometryNumericParameters } from './productDecompositionAccuracy';

export type HierarchicalBuildStatus = 'pending' | 'running' | 'passed' | 'failed' | 'blocked';
export interface HierarchicalBuildRecord { status: HierarchicalBuildStatus; attempts: number; checkpointHash: string | null; errors: string[]; }
export interface HierarchicalProductGenerationState {
  schema: 'nexyfab.hierarchical-product-generation.v1';
  runId: string; planHash: string; revision: number;
  parts: Record<string, HierarchicalBuildRecord>;
  subassemblies: Record<string, HierarchicalBuildRecord>;
  finalAssembly: HierarchicalBuildRecord;
  verifiedArtifacts: Record<string, { hash: string; artifact: unknown }>;
}
export interface GeneratedPartArtifact { definitionId: string; featureTree: FeatureTree; artifact: unknown }
export interface HierarchicalVerification { passed: boolean; errors: string[] }
export interface HierarchicalProductGenerationDeps {
  generatePart(input: { definition: ComponentDefinition; attempt: number; priorArtifact?: GeneratedPartArtifact; feedback: string[] }): Promise<GeneratedPartArtifact>;
  verifyPart(input: { definition: ComponentDefinition; generated: GeneratedPartArtifact }): Promise<HierarchicalVerification>;
  solveSubassembly(input: { subassembly: ProductSubassembly; plan: ProductDecompositionPlan; verifiedArtifacts: Readonly<Record<string, { hash: string; artifact: unknown }>> }): Promise<HierarchicalVerification & { artifact?: unknown }>;
  solveFinalAssembly(input: { plan: ProductDecompositionPlan; verifiedArtifacts: Readonly<Record<string, { hash: string; artifact: unknown }>> }): Promise<HierarchicalVerification & { artifact?: unknown }>;
}
export interface HierarchicalProductGenerationResult { status: 'passed' | 'stopped' | 'manual_review'; state: HierarchicalProductGenerationState; stoppedAt?: string; errors: string[] }

const blank = (): HierarchicalBuildRecord => ({ status: 'pending', attempts: 0, checkpointHash: null, errors: [] });

export function createHierarchicalProductGenerationState(runId: string, plan: ProductDecompositionPlan): HierarchicalProductGenerationState {
  if (!runId.trim()) throw new Error('runId is required');
  return {
    schema: 'nexyfab.hierarchical-product-generation.v1', runId, planHash: generationArtifactHash(plan), revision: 0,
    parts: Object.fromEntries(plan.definitions.map(item => [item.id, blank()])),
    subassemblies: Object.fromEntries(plan.subassemblies.map(item => [item.id, blank()])),
    finalAssembly: blank(), verifiedArtifacts: {},
  };
}

/** Generates definitions independently, freezes verified artifacts, then
 * solves subassemblies child-first and the product assembly last. */
export async function runHierarchicalProductGeneration(input: {
  runId: string; plan: ProductDecompositionPlan; deps: HierarchicalProductGenerationDeps;
  initialState?: HierarchicalProductGenerationState; maxPartAttempts?: number;
  onCheckpoint?: (state: HierarchicalProductGenerationState) => void | Promise<void>;
}): Promise<HierarchicalProductGenerationResult> {
  const state = input.initialState ? structuredClone(input.initialState) : createHierarchicalProductGenerationState(input.runId, input.plan);
  if (state.runId !== input.runId || state.planHash !== generationArtifactHash(input.plan)) throw new Error('hierarchical_generation_resume_plan_mismatch');
  const checkpoint = async () => input.onCheckpoint?.(structuredClone(state));
  const updatePart = async (id: string, record: HierarchicalBuildRecord) => { state.parts[id] = record; state.revision++; await checkpoint(); };
  const maximum = Math.max(1, input.maxPartAttempts ?? 3);

  for (const definition of input.plan.definitions) {
    let record = state.parts[definition.id];
    if (!record) throw new Error(`hierarchical_generation_part_state_missing:${definition.id}`);
    if (record.status === 'passed') continue;
    let previous: GeneratedPartArtifact | undefined;
    while (record.attempts < maximum && record.status !== 'passed') {
      record = { ...record, status: 'running', attempts: record.attempts + 1 }; await updatePart(definition.id, record);
      let generated: GeneratedPartArtifact;
      try { generated = await input.deps.generatePart({ definition, attempt: record.attempts, priorArtifact: previous, feedback: record.errors }); }
      catch (error) {
        record = { ...record, status: 'failed', errors: [error instanceof Error ? error.message : String(error)], checkpointHash: null };
        await updatePart(definition.id, record); continue;
      }
      previous = generated;
      const identityErrors = generated.definitionId === definition.id ? [] : [`definition_identity_changed:${generated.definitionId}`];
      const lockedErrors = lockedParameterErrors(definition, generated.featureTree);
      const verified = identityErrors.length || lockedErrors.length ? { passed: false, errors: [...identityErrors, ...lockedErrors] } : await input.deps.verifyPart({ definition, generated });
      if (!verified.passed || verified.errors.length) {
        record = { ...record, status: 'failed', errors: verified.errors.length ? verified.errors : ['part_verification_failed'], checkpointHash: null };
        await updatePart(definition.id, record); continue;
      }
      const artifact = { definitionId: definition.id, featureTree: generated.featureTree, artifact: generated.artifact };
      const hash = generationArtifactHash(artifact);
      state.verifiedArtifacts[`part:${definition.id}`] = { hash, artifact };
      record = { ...record, status: 'passed', errors: [], checkpointHash: hash };
      await updatePart(definition.id, record);
    }
    if (record.status !== 'passed') return { status: 'stopped', state, stoppedAt: `part:${definition.id}`, errors: record.errors };
  }

  for (const subassembly of childFirstSubassemblies(input.plan.subassemblies)) {
    let record = state.subassemblies[subassembly.id]!;
    if (record.status === 'passed') continue;
    record = { ...record, status: 'running', attempts: record.attempts + 1, errors: [] }; state.subassemblies[subassembly.id] = record; state.revision++; await checkpoint();
    const result = await input.deps.solveSubassembly({ subassembly, plan: input.plan, verifiedArtifacts: state.verifiedArtifacts });
    if (!result.passed || result.errors.length || result.artifact === undefined) {
      record = { ...record, status: 'blocked', errors: result.errors.length ? result.errors : ['subassembly_verification_failed'], checkpointHash: null };
      state.subassemblies[subassembly.id] = record; state.revision++; await checkpoint();
      return { status: 'manual_review', state, stoppedAt: `subassembly:${subassembly.id}`, errors: record.errors };
    }
    const hash = generationArtifactHash(result.artifact); state.verifiedArtifacts[`subassembly:${subassembly.id}`] = { hash, artifact: result.artifact };
    state.subassemblies[subassembly.id] = { ...record, status: 'passed', errors: [], checkpointHash: hash }; state.revision++; await checkpoint();
  }

  if (state.finalAssembly.status !== 'passed') {
    state.finalAssembly = { ...state.finalAssembly, status: 'running', attempts: state.finalAssembly.attempts + 1, errors: [] }; state.revision++; await checkpoint();
    const result = await input.deps.solveFinalAssembly({ plan: input.plan, verifiedArtifacts: state.verifiedArtifacts });
    if (!result.passed || result.errors.length || result.artifact === undefined) {
      state.finalAssembly = { ...state.finalAssembly, status: 'blocked', errors: result.errors.length ? result.errors : ['final_assembly_verification_failed'], checkpointHash: null }; state.revision++; await checkpoint();
      return { status: 'manual_review', state, stoppedAt: 'final-assembly', errors: state.finalAssembly.errors };
    }
    const hash = generationArtifactHash(result.artifact); state.verifiedArtifacts['assembly:final'] = { hash, artifact: result.artifact };
    state.finalAssembly = { ...state.finalAssembly, status: 'passed', errors: [], checkpointHash: hash }; state.revision++; await checkpoint();
  }
  return { status: 'passed', state, errors: [] };
}

export function lockedParameterErrors(definition: ComponentDefinition, generatedTree: FeatureTree): string[] {
  const generated = new Map(geometryNumericParameters(generatedTree).map(parameter => [parameter.path, parameter.value]));
  return definition.parameterEvidence.filter(evidence => evidence.locked).flatMap(evidence => {
    const actual = generated.get(evidence.path);
    return actual === evidence.value ? [] : [`locked_parameter_changed:${definition.id}:${evidence.path}:${evidence.value}:${actual ?? 'missing'}`];
  });
}

function childFirstSubassemblies(groups: ProductSubassembly[]): ProductSubassembly[] {
  const byParent = new Map<string, ProductSubassembly[]>();
  for (const group of groups) if (group.parentId) byParent.set(group.parentId, [...(byParent.get(group.parentId) ?? []), group]);
  const ordered: ProductSubassembly[] = [], visited = new Set<string>();
  const visit = (group: ProductSubassembly) => { if (visited.has(group.id)) return; for (const child of byParent.get(group.id) ?? []) visit(child); visited.add(group.id); ordered.push(group); };
  groups.filter(group => !group.parentId).forEach(visit); groups.forEach(visit);
  return ordered;
}
