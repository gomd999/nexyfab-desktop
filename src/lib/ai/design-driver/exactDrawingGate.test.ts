import { describe, expect, it } from 'vitest';
import { lBracketPlan, steppedShaftPlan } from './fixturePlanner';
import { buildExactCadArtifact } from './exactCadGate';
import { buildExactDrawingArtifact, exactDrawingGate } from './exactDrawingGate';

describe('Design Driver exact drawing gate', () => {
  it('reimports the verified STEP and emits complete OCCT HLR SVG evidence', async () => {
    const part = lBracketPlan().parts[0]!;
    const exactCad = await buildExactCadArtifact(part);
    expect(exactCad.ok, exactCad.reason).toBe(true);

    const artifact = await buildExactDrawingArtifact(part, exactCad);
    expect(artifact.ok, artifact.reason).toBe(true);
    expect(artifact.views.map(view => view.view)).toEqual(['front', 'top', 'right']);
    expect(artifact.views.every(view => view.method === 'replicad-hlr')).toBe(true);
    expect(artifact.views.every(view => view.visiblePathCount > 0)).toBe(true);
    expect(artifact.views.every(view => view.sourceStepSha256.length === 64)).toBe(true);
    expect(artifact.views.every(view => view.svgSha256.length === 64)).toBe(true);
    expect(artifact.views.every(view => view.svg.startsWith('<?xml'))).toBe(true);
    expect(artifact.views.every(view => view.svg.includes('data-layer="visible"'))).toBe(true);
    expect(artifact.views.every(view => view.curveCount > 0)).toBe(true);
    expect(artifact.views.every(view => view.curveRecordSha256.length === 64)).toBe(true);
    expect(artifact.views.every(view => view.exactDxfSha256.length === 64)).toBe(true);
    expect(artifact.views.every(view => view.exactDxf.includes('\nENTITIES\n'))).toBe(true);
    expect(artifact.views.every(view => /\n(?:LINE|CIRCLE|ARC|SPLINE)\n/.test(view.exactDxf))).toBe(true);

    const gate = exactDrawingGate(part, exactCad, artifact);
    expect(gate.pass, gate.reason).toBe(true);
    expect(gate.metrics.exactViewCount).toBe(3);
    expect(gate.metrics.requiredViewCount).toBe(3);
    expect(gate.metrics.exactDxfViewCount).toBe(3);
  }, 60_000);

  it('preserves analytic curve evidence from a revolved exact body', async () => {
    const part = steppedShaftPlan().parts[0]!;
    const exactCad = await buildExactCadArtifact(part);
    expect(exactCad.ok, exactCad.reason).toBe(true);
    const artifact = await buildExactDrawingArtifact(part, exactCad);
    expect(artifact.ok, artifact.reason).toBe(true);
    expect(artifact.views.some(view => view.analyticCurveEvidence)).toBe(true);
    expect(artifact.views.some(view => view.exactDxf.includes('\nCIRCLE\n'))).toBe(true);
  }, 60_000);

  it('fails closed when verified STEP evidence is absent', async () => {
    const part = lBracketPlan().parts[0]!;
    const artifact = await buildExactDrawingArtifact(part, null);
    expect(artifact.ok).toBe(false);
    expect(exactDrawingGate(part, null, artifact)).toMatchObject({
      id: 'exact-drawing:bracket',
      kind: 'exact-drawing',
      pass: false,
    });
  });
});
