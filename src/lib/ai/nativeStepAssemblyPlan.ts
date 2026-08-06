import type { ComplexProductArchitecture } from './complexProductArchitecture';
import type { ManufacturingAssignment } from './manufacturingAssignment';
import type { OccurrenceTransformEvidence } from './productAssemblyCertificate';

export interface NativeStepPartArtifact { definitionId: string; stepPath: string; sha256: string; }
export interface NativeStepAssemblyPlan {
  schema: 'nexyfab.native-step-assembly-plan.v1';
  status: 'pass' | 'fail' | 'not_run';
  definitions: Array<{ definitionId: string; name: string; stepPath: string; sha256: string; material: string; process: string; provenanceRef: string }>;
  occurrences: Array<{ occurrenceId: string; definitionId: string; parentOccurrenceId: string | null; localToParent: number[] }>;
  codes: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const matrixValid = (matrix: number[]) => matrix.length === 16 && matrix.every(Number.isFinite) && Math.abs(matrix[12]!) < 1e-12 && Math.abs(matrix[13]!) < 1e-12 && Math.abs(matrix[14]!) < 1e-12 && Math.abs(matrix[15]! - 1) < 1e-12;

export function buildNativeStepAssemblyPlan(input: { architecture: ComplexProductArchitecture; transforms: OccurrenceTransformEvidence[]; artifacts: NativeStepPartArtifact[]; assignments: ManufacturingAssignment[] }): NativeStepAssemblyPlan {
  const codes: string[] = [], artifacts = new Map(input.artifacts.map(item => [item.definitionId, item])), assignments = new Map(input.assignments.map(item => [item.definitionId, item])), transforms = new Map(input.transforms.map(item => [item.occurrenceId, item.matrix]));
  const partDefinitions = input.architecture.definitions.filter(item => item.kind === 'part');
  const definitions = partDefinitions.flatMap(definition => {
    const artifact = artifacts.get(definition.id), assignment = assignments.get(definition.id);
    if (!artifact) codes.push(`STEP_ASSEMBLY_PART_ARTIFACT_MISSING:${definition.id}`);
    else if (!SHA256.test(artifact.sha256) || !artifact.stepPath.trim()) codes.push(`STEP_ASSEMBLY_PART_ARTIFACT_INVALID:${definition.id}`);
    if (!assignment) codes.push(`STEP_ASSEMBLY_MANUFACTURING_ASSIGNMENT_MISSING:${definition.id}`);
    return artifact && assignment ? [{ definitionId: definition.id, name: definition.name, stepPath: artifact.stepPath, sha256: artifact.sha256, material: assignment.material, process: assignment.process, provenanceRef: assignment.sourceRef }] : [];
  });
  const occurrences = input.architecture.occurrences.map(occurrence => {
    const matrix = transforms.get(occurrence.id);
    if (!matrix) codes.push(`STEP_ASSEMBLY_TRANSFORM_MISSING:${occurrence.id}`);
    else if (!matrixValid(matrix)) codes.push(`STEP_ASSEMBLY_TRANSFORM_INVALID:${occurrence.id}`);
    return { occurrenceId: occurrence.id, definitionId: occurrence.definitionId, parentOccurrenceId: occurrence.parentOccurrenceId, localToParent: matrix ?? [] };
  });
  const hard = codes.some(code => code.includes('_INVALID:'));
  return { schema: 'nexyfab.native-step-assembly-plan.v1', status: hard ? 'fail' : codes.length ? 'not_run' : 'pass', definitions, occurrences, codes };
}
