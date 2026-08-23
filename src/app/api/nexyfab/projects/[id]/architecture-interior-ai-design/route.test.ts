import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  resolveProjectAccess: vi.fn(),
  getDbAdapter: vi.fn(),
  checkOrigin: vi.fn(),
  rateLimitAsync: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: mocks.getAuthUser }));
vi.mock('@/lib/nfProjectAccess', () => ({ resolveProjectAccess: mocks.resolveProjectAccess }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: mocks.getDbAdapter }));
vi.mock('@/lib/csrf', () => ({ checkOrigin: mocks.checkOrigin }));
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: mocks.rateLimitAsync,
  rateLimitHeaders: vi.fn(() => ({ 'X-RateLimit-Limit': '5' })),
}));
vi.mock('@/lib/ai/architectureInteriorAiDesignRuntime', () => ({ generateArchitectureInteriorAiDesign: mocks.generate }));

import { POST } from './route';

const auth = { userId: 'user-1' };
const access = { role: 'editor', canEdit: true, row: { id: 'project-1', org_id: null }, ownerUserId: 'user-1' };
const concept = {
  architecture: { storeys: [], walls: [], openings: [], slabs: [], ceilings: [] },
  interior: { furniture: [], lights: [], finishes: [], architectureDocumentId: 'architecture:project-1:p-1' },
  hashes: { proposal: 'a'.repeat(64), architecture: 'b'.repeat(64), interior: 'c'.repeat(64) },
  warnings: ['concept_only_no_exact_or_release_evidence'],
  provenance: { architecture: [], interior: [] },
};

function request(body: unknown, locale = 'en') {
  return new NextRequest('http://localhost/api/nexyfab/projects/project-1/architecture-interior-ai-design', {
    method: 'POST',
    headers: { origin: 'http://localhost', 'accept-language': locale },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'project-1' }) };
const validBody = {
  designBrief: 'A compact courtyard home with a calm, accessible interior.',
  proposalId: 'p-1',
  sourceLength: 'm',
  construction: { wallThickness: 0.2, slabThickness: 0.2, ceilingThickness: 0.1 },
};

describe('architecture/interior AI design route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue(auth);
    mocks.resolveProjectAccess.mockResolvedValue(access);
    mocks.getDbAdapter.mockReturnValue({ backend: 'sqlite' });
    mocks.checkOrigin.mockReturnValue(true);
    mocks.rateLimitAsync.mockResolvedValue({ allowed: true, remaining: 4, resetAt: Date.now() + 60_000 });
    mocks.generate.mockResolvedValue({
      ok: true,
      result: concept,
      execution: { runtimeVersion: 'nexyfab.architecture-interior-ai-runtime.v1', provider: 'openai', model: 'private', truncated: false },
    });
  });

  it('requires authentication, project access, and editor authority before provider execution', async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request(validBody), params)).status).toBe(401);
    mocks.getAuthUser.mockResolvedValueOnce(auth);
    mocks.resolveProjectAccess.mockResolvedValueOnce(null);
    expect((await POST(request(validBody), params)).status).toBe(404);
    mocks.resolveProjectAccess.mockResolvedValueOnce({ ...access, role: 'viewer', canEdit: false });
    expect((await POST(request(validBody), params)).status).toBe(403);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('rejects oversized, unknown, and provider/model spoofing inputs', async () => {
    expect((await POST(request({ ...validBody, provider: 'anthropic' }), params)).status).toBe(400);
    expect((await POST(request({ ...validBody, model: 'secret-model' }), params)).status).toBe(400);
    expect((await POST(request({ ...validBody, designBrief: 'x'.repeat(12_001) }), params)).status).toBe(400);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it('maps provider truncation without leaking provider errors', async () => {
    mocks.generate.mockResolvedValueOnce({ ok: false, code: 'MODEL_TRUNCATED', statusKey: 'architectureInterior.ai.model_truncated' });
    const response = await POST(request(validBody), params);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: 'MODEL_TRUNCATED', statusKey: 'architectureInterior.ai.model_truncated', persisted: false });
    expect(JSON.stringify(body)).not.toContain('openai');
  });

  it('returns one stable non-persisted concept contract in all six locales', async () => {
    const keys: string[][] = [];
    for (const locale of ['ko', 'en', 'ja', 'zh', 'es', 'ar']) {
      const response = await POST(request(validBody, locale), params);
      expect(response.status).toBe(200);
      const body = await response.json();
      keys.push(Object.keys(body).sort());
      expect(body).toMatchObject({
        ok: true,
        code: 'CONCEPT_PROPOSAL_READY',
        projectId: 'project-1',
        proposalId: 'p-1',
        persisted: false,
        exact: { status: 'not_run' },
        compliance: { status: 'not_run' },
        release: { status: 'not_run' },
        nextStep: { required: 'explicit_approval_and_persist_transaction' },
        quoteOrRfqSideEffects: false,
      });
      expect(body.execution).not.toHaveProperty('provider');
      expect(body.execution).not.toHaveProperty('model');
    }
    expect(keys.every(value => JSON.stringify(value) === JSON.stringify(keys[0]))).toBe(true);
    expect(mocks.generate).toHaveBeenCalledTimes(6);
  });

  it('does not persist a candidate', async () => {
    const response = await POST(request(validBody), params);
    expect(response.status).toBe(200);
    expect(mocks.resolveProjectAccess).toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-1', userId: 'user-1' }));
  });

  it('fails closed when a provider success is structurally missing candidate hashes', async () => {
    mocks.generate.mockResolvedValueOnce({ ok: true, result: { ...concept, hashes: undefined }, execution: { runtimeVersion: 'nexyfab.architecture-interior-ai-runtime.v1', provider: 'openai', model: 'private', truncated: false } });
    expect((await POST(request(validBody), params)).status).toBe(500);
  });
});
