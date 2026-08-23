// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: vi.fn(async () => ({ id: 'u1', email: 'user@example.com' })) }));
const request = () => new NextRequest('http://localhost/api/nexyfab/brep/step-export-from-stl', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], triangles: [0, 1, 2] }) });

describe('mesh STEP trust boundary', () => {
  afterEach(() => { delete process.env.NEXYFAB_COMMERCIAL_MODE; });
  it('blocks faceted mesh STEP in commercial mode', async () => {
    process.env.NEXYFAB_COMMERCIAL_MODE = '1';
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'MESH_STEP_NOT_RELEASE_ELIGIBLE' });
  });
  it('marks non-commercial mesh STEP as preview-only and not release eligible', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('X-NexyFab-Fidelity')).toBe('preview-mesh-faceted');
    expect(response.headers.get('X-Manufacturing-Release-Eligible')).toBe('false');
  });
});
