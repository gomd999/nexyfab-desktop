import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import type { ManufacturingGateReport } from '@/lib/ai/manufacturingGates';
import { POST } from './route';
import { extractManufacturingContext } from '@/lib/ai/manufacturingContext';

function decodeReport(encoded: string): ManufacturingGateReport {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ManufacturingGateReport;
}

describe('cad-feature-step real OCCT roundtrip', () => {
  it('exports and re-imports a dimension-preserving analytic box', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/cad-feature-step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: JSON.stringify({
        part: 'roundtrip_box',
        features: [{ id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 8 }],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('ISO-10303-21');
    const encoded = response.headers.get('X-Manufacturing-Gates');
    expect(encoded).toBeTruthy();
    const report = decodeReport(encoded!);
    for (const gateId of ['G2', 'G3', 'G4', 'G5', 'G6', 'G8']) {
      expect(report.gates.find(gate => gate.id === gateId)?.status, gateId).toBe('passed');
    }
    expect(report.gates.find(gate => gate.id === 'G0')?.status).toBe('not_run');
    expect(report.passed).toBe(false);
  }, 60_000);

  it('recognizes a requested through-hole as an analytic cylindrical face', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/cad-feature-step', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.2' },
      body: JSON.stringify({
        part: 'plate_with_hole',
        features: [
          { id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 8 },
          { id: 'center-hole', type: 'hole', diameter: 6, posX: 0, posY: 0 },
        ],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const report = decodeReport(response.headers.get('X-Manufacturing-Gates')!);
    expect(report.gates.find(gate => gate.id === 'G6')).toMatchObject({
      status: 'passed', evidence: ['verified:2/2'], failures: [],
    });
    expect(report.gates.find(gate => gate.id === 'G8')?.status).toBe('passed');
  }, 60_000);

  it('binds G0-G8 evidence to one artifact hash and leaves G9 unavailable', async () => {
    const request = new NextRequest('http://localhost/api/nexyfab/cad-feature-step', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.3' },
      body: JSON.stringify({
        part: 'cnc_plate',
        verificationContext: extractManufacturingContext('CNC AL6061 plate 100x80x3 mm'),
        features: [{ id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 80, height: 3 }],
      }),
    });
    const response = await POST(request);
    expect(response.status).toBe(200);
    const report = decodeReport(response.headers.get('X-Manufacturing-Gates')!);
    for (const gateId of ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) {
      expect(report.gates.find(gate => gate.id === gateId)?.status, gateId).toBe('passed');
    }
    expect(report.firstBlockingGate).toBe('G9');
    expect(report.gates.find(gate => gate.id === 'G9')).toMatchObject({ status: 'failed' });
    const artifactId = response.headers.get('X-Artifact-Id')!;
    expect(artifactId).toMatch(/^sha256:[a-f0-9]{64}$/);
  }, 60_000);
});
