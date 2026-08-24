import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: { userId: 'user-1' } as { userId: string } | null,
  allowed: true,
  access: {} as object | null,
  load: vi.fn(async () => ({ schema: 'nexyfab.ai-design-complex-workspace-read-model.v4', complexRevision: 2, inputKinds: ['text'] })),
  ux: vi.fn(() => ({ schema: 'nexyfab.ai-design-complex-workspace-ux.v2', locale: 'ko', recovery: { state: 'offline', blocking: false, title: 'Offline', message: 'Read only', safeActions: ['RETRY'], mutationEnabled: false } })),
  unified: vi.fn(() => ({ schema: 'nexyfab.ai-design-unified-workspace.v9' })),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => mocks.auth) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => ({ allowed: mocks.allowed })) }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn(() => ({})) }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: vi.fn(async () => mocks.access) }));
vi.mock('@/lib/ai/aiDesignComplexWorkspaceService', () => ({ loadAiDesignComplexWorkspaceReadModel: mocks.load }));
vi.mock('@/lib/ai/aiDesignComplexWorkspaceUxV2', () => ({ createAiDesignComplexWorkspaceUxV2: mocks.ux }));
vi.mock('@/lib/ai/aiDesignUnifiedWorkspaceV9', () => ({ createAiDesignUnifiedWorkspaceV9: mocks.unified }));

import { GET } from './route';

beforeEach(() => { mocks.auth = { userId: 'user-1' }; mocks.allowed = true; mocks.access = {}; mocks.load.mockClear(); mocks.ux.mockClear(); mocks.unified.mockClear(); });

describe('AI Design complex workspace read route', () => {
  it('returns a private non-cached V4 read model', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/complex-workspace?projectId=project-1&sessionId=session-1&viewportWidth=390&selectedNodeId=part-a&locale=ko&treeOffset=80&treeLimit=40&partitionOffset=16&partitionLimit=8&connection=offline');
    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.load).toHaveBeenCalledWith('user-1:project-1', 'project-1', 'session-1', expect.objectContaining({ viewportWidth: 390, selectedNodeId: 'part-a' }));
    expect(mocks.ux).toHaveBeenCalledWith(expect.objectContaining({ complexRevision: 2 }), { locale: 'ko', treeOffset: 80, treeLimit: 40, partitionOffset: 16, partitionLimit: 8, connection: 'offline' });
    expect(mocks.unified).toHaveBeenCalledWith(expect.objectContaining({ complexRevision: 2, inputKinds: ['text'] }), expect.objectContaining({ locale: 'ko', recovery: expect.objectContaining({ state: 'offline' }) }));
    await expect(response.json()).resolves.toMatchObject({ model: { complexRevision: 2 }, ux: { locale: 'ko' }, unified: { schema: 'nexyfab.ai-design-unified-workspace.v9' } });
  });

  it('rejects invalid query identities before loading state', async () => {
    const response = await GET(new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/complex-workspace?projectId=../bad&sessionId=session-1'));
    expect(response.status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('rejects invalid locale and virtualized window bounds', async () => {
    const response = await GET(new NextRequest('http://localhost/api/nexyfab/ai-design/workspace-session/complex-workspace?projectId=project-1&sessionId=session-1&locale=xx&treeLimit=201'));
    expect(response.status).toBe(400);
    expect(mocks.load).not.toHaveBeenCalled();
  });
});
