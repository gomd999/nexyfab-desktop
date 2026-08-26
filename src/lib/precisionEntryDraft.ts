export const DIRECT_PRECISION_ENTRY_DRAFT_KEY = 'nexyfab:precision-entry-draft:v1';
export const AGENTIC_PRECISION_ENTRY_DRAFT_KEY = 'nexyfab:agentic-entry-draft:v1';

export type PrecisionEntryDraft = {
  version: 1;
  prompt: string;
  lane: 'precision-cad' | 'agentic-cad';
  projectId: string;
  attachment?: { name: string; mime: string; reattachRequired: true };
};

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function parsePrecisionEntryDraft(value: string | null, expectedLane?: PrecisionEntryDraft['lane']): PrecisionEntryDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Partial<PrecisionEntryDraft>;
    if (draft.version !== 1 || typeof draft.prompt !== 'string' || !draft.prompt.trim() || draft.prompt.length > 4_000
      || (draft.lane !== 'precision-cad' && draft.lane !== 'agentic-cad') || expectedLane && draft.lane !== expectedLane
      || typeof draft.projectId !== 'string' || !SAFE_ID.test(draft.projectId)) return null;
    if (draft.attachment && (typeof draft.attachment.name !== 'string' || typeof draft.attachment.mime !== 'string' || draft.attachment.reattachRequired !== true)) return null;
    return draft as PrecisionEntryDraft;
  } catch {
    return null;
  }
}
