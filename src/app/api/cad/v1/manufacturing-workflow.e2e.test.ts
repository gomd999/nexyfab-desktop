import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as sheetVerify } from './sheet-metal/verify/route';
import { POST as weldVerify } from './weldment/verify/route';
import { POST as toleranceAnalyze } from './tolerance/analyze/route';
import { POST as pmiVerify } from './pmi/verify/route';
import { POST as manufacturingVerify } from './manufacturing/verify/route';

const request = (path: string, body: unknown) => new NextRequest(`http://localhost/api/cad/v1/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('CAD v1 manufacturing workflow golden path', () => {
  it('verifies fabrication artifacts and evidence without creating quote/RFQ work', async () => {
    const sheet = await (await sheetVerify(request('sheet-metal/verify', { spec: { thicknessMm: 1.5, material: 'mildSteel', baseWidthMm: 100, baseLengthMm: 200, ops: [{ kind: 'bend', angle: 90, radius: 2, position: .5 }] } }))).json();
    const weld = await (await weldVerify(request('weldment/verify', { spec: { sectionType: 0, sizeMm: 40, thicknessMm: 2, segments: [{ start: [0, 0, 0], end: [500, 0, 0] }, { start: [500, 0, 0], end: [500, 300, 0] }] } }))).json();
    const tolerance = await (await toleranceAnalyze(request('tolerance/analyze', { dimensions: [{ id: 'gap', name: 'gap', nominal: 5, tolerancePlus: .1, toleranceMinus: -.1, direction: 1, distribution: 'normal' }], lowerSpec: 4.8, upperSpec: 5.2 }))).json();
    const pmi = await (await pmiVerify(request('pmi/verify', { callouts: [{ id: 'flat', viewportId: 'top', kind: 'flatness', targetRef: 'f.cap.top', toleranceValue: .1 }], validTopologyRefs: ['f.cap.top'] }))).json();
    expect(sheet.designOk).toBe(true);
    expect(weld.designOk).toBe(true);
    expect(tolerance.designOk).toBe(true);
    expect(pmi.designOk).toBe(true);

    const report = await (await manufacturingVerify(request('manufacturing/verify', {
      provenance: { traceable: true, privacyCompliant: true, refs: ['golden:workflow'] },
      intent: { resolved: true, unresolved: [], conflicts: [] }, program: { valid: true, errors: [], hash: 'golden' },
      kernel: { built: true, analytic: true, engine: 'OCCT', errors: [] }, topology: { closed: true, solidCount: 1, manifold: true, errors: [] },
      dimensions: { checked: 1, maxErrorMm: 0, toleranceMm: .1, mismatches: [] }, features: { requested: 4, verified: 4, skipped: [], mismatches: [] },
      dfm: { process: 'mixed-fabrication', material: 'declared-per-part', passed: true, violations: [] },
      stepRoundtrip: { reimported: true, topologyMatched: true, dimensionsMatched: true, errors: [] },
      release: { artifactId: 'golden-artifact', exactArtifactVerified: true, authorized: true, reasons: [] },
    }))).json();
    expect(report.designOk).toBe(true);
    expect(report.sideEffects).toEqual({ quoteCreated: false, rfqCreated: false, artifactReleased: false });
    expect(sheet.sideEffects.rfqCreated).toBe(false);
    expect(weld.sideEffects.rfqCreated).toBe(false);
  });
});
