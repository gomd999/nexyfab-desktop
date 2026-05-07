import { create } from 'zustand';
import {
  DEFAULT_PDM_META_SLICE,
  parsePdmFromMeta,
  buildSerializedMeta,
  type NfabLifecycleState,
  type NfabPdmMetaSlice,
} from '../io/nfabPdmMeta';

interface PdmProjectMetaState extends NfabPdmMetaSlice {
  extraMeta: Record<string, unknown>;
  hydrateFromProjectMeta: (meta: Record<string, unknown> | undefined) => void;
  setPartNumber: (v: string) => void;
  setLifecycle: (v: NfabLifecycleState) => void;
  setRevisionLabel: (v: string) => void;
  reset: () => void;
  metaForNfabSerialize: () => Record<string, unknown> | undefined;
}

export const usePdmProjectMetaStore = create<PdmProjectMetaState>((set, get) => ({
  ...DEFAULT_PDM_META_SLICE,
  extraMeta: {},

  hydrateFromProjectMeta(meta) {
    const { slice, extraMeta } = parsePdmFromMeta(meta);
    set({
      partNumber: slice.partNumber,
      lifecycle: slice.lifecycle,
      revisionLabel: slice.revisionLabel,
      extraMeta,
    });
  },

  setPartNumber(v) {
    set({ partNumber: v.slice(0, 120) });
  },

  setLifecycle(v) {
    set({ lifecycle: v === 'released' ? 'released' : 'wip' });
  },

  setRevisionLabel(v) {
    set({ revisionLabel: v.slice(0, 64) });
  },

  reset() {
    set({ ...DEFAULT_PDM_META_SLICE, extraMeta: {} });
  },

  metaForNfabSerialize() {
    const { partNumber, lifecycle, revisionLabel, extraMeta } = get();
    return buildSerializedMeta(extraMeta, { partNumber, lifecycle, revisionLabel });
  },
}));
