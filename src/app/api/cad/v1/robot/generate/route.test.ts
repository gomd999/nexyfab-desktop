import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { safeRobot } from '@/lib/ai/robot/robotEngineering.test';
import { ROBOT_6AXIS_DEMONSTRATOR_SPEC } from '@/lib/ai/robot/robotDemonstrator';
import { POST } from './route';

describe('CAD v1 robot generation', () => {
  it('returns editable robot CAD and honest engineering/release state', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: safeRobot }) }));
    const payload = await response.json();
    expect(payload.program.parts).toHaveLength(25);
    expect(payload.productObjective).toBe('complete_manufacturing_product');
    expect(payload.generationState.stages.part_programs.status).toBe('passed');
    expect(payload.executionPlan).toMatchObject({ status: 'ai_building', activeStage: 'kernel', aiCanContinue: true, precisionCad: { required: false }, externalCadInstallationRequired: false });
    expect(payload.engineering.torque).toHaveLength(6);
    expect(payload.selectionRequirements.ok).toBe(false);
    expect(payload.catalogEvidence).toEqual({ status: 'not_supplied', previewOnly: true, productionEligible: false });
    expect(payload.housingFit).toEqual({ status: 'not_run', reason: expect.stringContaining('Traceable') });
    expect(payload.releaseReady).toBe(false);
    expect(payload.quoteOrRfqSideEffects).toBe(false);
  });
  it('never promotes a request-body catalog to production evidence', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'robot-catalog-preview-test' }, body: JSON.stringify({ spec: ROBOT_6AXIS_DEMONSTRATOR_SPEC, catalog: [] }) }));
    const payload = await response.json();
    expect(payload.catalogEvidence).toEqual({ status: 'unverified_request_payload', previewOnly: true, productionEligible: false });
    expect(payload.releaseBlockers.some((blocker: unknown) => typeof blocker === 'string' && blocker.includes('offline manifest gate'))).toBe(true);
    expect(payload.releaseReady).toBe(false);
  });
});
