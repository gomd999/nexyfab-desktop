import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { createGenerationRun, GENERATION_STAGES, recordGenerationStage } from '@/lib/ai/generationRunState';
import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/cad/v1/generation/finalize', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
function state() { let result = createGenerationRun('route'); for (const stage of GENERATION_STAGES.slice(0, 7)) result = recordGenerationStage(result, { stage, input: stage, output: true, status: 'passed' }); return result; }
const program = {
  version: 1 as const, units: 'mm' as const, classification: 'review_required' as const, name: 'part', unresolved: [],
  assembly: { parts: [{ id: 'p1', name: 'p1', partTemplateId: 'p1', fixed: true, position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }], mates: [] },
  parts: [{ instanceId: 'p1', metadata: { partNumber: 'P1', revision: 'A', quantity: 1, source: 'confirmed' as const }, featureTree: { nodes: [{ id: 'e', name: 'e', dependencies: [], payload: { kind: 'extrude' as const, loop: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], depth: 1, direction: 'one_sided' as const, mode: 'add' as const } }] } }],
};

describe('generation finalize route', () => {
  it('rejects incomplete request envelopes', async () => { const response = await POST(request({})); expect(response.status).toBe(400); });
  it('returns actionable not_run motion evidence when governed animation is missing', async () => {
    const response = await POST(request({ state: state(), program, motion: { required: true }, parts: [] })); const body = await response.json();
    expect(response.status).toBe(200); expect(body).toMatchObject({ ok: true, stoppedAt: 'motion', canonical: { schema: 'nexyfab.generation-canonical-response.v1', status: 'not_run', stoppedAt: 'motion', releaseReady: false, quoteOrRfqSideEffects: false }, recovery: { action: 'request_input', stage: 'motion' }, quoteOrRfqSideEffects: false }); expect(body.canonical.contractHash).toMatch(/^[a-f0-9]{64}$/); expect(body.state.stages.motion.status).toBe('not_run');
  });
});
