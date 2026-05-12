/**
 * B7 — RFQ template library API tests.
 *
 * Validates auth, ownership checks, system templates always shipped,
 * and POST shape (sourceRfqId vs fields).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/auth-middleware', () => ({
  getAuthUser: vi.fn(),
}));

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: vi.fn(() => ({
    queryOne: vi.fn().mockResolvedValue(null),
    queryAll: vi.fn().mockResolvedValue([]),
    execute: vi.fn().mockResolvedValue(undefined),
  })),
}));

import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';

let GET: typeof import('../route').GET;
let POST: typeof import('../route').POST;
let DELETE: typeof import('../route').DELETE;

beforeEach(async () => {
  vi.resetModules();
  ({ GET, POST, DELETE } = await import('../route'));
});

function makeReq(method: string, body?: unknown, query?: string) {
  return new Request(`http://test/api/nexyfab/rfq-templates${query ? '?' + query : ''}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('GET /rfq-templates', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(401);
  });

  it('returns user + system templates for authed user', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await GET(makeReq('GET') as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.user)).toBe(true);
    expect(Array.isArray(body.system)).toBe(true);
    // 7 system templates ship in the catalog.
    expect(body.system.length).toBeGreaterThanOrEqual(5);
  });
});

describe('POST /rfq-templates', () => {
  it('401 when unauthenticated', async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);
    const res = await POST(makeReq('POST', { name: 'x', fields: {} }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
  });

  it('400 when name missing', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await POST(makeReq('POST', { fields: {} }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('400 when neither sourceRfqId nor fields provided', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await POST(makeReq('POST', { name: 'x' }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it('201 when fields provided directly', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await POST(makeReq('POST', {
      name: 'My CNC bracket',
      fields: { materialId: 'aluminum_6061', quantity: 5 },
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.name).toBe('My CNC bracket');
    expect(body.template.fields.materialId).toBe('aluminum_6061');
  });

  it('clones from sourceRfqId when valid + owned', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({
        user_id: 'u1',
        shape_id: 's1', shape_name: 'plate',
        material_id: 'aluminum_6061',
        quantity: 10,
        volume_cm3: 50, surface_area_cm2: 100,
        bbox: '{"w":80,"h":60,"d":15}',
        note: 'precision IT8', deadline: null,
        preferred_factory_id: null,
      }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);

    const res = await POST(makeReq('POST', {
      name: 'My past bracket',
      sourceRfqId: 'rfq-123',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.fields.materialId).toBe('aluminum_6061');
    expect(body.template.fields.quantity).toBe(10);
    expect(body.template.sourceRfqId).toBe('rfq-123');
  });

  it('403 when sourceRfqId belongs to another user', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(getDbAdapter).mockReturnValue({
      queryOne: vi.fn().mockResolvedValue({
        user_id: 'someone-else',
        shape_id: 's1', shape_name: 'x', material_id: 'x', quantity: 1,
        volume_cm3: 0, surface_area_cm2: 0, bbox: '{}',
        note: null, deadline: null, preferred_factory_id: null,
      }),
      queryAll: vi.fn().mockResolvedValue([]),
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDbAdapter>);

    const res = await POST(makeReq('POST', {
      name: 'theft attempt',
      sourceRfqId: 'rfq-999',
    }) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /rfq-templates', () => {
  it('400 when id missing', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await DELETE(makeReq('DELETE') as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(400);
  });

  it('204 on successful delete', async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ userId: 'u1', orgIds: [] } as unknown as Awaited<ReturnType<typeof getAuthUser>>);
    const res = await DELETE(makeReq('DELETE', undefined, 'id=tpl_abc') as Parameters<typeof DELETE>[0]);
    expect(res.status).toBe(204);
  });
});
