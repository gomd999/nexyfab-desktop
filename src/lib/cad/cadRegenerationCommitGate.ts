import { createHash } from 'node:crypto';
import type { TopologyRemapResult } from './topologyRemap';

export const CAD_REGENERATION_GATE_SCHEMA = 'nexyfab.cad-regeneration-gate.v1' as const;

export type CadKernelRegenerationResult =
  | { status: 'success'; geometryContentHash: string; shapeIdentityHash: string }
  | { status: 'failed'; errorCode: string };

export type CadRegenerationGateStatus =
  | 'committable'
  | 'confirmation_required'
  | 'reference_lost'
  | 'kernel_failed'
  | 'invalid_evidence';

export interface CadRegenerationGateResult {
  schema: typeof CAD_REGENERATION_GATE_SCHEMA;
  status: CadRegenerationGateStatus;
  committable: boolean;
  preserveBaseRevision: boolean;
  geometryContentHash: string | null;
  shapeIdentityHash: string | null;
  confirmedDerivedRefs: string[];
  confirmationRequiredRefs: string[];
  lostRefs: Array<{ previousRef: string; quality: 'ambiguous' | 'broken'; reason: string }>;
  codes: string[];
  evidenceHash: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function evidenceHash(value: Omit<CadRegenerationGateResult, 'evidenceHash'>): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Final no-guess boundary between kernel regeneration and workspace commit.
 * A derived topology match remains review-only until the user explicitly
 * confirms that exact previous reference. Broken/ambiguous references and
 * kernel failures never expose a candidate hash to persistence.
 */
export function gateCadRegenerationCommit(input: {
  kernel: CadKernelRegenerationResult;
  remaps: readonly TopologyRemapResult[];
  confirmedDerivedRefs?: readonly string[];
}): CadRegenerationGateResult {
  const confirmations = new Set(input.confirmedDerivedRefs ?? []);
  const refs = new Set<string>();
  const invalid: string[] = [];
  const lostRefs: CadRegenerationGateResult['lostRefs'] = [];
  const confirmationRequiredRefs: string[] = [];
  const confirmedDerivedRefs: string[] = [];

  for (const remap of input.remaps) {
    if (!remap.previousRef.trim() || refs.has(remap.previousRef)) {
      invalid.push(`INVALID_REMAP:${remap.previousRef || '(empty)'}`);
      continue;
    }
    refs.add(remap.previousRef);
    if ((remap.quality === 'persistent' || remap.quality === 'derived') && !remap.mappedRef?.trim()) {
      invalid.push(`MAPPED_REF_MISSING:${remap.previousRef}`);
    } else if (remap.quality === 'ambiguous' || remap.quality === 'broken') {
      lostRefs.push({ previousRef: remap.previousRef, quality: remap.quality, reason: remap.reason });
    } else if (remap.quality === 'derived') {
      (confirmations.has(remap.previousRef) ? confirmedDerivedRefs : confirmationRequiredRefs)
        .push(remap.previousRef);
    }
  }
  for (const confirmation of confirmations) {
    const remap = input.remaps.find(item => item.previousRef === confirmation);
    if (!remap || remap.quality !== 'derived') invalid.push(`INVALID_CONFIRMATION:${confirmation}`);
  }

  let status: CadRegenerationGateStatus;
  const codes: string[] = [];
  if (input.kernel.status === 'failed') {
    status = 'kernel_failed';
    codes.push(`KERNEL_OPERATION_FAILED:${input.kernel.errorCode || 'unknown'}`);
  } else if (!SHA256.test(input.kernel.geometryContentHash) || !SHA256.test(input.kernel.shapeIdentityHash) || invalid.length) {
    status = 'invalid_evidence';
    codes.push(...invalid);
    if (!SHA256.test(input.kernel.geometryContentHash) || !SHA256.test(input.kernel.shapeIdentityHash)) {
      codes.push('INVALID_KERNEL_GEOMETRY_IDENTITY');
    }
  } else if (lostRefs.length) {
    status = 'reference_lost';
    codes.push(...lostRefs.map(item => `REFERENCE_LOST:${item.previousRef}:${item.quality}`));
  } else if (confirmationRequiredRefs.length) {
    status = 'confirmation_required';
    codes.push(...confirmationRequiredRefs.map(ref => `REFERENCE_CONFIRMATION_REQUIRED:${ref}`));
  } else {
    status = 'committable';
  }

  const committable = status === 'committable';
  const result: Omit<CadRegenerationGateResult, 'evidenceHash'> = {
    schema: CAD_REGENERATION_GATE_SCHEMA,
    status,
    committable,
    preserveBaseRevision: !committable,
    geometryContentHash: committable && input.kernel.status === 'success' ? input.kernel.geometryContentHash : null,
    shapeIdentityHash: committable && input.kernel.status === 'success' ? input.kernel.shapeIdentityHash : null,
    confirmedDerivedRefs: confirmedDerivedRefs.sort(),
    confirmationRequiredRefs: confirmationRequiredRefs.sort(),
    lostRefs: lostRefs.sort((a, b) => a.previousRef.localeCompare(b.previousRef)),
    codes: [...new Set(codes)].sort(),
  };
  return { ...result, evidenceHash: evidenceHash(result) };
}

/** Executes persistence only after the complete kernel/reference gate passes. */
export async function commitAfterCadRegenerationGate<T>(
  gate: CadRegenerationGateResult,
  commit: () => Promise<T>,
): Promise<{ committed: true; value: T } | { committed: false; gate: CadRegenerationGateResult }> {
  if (!gate.committable) return { committed: false, gate };
  return { committed: true, value: await commit() };
}
