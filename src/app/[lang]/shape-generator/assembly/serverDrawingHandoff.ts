import {
  validateAssemblyDrawingHandoff,
  type AssemblyDrawingHandoff,
} from './drawingHandoff';

type HandoffFetch = typeof fetch;

export type SaveServerDrawingHandoffResult =
  | { ok: true; handoffId: string; payloadSha256: string; expiresAt: string; exactSinglePartStatus: 'PASS' | 'NOT_RUN'; exactSinglePartReason?: string }
  | { ok: false; code: string; status: number };

export async function saveServerDrawingHandoff(
  input: {
    projectId: string;
    expectedRevision: number;
    expectedContentSha256: string;
    handoff: AssemblyDrawingHandoff;
  },
  fetchImpl: HandoffFetch = fetch,
): Promise<SaveServerDrawingHandoffResult> {
  try {
    const response = await fetchImpl(
      `/api/nexyfab/projects/${encodeURIComponent(input.projectId)}/drawing-handoffs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          expectedContentSha256: input.expectedContentSha256,
          handoff: input.handoff,
        }),
      },
    );
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      return { ok: false, status: response.status, code: typeof body?.code === 'string' ? body.code : 'SERVER_HANDOFF_UNAVAILABLE' };
    }
    if (
      typeof body?.handoffId !== 'string'
      || typeof body.payloadSha256 !== 'string'
      || typeof body.expiresAt !== 'string'
      || (body.exactSinglePartStatus !== 'PASS' && body.exactSinglePartStatus !== 'NOT_RUN')
    ) return { ok: false, status: 502, code: 'SERVER_HANDOFF_RECEIPT_INVALID' };
    return {
      ok: true,
      handoffId: body.handoffId,
      payloadSha256: body.payloadSha256,
      expiresAt: body.expiresAt,
      exactSinglePartStatus: body.exactSinglePartStatus,
      ...(typeof body.exactSinglePartReason === 'string' ? { exactSinglePartReason: body.exactSinglePartReason } : {}),
    };
  } catch {
    return { ok: false, status: 0, code: 'SERVER_HANDOFF_UNAVAILABLE' };
  }
}

export async function readServerDrawingHandoff(
  projectId: string,
  handoffId: string,
  fetchImpl: HandoffFetch = fetch,
): Promise<{ ok: true; handoff: AssemblyDrawingHandoff } | { ok: false; reason: string }> {
  try {
    const response = await fetchImpl(
      `/api/nexyfab/projects/${encodeURIComponent(projectId)}/drawing-handoffs/${encodeURIComponent(handoffId)}`,
      { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' },
    );
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) return { ok: false, reason: typeof body?.code === 'string' ? body.code : `SERVER_HANDOFF_HTTP_${response.status}` };
    if (!body?.handoff || typeof body.handoff !== 'object') return { ok: false, reason: 'SERVER_HANDOFF_RESPONSE_INVALID' };
    const validated = await validateAssemblyDrawingHandoff(body.handoff as AssemblyDrawingHandoff);
    return validated.ok ? validated : { ok: false, reason: validated.reason };
  } catch {
    return { ok: false, reason: 'SERVER_HANDOFF_UNAVAILABLE' };
  }
}
