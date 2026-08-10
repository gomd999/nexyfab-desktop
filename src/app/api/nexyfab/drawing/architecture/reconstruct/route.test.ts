import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const authoritative = (value: number) => ({ value, authoritative: true, sourceRef: 'user:test' });
function body() {
  return {
    input: {
      drawingId: 'sheet-api', widthPx: 200, heightPx: 150,
      scale: { pixelDistance: 100, realDistanceMm: 10000, authoritative: true, sourceRef: 'dimension:test' },
      annotations: [
        { id: 'space', track: 'SPA', category: '공간_거실', confidence: 1, sourceRef: 'spa:test', polygonPx: [[20, 20], [120, 20], [120, 100], [20, 100]] },
        { id: 'wt', track: 'STR', category: '구조_벽체', confidence: 1, sourceRef: 'str:test', bboxPx: [20, 18, 100, 4] },
        { id: 'wr', track: 'STR', category: '구조_벽체', confidence: 1, sourceRef: 'str:test', bboxPx: [118, 20, 4, 80] },
        { id: 'wb', track: 'STR', category: '구조_벽체', confidence: 1, sourceRef: 'str:test', bboxPx: [20, 98, 100, 4] },
        { id: 'wl', track: 'STR', category: '구조_벽체', confidence: 1, sourceRef: 'str:test', bboxPx: [18, 20, 4, 80] },
      ],
    },
    requirements: {
      storeyHeightMm: authoritative(3000), wallThicknessMm: authoritative(200), slabThicknessMm: authoritative(150),
      ceilingElevationMm: authoritative(2700), doorHeightMm: authoritative(2100), windowHeightMm: authoritative(1200),
      windowSillMm: authoritative(900), openingHostToleranceMm: authoritative(300), wallEvidenceToleranceMm: authoritative(300),
    },
  };
}

function request(value: unknown) {
  return new NextRequest('http://localhost/api/nexyfab/drawing/architecture/reconstruct', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 200) + 1}` }, body: JSON.stringify(value),
  });
}

describe('architecture drawing reconstruction route', () => {
  it('returns the exact 3D semantic plan for validated input', async () => {
    const response = await POST(request(body()));
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result).toMatchObject({ ok: true, status: 'ready_for_exact_3d', architecture: { schema: 'nexyfab.architecture.v1' }, solidPlan: { schema: 'nexyfab.architecture-solid-plan.v1' }, unifiedProject: { schema: 'nexyfab.unified-design-project.v1' }, canonicalIssues: [] });
  });

  it('returns 409 rather than inventing a missing scale', async () => {
    const value = body(); delete (value.input as { scale?: unknown }).scale;
    const response = await POST(request(value));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, status: 'authoritative_input_required' });
  });

  it('rejects malformed annotation input', async () => {
    const value = body(); value.input.annotations[0]!.confidence = 2;
    const response = await POST(request(value));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: 'invalid_request' });
  });
});
