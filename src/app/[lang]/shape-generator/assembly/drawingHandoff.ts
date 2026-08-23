import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AssemblyBrowserSolveResult } from './AssemblyBrowserModal';

export const ASSEMBLY_DRAWING_HANDOFF_SCHEMA =
  'nexyfab.assembly-drawing-handoff.v1' as const;

const STORAGE_PREFIX = 'nexyfab:assembly-drawing-handoff:';
const SHA256 = /^[a-f0-9]{64}$/;

export type AssemblyDrawingHandoffStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

export interface AssemblyDrawingHandoffArtifactState {
  status: AssemblyDrawingHandoffStatus;
  sha256: string | null;
  reason: string;
}

export interface ExactSinglePartDrawingHandoffArtifact {
  schema: 'nexyfab.exact-single-part-drawing-handoff.v1';
  source: {
    handoffId: string;
    revisionId: string;
    projectId: string;
    workspaceRevision: number;
    workspaceContentSha256: string;
    stateSha256: string;
    featureTreesSha256: string;
    partFeatureTreeSha256: string;
  };
  part: { id: string; name: string; quantity: 1 };
  step: { text: string; sha256: string; bytes: number; units: 'mm' };
  verification: {
    kernel: 'OCCT_NODE';
    valid: true;
    solidCount: 1;
    faceCount: number;
    edgeCount: number;
    volumeMm3: number;
    surfaceAreaMm2: number;
    bboxMm: { min: [number, number, number]; max: [number, number, number] };
    stepRoundTripVolumeMm3: number;
    stepRoundTripVolumeRelError: number;
    freeBoundaryEdgeCount: 0;
    nonManifoldEdgeCount: 0;
  };
  drawing: {
    method: 'OCCT_HLR';
    svg: string;
    sha256: string;
    bytes: number;
    views: Array<{
      name: 'front' | 'top' | 'right';
      visiblePathCount: number;
      hiddenPathCount: number;
      viewBox: string;
    }>;
  };
  dimensions: {
    receiptJson: string;
    sha256: string;
    bytes: number;
    units: 'mm';
    overall: { x: number; y: number; z: number };
    scope: 'OVERALL_BBOX_ONLY';
  };
  bom: {
    receiptJson: string;
    sha256: string;
    bytes: number;
    itemCount: 1;
    totalQuantity: 1;
  };
  claimBoundary: {
    drawingDimensions: 'OVERALL_BBOX_ONLY';
    gdt: 'NOT_RUN';
    pmi: 'NOT_RUN';
    humanApproval: 'NOT_RUN';
    manufacturingRelease: 'BLOCKED';
  };
}

export interface AssemblyDrawingHandoff {
  schema: typeof ASSEMBLY_DRAWING_HANDOFF_SCHEMA;
  handoffId: string;
  createdAt: string;
  source: {
    projectId: string | null;
    revisionId: string;
    workspaceRevision: number | null;
    workspaceContentSha256: string | null;
    stateSha256: string;
    featureTreesSha256: string;
  };
  assembly: {
    state: AssemblyState;
    featureTrees: Record<string, FeatureTree>;
  };
  verification: {
    solver: AssemblyDrawingHandoffArtifactState & {
      phase: 'real' | 'stub' | null;
      dof: number | null;
      maxResidual: number | null;
    };
    missingFeatureTreePartIds: string[];
  };
  artifacts: {
    canonicalAssemblyIr: AssemblyDrawingHandoffArtifactState;
    editableFeatureTrees: AssemblyDrawingHandoffArtifactState;
    exactBrepStep: AssemblyDrawingHandoffArtifactState;
    drawing: AssemblyDrawingHandoffArtifactState;
    bom: AssemblyDrawingHandoffArtifactState;
    gdtPmi: AssemblyDrawingHandoffArtifactState;
    manufacturingPackage: AssemblyDrawingHandoffArtifactState;
  };
  /** Present only after server-side OCCT regeneration and immutable validation. */
  exactSinglePart?: ExactSinglePartDrawingHandoffArtifact;
}

export interface BuildAssemblyDrawingHandoffInput {
  state: AssemblyState;
  featureTrees: Record<string, FeatureTree>;
  solveResult?: AssemblyBrowserSolveResult | null;
  projectId?: string;
  upstreamRevisionId?: string;
  workspaceRevision?: number;
  workspaceContentSha256?: string;
  now?: Date;
}

function stableValue(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error('ASSEMBLY_DRAWING_HANDOFF_NESTING_TOO_DEEP');
  if (Array.isArray(value)) return value.map(child => stableValue(child, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child, depth + 1)]),
  );
}

export function serializeAssemblyDrawingHandoff(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(serializeAssemblyDrawingHandoff(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function tuple3(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3
    && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

async function validateExactSinglePartArtifact(
  handoff: AssemblyDrawingHandoff,
): Promise<boolean> {
  const exact = handoff.exactSinglePart;
  if (!exact) return false;
  const part = handoff.assembly.state.parts[0];
  const tree = part ? handoff.assembly.featureTrees[part.id] : undefined;
  if (
    exact.schema !== 'nexyfab.exact-single-part-drawing-handoff.v1'
    || handoff.assembly.state.parts.length !== 1
    || !part || !tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0
    || exact.source.handoffId !== handoff.handoffId
    || exact.source.revisionId !== handoff.source.revisionId
    || exact.source.projectId !== handoff.source.projectId
    || exact.source.workspaceRevision !== handoff.source.workspaceRevision
    || exact.source.workspaceContentSha256 !== handoff.source.workspaceContentSha256
    || exact.source.stateSha256 !== handoff.source.stateSha256
    || exact.source.featureTreesSha256 !== handoff.source.featureTreesSha256
    || exact.part.id !== part.id || exact.part.name !== part.name || exact.part.quantity !== 1
    || exact.step.units !== 'mm' || !exact.step.text.startsWith('ISO-10303-21;')
    || !exact.step.text.includes('END-ISO-10303-21;')
    || exact.step.bytes !== utf8Bytes(exact.step.text)
    || exact.verification.kernel !== 'OCCT_NODE' || exact.verification.valid !== true
    || exact.verification.solidCount !== 1
    || !Number.isSafeInteger(exact.verification.faceCount) || exact.verification.faceCount <= 0
    || !Number.isSafeInteger(exact.verification.edgeCount) || exact.verification.edgeCount <= 0
    || !finitePositive(exact.verification.volumeMm3)
    || !finitePositive(exact.verification.surfaceAreaMm2)
    || !tuple3(exact.verification.bboxMm?.min) || !tuple3(exact.verification.bboxMm?.max)
    || !finitePositive(exact.verification.stepRoundTripVolumeMm3)
    || !Number.isFinite(exact.verification.stepRoundTripVolumeRelError)
    || exact.verification.stepRoundTripVolumeRelError < 0
    || exact.verification.stepRoundTripVolumeRelError > 1e-9
    || exact.verification.freeBoundaryEdgeCount !== 0
    || exact.verification.nonManifoldEdgeCount !== 0
    || exact.drawing.method !== 'OCCT_HLR' || exact.drawing.views.length !== 3
    || exact.drawing.bytes !== utf8Bytes(exact.drawing.svg)
    || !exact.drawing.svg.startsWith('<svg')
    || /<script|\son\w+\s*=|javascript:|<foreignObject/i.test(exact.drawing.svg)
    || exact.dimensions.units !== 'mm' || exact.dimensions.scope !== 'OVERALL_BBOX_ONLY'
    || exact.dimensions.bytes !== utf8Bytes(exact.dimensions.receiptJson)
    || exact.bom.bytes !== utf8Bytes(exact.bom.receiptJson)
    || exact.bom.itemCount !== 1 || exact.bom.totalQuantity !== 1
    || exact.claimBoundary.drawingDimensions !== 'OVERALL_BBOX_ONLY'
    || exact.claimBoundary.gdt !== 'NOT_RUN' || exact.claimBoundary.pmi !== 'NOT_RUN'
    || exact.claimBoundary.humanApproval !== 'NOT_RUN'
    || exact.claimBoundary.manufacturingRelease !== 'BLOCKED'
  ) return false;
  const expectedViews = ['front', 'top', 'right'];
  if (exact.drawing.views.some((view, index) => view.name !== expectedViews[index]
    || !Number.isSafeInteger(view.visiblePathCount) || view.visiblePathCount <= 0
    || !Number.isSafeInteger(view.hiddenPathCount) || view.hiddenPathCount < 0
    || !view.viewBox.trim())) return false;
  const dimensions = {
    x: exact.verification.bboxMm.max[0] - exact.verification.bboxMm.min[0],
    y: exact.verification.bboxMm.max[1] - exact.verification.bboxMm.min[1],
    z: exact.verification.bboxMm.max[2] - exact.verification.bboxMm.min[2],
  };
  if (!Object.values(dimensions).every(finitePositive)
    || Object.entries(dimensions).some(([axis, value]) => value !== exact.dimensions.overall[axis as keyof typeof dimensions])) {
    return false;
  }
  let dimensionReceipt: Record<string, unknown>;
  let bomReceipt: Record<string, unknown>;
  try {
    dimensionReceipt = JSON.parse(exact.dimensions.receiptJson) as Record<string, unknown>;
    bomReceipt = JSON.parse(exact.bom.receiptJson) as Record<string, unknown>;
  } catch { return false; }
  const bomItems = bomReceipt.items;
  const bomItem = Array.isArray(bomItems) ? bomItems[0] as Record<string, unknown> | undefined : undefined;
  if (dimensionReceipt.schema !== 'nexyfab.overall-dimension-receipt.v1'
    || dimensionReceipt.partRevisionId !== handoff.source.revisionId
    || dimensionReceipt.partId !== part.id
    || dimensionReceipt.sourceStepSha256 !== exact.step.sha256
    || dimensionReceipt.units !== 'mm'
    || dimensionReceipt.scope !== 'OVERALL_BBOX_ONLY'
    || serializeAssemblyDrawingHandoff(dimensionReceipt.bboxMm) !== serializeAssemblyDrawingHandoff(exact.verification.bboxMm)
    || serializeAssemblyDrawingHandoff(dimensionReceipt.overall) !== serializeAssemblyDrawingHandoff(dimensions)
    || bomReceipt.schema !== 'nexyfab.single-part-bom-receipt.v1'
    || bomReceipt.partRevisionId !== handoff.source.revisionId
    || bomReceipt.sourceStepSha256 !== exact.step.sha256
    || bomReceipt.units !== 'mm'
    || !Array.isArray(bomItems) || bomItems.length !== 1
    || bomItem?.partId !== part.id
    || bomItem?.description !== part.name
    || bomItem?.quantity !== 1
    || serializeAssemblyDrawingHandoff(bomItem?.dimensionsMm) !== serializeAssemblyDrawingHandoff(dimensions)) return false;
  const [treeHash, stepHash, drawingHash, dimensionsHash, bomHash] = await Promise.all([
    sha256(tree),
    sha256Text(exact.step.text),
    sha256Text(exact.drawing.svg),
    sha256Text(exact.dimensions.receiptJson),
    sha256Text(exact.bom.receiptJson),
  ]);
  return treeHash === exact.source.partFeatureTreeSha256
    && stepHash === exact.step.sha256
    && drawingHash === exact.drawing.sha256
    && dimensionsHash === exact.dimensions.sha256
    && bomHash === exact.bom.sha256
    && handoff.artifacts.exactBrepStep.status === 'PASS'
    && handoff.artifacts.exactBrepStep.sha256 === stepHash
    && handoff.artifacts.drawing.status === 'PASS'
    && handoff.artifacts.drawing.sha256 === drawingHash
    && handoff.artifacts.bom.status === 'PASS'
    && handoff.artifacts.bom.sha256 === bomHash
    && handoff.artifacts.gdtPmi.status === 'NOT_RUN'
    && handoff.artifacts.gdtPmi.sha256 === null
    && handoff.artifacts.manufacturingPackage.status === 'BLOCKED'
    && handoff.artifacts.manufacturingPackage.sha256 === null;
}

function stateArtifact(
  status: AssemblyDrawingHandoffStatus,
  reason: string,
  sha: string | null = null,
): AssemblyDrawingHandoffArtifactState {
  return { status, sha256: sha, reason };
}

function validateAssemblyShape(state: AssemblyState): void {
  if (!Array.isArray(state.parts) || !Array.isArray(state.mates)) {
    throw new Error('ASSEMBLY_DRAWING_HANDOFF_STATE_INVALID');
  }
  if (state.parts.length === 0) {
    throw new Error('ASSEMBLY_DRAWING_HANDOFF_EMPTY');
  }
  const ids = new Set<string>();
  for (const part of state.parts) {
    if (!part || typeof part.id !== 'string' || part.id.length === 0 || ids.has(part.id)) {
      throw new Error('ASSEMBLY_DRAWING_HANDOFF_PART_IDS_INVALID');
    }
    ids.add(part.id);
  }
}

export async function buildAssemblyDrawingHandoff(
  input: BuildAssemblyDrawingHandoffInput,
): Promise<AssemblyDrawingHandoff> {
  validateAssemblyShape(input.state);
  const stateSha256 = await sha256(input.state);
  const featureTreesSha256 = await sha256(input.featureTrees);
  const missingFeatureTreePartIds = input.state.parts
    .filter(part => {
      const tree = input.featureTrees[part.id];
      return !tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0;
    })
    .map(part => part.id)
    .sort();

  const solved = input.solveResult;
  const solverPassed = solved?.phase === 'real' && solved.success === true;
  const solverStatus: AssemblyDrawingHandoffStatus = solverPassed
    ? 'PASS'
    : solved
      ? 'FAIL'
      : 'NOT_RUN';
  const solverReason = solverPassed
    ? 'The real FeatureTree assembly solver converged for this captured state.'
    : solved
      ? solved.phase === 'stub'
        ? 'Compatibility stub results are not authoritative assembly evidence.'
        : 'The real assembly solve did not converge.'
      : 'No assembly solve result is bound to this captured revision.';

  const sourcePrefix = input.upstreamRevisionId
    ?? input.projectId
    ?? 'assembly';
  const revisionId = `${sourcePrefix}:${stateSha256.slice(0, 20)}`;
  const handoffId = `${stateSha256.slice(0, 20)}-${featureTreesSha256.slice(0, 12)}`;
  const treeStatus = missingFeatureTreePartIds.length === 0 ? 'PASS' : 'BLOCKED';

  return {
    schema: ASSEMBLY_DRAWING_HANDOFF_SCHEMA,
    handoffId,
    createdAt: (input.now ?? new Date()).toISOString(),
    source: {
      projectId: input.projectId ?? null,
      revisionId,
      workspaceRevision: Number.isSafeInteger(input.workspaceRevision)
        ? input.workspaceRevision ?? null
        : null,
      workspaceContentSha256: SHA256.test(input.workspaceContentSha256 ?? '')
        ? input.workspaceContentSha256!
        : null,
      stateSha256,
      featureTreesSha256,
    },
    assembly: {
      state: input.state,
      featureTrees: input.featureTrees,
    },
    verification: {
      solver: {
        ...stateArtifact(solverStatus, solverReason, solverPassed ? stateSha256 : null),
        phase: solved?.phase ?? null,
        dof: typeof solved?.dof === 'number' ? solved.dof : null,
        maxResidual:
          typeof solved?.finalMaxResidual === 'number' ? solved.finalMaxResidual : null,
      },
      missingFeatureTreePartIds,
    },
    artifacts: {
      canonicalAssemblyIr: stateArtifact(
        'PASS',
        'Canonical AssemblyState bytes are bound to the source revision.',
        stateSha256,
      ),
      editableFeatureTrees: stateArtifact(
        treeStatus,
        missingFeatureTreePartIds.length === 0
          ? 'Every assembly occurrence has a non-empty editable FeatureTree.'
          : `FeatureTree is missing or empty for: ${missingFeatureTreePartIds.join(', ')}`,
        missingFeatureTreePartIds.length === 0 ? featureTreesSha256 : null,
      ),
      exactBrepStep: stateArtifact(
        'NOT_RUN',
        'No exact B-rep STEP artifact is carried by the assembly workspace handoff.',
      ),
      drawing: stateArtifact(
        'NOT_RUN',
        'No revision-bound 2D drawing artifact has been generated or verified yet.',
      ),
      bom: stateArtifact(
        'NOT_RUN',
        'No revision-bound BOM artifact has been generated or verified yet.',
      ),
      gdtPmi: stateArtifact(
        'NOT_RUN',
        'GD&T and AP242 PMI authoring/verification have not run for this revision.',
      ),
      manufacturingPackage: stateArtifact(
        'BLOCKED',
        'Manufacturing export remains blocked until exact STEP, drawing, BOM, PMI and release evidence pass.',
      ),
    },
  };
}

export function assemblyDrawingHandoffStorageKey(handoffId: string): string {
  if (!/^[a-f0-9]{20}-[a-f0-9]{12}$/.test(handoffId)) {
    throw new Error('ASSEMBLY_DRAWING_HANDOFF_ID_INVALID');
  }
  return `${STORAGE_PREFIX}${handoffId}`;
}

export function writeAssemblyDrawingHandoff(
  handoff: AssemblyDrawingHandoff,
  storage: Pick<Storage, 'setItem'> = globalThis.sessionStorage,
): void {
  storage.setItem(assemblyDrawingHandoffStorageKey(handoff.handoffId), JSON.stringify(handoff));
}

export type ReadAssemblyDrawingHandoffResult =
  | { ok: true; handoff: AssemblyDrawingHandoff }
  | { ok: false; reason: string };

export async function validateAssemblyDrawingHandoff(
  parsed: AssemblyDrawingHandoff,
  expectedHandoffId = parsed?.handoffId,
): Promise<ReadAssemblyDrawingHandoffResult> {
  try {
    if (
      parsed.schema !== ASSEMBLY_DRAWING_HANDOFF_SCHEMA
      || parsed.handoffId !== expectedHandoffId
      || !SHA256.test(parsed.source?.stateSha256 ?? '')
      || !SHA256.test(parsed.source?.featureTreesSha256 ?? '')
      || (parsed.source.workspaceRevision !== null
        && (!Number.isSafeInteger(parsed.source.workspaceRevision) || parsed.source.workspaceRevision < 0))
      || (parsed.source.workspaceContentSha256 !== null
        && !SHA256.test(parsed.source.workspaceContentSha256 ?? ''))
      || (parsed.source.workspaceRevision === null) !== (parsed.source.workspaceContentSha256 === null)
    ) {
      return { ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_SCHEMA_INVALID' };
    }
    validateAssemblyShape(parsed.assembly.state);
    const [actualStateSha, actualTreesSha] = await Promise.all([
      sha256(parsed.assembly.state),
      sha256(parsed.assembly.featureTrees),
    ]);
    if (
      actualStateSha !== parsed.source.stateSha256
      || actualTreesSha !== parsed.source.featureTreesSha256
      || parsed.handoffId !== `${actualStateSha.slice(0, 20)}-${actualTreesSha.slice(0, 12)}`
    ) {
      return { ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_HASH_MISMATCH' };
    }
    const missing = parsed.assembly.state.parts
      .filter(part => {
        const tree = parsed.assembly.featureTrees[part.id];
        return !tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0;
      })
      .map(part => part.id)
      .sort();
    if (
      JSON.stringify(missing) !== JSON.stringify(parsed.verification.missingFeatureTreePartIds)
      || parsed.artifacts.canonicalAssemblyIr.status !== 'PASS'
      || parsed.artifacts.canonicalAssemblyIr.sha256 !== actualStateSha
      || parsed.artifacts.editableFeatureTrees.status !== (missing.length ? 'BLOCKED' : 'PASS')
      || parsed.artifacts.editableFeatureTrees.sha256 !== (missing.length ? null : actualTreesSha)
      || (parsed.exactSinglePart
        ? !(await validateExactSinglePartArtifact(parsed))
        : parsed.artifacts.exactBrepStep.status !== 'NOT_RUN'
          || parsed.artifacts.drawing.status !== 'NOT_RUN'
          || parsed.artifacts.bom.status !== 'NOT_RUN')
      || parsed.artifacts.gdtPmi.status !== 'NOT_RUN'
      || parsed.artifacts.manufacturingPackage.status !== 'BLOCKED'
      || (parsed.verification.solver.status === 'PASS'
        && (parsed.verification.solver.phase !== 'real' || parsed.verification.solver.sha256 !== actualStateSha))
      || (parsed.verification.solver.phase === 'stub' && parsed.verification.solver.status === 'PASS')
    ) {
      return { ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_EVIDENCE_INVALID' };
    }
    return { ok: true, handoff: parsed };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function readAssemblyDrawingHandoff(
  handoffId: string,
  storage: Pick<Storage, 'getItem'> = globalThis.sessionStorage,
): Promise<ReadAssemblyDrawingHandoffResult> {
  let raw: string | null;
  try {
    raw = storage.getItem(assemblyDrawingHandoffStorageKey(handoffId));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!raw) return { ok: false, reason: 'ASSEMBLY_DRAWING_HANDOFF_NOT_FOUND' };

  try {
    return validateAssemblyDrawingHandoff(JSON.parse(raw) as AssemblyDrawingHandoff, handoffId);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
