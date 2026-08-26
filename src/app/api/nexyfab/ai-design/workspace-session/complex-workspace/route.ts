import { type NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { rateLimit } from '@/lib/rate-limit';
import { loadAiDesignComplexWorkspaceReadModel } from '@/lib/ai/aiDesignComplexWorkspaceService';
import {
  createAiDesignComplexWorkspaceUxV2,
  type AiDesignWorkspaceConnectionState,
  type AiDesignWorkspaceLocale,
} from '@/lib/ai/aiDesignComplexWorkspaceUxV2';
import { createAiDesignUnifiedWorkspaceV9 } from '@/lib/ai/aiDesignUnifiedWorkspaceV9';

export const runtime = 'nodejs';
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const LOCALES: readonly AiDesignWorkspaceLocale[] = ['ko', 'en', 'ja', 'zh', 'cn', 'es', 'ar'];
const CONNECTIONS: readonly AiDesignWorkspaceConnectionState[] = ['online', 'offline', 'reconnecting', 'stale_revision', 'conflict', 'interrupted'];

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!rateLimit(`ai-design-complex-workspace:${authUser.userId}`, 120, 60_000).allowed) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 });
  const projectId = req.nextUrl.searchParams.get('projectId') ?? '';
  const sessionId = req.nextUrl.searchParams.get('sessionId') ?? '';
  const selectedNodeId = req.nextUrl.searchParams.get('selectedNodeId');
  const viewportRaw = req.nextUrl.searchParams.get('viewportWidth');
  const viewportWidth = viewportRaw === null ? undefined : Number(viewportRaw);
  const localeRaw = req.nextUrl.searchParams.get('locale');
  const locale = localeRaw === null ? undefined : localeRaw as AiDesignWorkspaceLocale;
  const connectionRaw = req.nextUrl.searchParams.get('connection');
  const connection = connectionRaw === null ? undefined : connectionRaw as AiDesignWorkspaceConnectionState;
  const treeOffsetRaw = req.nextUrl.searchParams.get('treeOffset');
  const treeLimitRaw = req.nextUrl.searchParams.get('treeLimit');
  const treeOffset = treeOffsetRaw === null ? undefined : Number(treeOffsetRaw);
  const treeLimit = treeLimitRaw === null ? undefined : Number(treeLimitRaw);
  const partitionOffsetRaw = req.nextUrl.searchParams.get('partitionOffset');
  const partitionLimitRaw = req.nextUrl.searchParams.get('partitionLimit');
  const partitionOffset = partitionOffsetRaw === null ? undefined : Number(partitionOffsetRaw);
  const partitionLimit = partitionLimitRaw === null ? undefined : Number(partitionLimitRaw);
  if (!SAFE_ID.test(projectId) || !SAFE_ID.test(sessionId) || (selectedNodeId !== null && !SAFE_ID.test(selectedNodeId))
    || (viewportWidth !== undefined && (!Number.isFinite(viewportWidth) || viewportWidth < 240 || viewportWidth > 8_000))
    || (locale !== undefined && !LOCALES.includes(locale)) || (connection !== undefined && !CONNECTIONS.includes(connection))
    || (treeOffset !== undefined && (!Number.isSafeInteger(treeOffset) || treeOffset < 0 || treeOffset > 5_000))
    || (treeLimit !== undefined && (!Number.isSafeInteger(treeLimit) || treeLimit < 1 || treeLimit > 200))
    || (partitionOffset !== undefined && (!Number.isSafeInteger(partitionOffset) || partitionOffset < 0 || partitionOffset > 256))
    || (partitionLimit !== undefined && (!Number.isSafeInteger(partitionLimit) || partitionLimit < 1 || partitionLimit > 32))) {
    return NextResponse.json({ error: 'INVALID_COMPLEX_WORKSPACE_QUERY' }, { status: 400 });
  }
  if (!await resolveProjectAccess(getDbAdapter(), projectId, authUser)) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  try {
    const model = await loadAiDesignComplexWorkspaceReadModel(`${authUser.userId}:${projectId}`, projectId, sessionId, { viewportWidth, selectedNodeId });
    const ux = createAiDesignComplexWorkspaceUxV2(model, { locale, connection, treeOffset, treeLimit, partitionOffset, partitionLimit });
    const unified = createAiDesignUnifiedWorkspaceV9(model, { locale, recovery: ux.recovery });
    return NextResponse.json({ model, ux, unified }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'AI_DESIGN_COMPLEX_WORKSPACE_FAILED';
    if (code.includes('NOT_FOUND')) return NextResponse.json({ error: code }, { status: 404 });
    if (code.includes('POSTGRES')) return NextResponse.json({ error: code }, { status: 503 });
    return NextResponse.json({ error: 'AI_DESIGN_COMPLEX_WORKSPACE_FAILED' }, { status: 400 });
  }
}
