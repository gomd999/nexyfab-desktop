/**
 * PDM-lite (M6 v0) — namespaced block inside `NfabProjectV1.meta`.
 * Keeps arbitrary `meta` keys while reserving `nexyfabPdm` for part identity + lifecycle.
 */

import { NFAB_PDM_META_KEY as NFAB_PDM_META_KEY_CONST } from '@/lib/nfProjectPdmConstants';

export const NFAB_PDM_META_KEY = NFAB_PDM_META_KEY_CONST;

export type NfabLifecycleState = 'wip' | 'released';

export interface NfabPdmMetaSlice {
  partNumber: string;
  lifecycle: NfabLifecycleState;
  revisionLabel: string;
}

export const DEFAULT_PDM_META_SLICE: NfabPdmMetaSlice = {
  partNumber: '',
  lifecycle: 'wip',
  revisionLabel: '',
};

export function coerceLifecycle(v: unknown): NfabLifecycleState {
  return v === 'released' ? 'released' : 'wip';
}

export function parsePdmFromMeta(meta: Record<string, unknown> | undefined): {
  slice: NfabPdmMetaSlice;
  extraMeta: Record<string, unknown>;
} {
  const extra: Record<string, unknown> = meta ? { ...meta } : {};
  const raw = extra[NFAB_PDM_META_KEY];
  delete extra[NFAB_PDM_META_KEY];

  const slice: NfabPdmMetaSlice = { ...DEFAULT_PDM_META_SLICE };
  if (raw && typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if (typeof o.partNumber === 'string') slice.partNumber = o.partNumber.trim().slice(0, 120);
    if (typeof o.revisionLabel === 'string') slice.revisionLabel = o.revisionLabel.trim().slice(0, 64);
    slice.lifecycle = coerceLifecycle(o.lifecycle);
  }
  return { slice, extraMeta: extra };
}

/** Merge free-form meta with the PDM slice for `serializeProject`. Returns `undefined` if nothing to persist. */
export function buildSerializedMeta(
  extraMeta: Record<string, unknown>,
  slice: NfabPdmMetaSlice,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = { ...extraMeta };
  const hasPdm =
    slice.partNumber.trim() !== '' ||
    slice.revisionLabel.trim() !== '' ||
    slice.lifecycle === 'released';
  if (hasPdm) {
    const block: Record<string, unknown> = {};
    if (slice.partNumber.trim()) block.partNumber = slice.partNumber.trim();
    if (slice.revisionLabel.trim()) block.revisionLabel = slice.revisionLabel.trim();
    if (slice.lifecycle === 'released') block.lifecycle = 'released';
    out[NFAB_PDM_META_KEY] = block;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
