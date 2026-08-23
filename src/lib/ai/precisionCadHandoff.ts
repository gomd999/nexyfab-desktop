import { convertScadDefinitionToCanonical, type ScadCanonicalFeatureProgram, type ScadCanonicalNode } from './scadCanonicalFeatureProgram';
import type { FeatureProgram, ProgramFeature } from '../../app/[lang]/studio/emitScadFromProgram';

export type PrecisionCadHandoff = {
  schema: 'nexyfab.precision-cad-handoff.v1';
  status: 'ready' | 'blocked';
  canonical: ScadCanonicalFeatureProgram;
  supportedOperations: string[];
  blockedReasons: string[];
  requiresReview: boolean;
  /** Editable modeler program only when the canonical tree is a single
   * supported primitive. Complex boolean/transform trees remain review-only. */
  editableProgram?: FeatureProgram;
};

function collectOps(node: ScadCanonicalNode | null, out = new Set<string>): string[] {
  if (!node) return [...out];
  out.add(node.op);
  if ('children' in node) node.children.forEach(child => collectOps(child, out));
  return [...out].sort();
}

function primitiveProgram(node: ScadCanonicalNode | null, part: string): FeatureProgram | undefined {
  if (!node) return undefined;
  if (node.op === 'box') {
    return { part, features: [{ id: node.id, type: 'sketchExtrude', shape: 'rect', width: node.size[0], depth: node.size[1], height: node.size[2] }] };
  }
  if (node.op === 'cylinder') {
    return { part, features: [{ id: node.id, type: 'sketchExtrude', shape: 'circle', width: node.diameter, depth: node.diameter, height: node.height }] };
  }
  return undefined;
}

/** Existing canonical SCAD parser + a fail-closed handoff decision for Precision CAD. */
export function buildPrecisionCadHandoff(input: { definitionId: string; moduleSource: string; sourceRef: string; partNumber?: string }): PrecisionCadHandoff {
  const canonical = convertScadDefinitionToCanonical(input);
  const supportedOperations = collectOps(canonical.root);
  const blockedReasons: string[] = [];
  if (canonical.status !== 'pass') blockedReasons.push(...canonical.unsupportedCodes);
  if (canonical.root?.op === 'union' && canonical.root.children.length > 1) blockedReasons.push('MULTI_BODY_UNION_REQUIRES_BODY_SELECTION');
  if (canonical.unresolvedMetadata.includes('material')) blockedReasons.push('MATERIAL_CONFIRMATION_REQUIRED');
  if (canonical.unresolvedMetadata.includes('process')) blockedReasons.push('PROCESS_CONFIRMATION_REQUIRED');
  const editableProgram = canonical.status === 'pass' && blockedReasons.every(reason => !reason.startsWith('SCAD_FEATURE_'))
    ? primitiveProgram(canonical.root, canonical.partNumber)
    : undefined;
  return {
    schema: 'nexyfab.precision-cad-handoff.v1',
    status: blockedReasons.some(reason => reason.startsWith('SCAD_FEATURE_')) ? 'blocked' : 'ready',
    canonical,
    supportedOperations,
    blockedReasons,
    requiresReview: true,
    ...(editableProgram ? { editableProgram } : {}),
  };
}
