import type { DesignExecutionLane, RasterDesignClassification } from './designEntryFlow';

export const PENDING_CHAT_DESIGN_DRAFT_KEY = 'nexyfab:pending-chat-design:v1';

export type PendingChatDesignDraft = {
  version: 1;
  prompt: string;
  lane: DesignExecutionLane;
  domain: 'mechanical' | 'civil' | 'architecture' | 'landscape' | 'interior';
  scaleMm?: string;
  attachment?: {
    name: string;
    mime: string;
    classification?: RasterDesignClassification;
    reattachRequired: true;
  };
};

function validLane(value: unknown): value is DesignExecutionLane {
  return value === 'ai-design' || value === 'precision-cad' || value === 'agentic-cad';
}

function validDomain(value: unknown): value is PendingChatDesignDraft['domain'] {
  return value === 'mechanical' || value === 'civil' || value === 'architecture' || value === 'landscape' || value === 'interior';
}

export function parsePendingChatDesignDraft(value: string | null): PendingChatDesignDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<PendingChatDesignDraft>;
    if (parsed.version !== 1 || typeof parsed.prompt !== 'string' || parsed.prompt.length > 4_000 || !validLane(parsed.lane) || !validDomain(parsed.domain)) return null;
    if (parsed.scaleMm !== undefined && (typeof parsed.scaleMm !== 'string' || parsed.scaleMm.length > 64)) return null;
    if (parsed.attachment && (typeof parsed.attachment.name !== 'string' || typeof parsed.attachment.mime !== 'string')) return null;
    return parsed as PendingChatDesignDraft;
  } catch {
    return null;
  }
}

export function savePendingChatDesignDraft(storage: Pick<Storage, 'setItem'>, draft: PendingChatDesignDraft): void {
  storage.setItem(PENDING_CHAT_DESIGN_DRAFT_KEY, JSON.stringify(draft));
}

export function readPendingChatDesignDraft(storage: Pick<Storage, 'getItem'>): PendingChatDesignDraft | null {
  return parsePendingChatDesignDraft(storage.getItem(PENDING_CHAT_DESIGN_DRAFT_KEY));
}

export function clearPendingChatDesignDraft(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(PENDING_CHAT_DESIGN_DRAFT_KEY);
}
