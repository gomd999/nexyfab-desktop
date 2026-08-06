import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { safeRobot } from '@/lib/ai/robot/robotEngineering.test';
import { POST } from './route';

describe('CAD v1 robot generation', () => {
  it('returns editable robot CAD and honest engineering/release state', async () => {
    const response = await POST(new NextRequest('http://localhost/api/cad/v1/robot/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec: safeRobot }) }));
    const payload = await response.json();
    expect(payload.program.parts).toHaveLength(7);
    expect(payload.engineering.torque).toHaveLength(6);
    expect(payload.releaseReady).toBe(false);
    expect(payload.quoteOrRfqSideEffects).toBe(false);
  });
});
