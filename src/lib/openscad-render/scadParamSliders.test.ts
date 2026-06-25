import { describe, it, expect } from 'vitest';
import { extractScadSliders, applyScadSlider } from './scadParamSliders';
import { scadFromIntent } from './intentToScad';

describe('extractScadSliders', () => {
  it('extracts top-level params from a catalog intent', () => {
    const s = extractScadSliders({ shapeId: 'cylinder', params: { diameter: 20, height: 50 } });
    expect(s.map(x => x.path.join('.')).sort()).toEqual(['params.diameter', 'params.height']);
    const dia = s.find(x => x.label === 'diameter')!;
    expect(dia.value).toBe(20);
    expect(dia.min).toBeGreaterThan(0);
    expect(dia.max).toBeGreaterThan(dia.value);
  });

  it('includes feature params (e.g. a hole diameter)', () => {
    const s = extractScadSliders({
      shapeId: 'box', params: { width: 40, height: 5, depth: 40 },
      features: [{ type: 'hole', params: { diameter: 12 } }],
    });
    const hole = s.find(x => x.path.join('.') === 'features.0.params.diameter')!;
    expect(hole).toBeTruthy();
    expect(hole.value).toBe(12);
    expect(hole.label).toContain('hole');
  });

  it('uses integer step for count-like params (gear teeth)', () => {
    const s = extractScadSliders({ shapeId: 'gear', params: { teeth: 24, module: 1.5 } });
    const teeth = s.find(x => x.label === 'teeth')!;
    expect(teeth.step).toBe(1);
    expect(Number.isInteger(teeth.min)).toBe(true);
  });

  it('extracts per-part params from an assembly', () => {
    const s = extractScadSliders({
      kind: 'assembly',
      parts: [
        { name: 'plate', shapeId: 'box', params: { width: 80, height: 5, depth: 80 }, position: [0, 0, 0] },
        { name: 'leg', shapeId: 'cylinder', params: { diameter: 10, height: 40 }, position: [30, -22, 30] },
      ],
    });
    expect(s.some(x => x.label === 'plate · width')).toBe(true);
    expect(s.some(x => x.label === 'leg · diameter' && x.path.join('.') === 'parts.1.params.diameter')).toBe(true);
  });

  it('empty / null intent → no sliders', () => {
    expect(extractScadSliders(null)).toEqual([]);
    expect(extractScadSliders({ shapeId: 'box', params: {} })).toEqual([]);
  });
});

describe('applyScadSlider → scadFromIntent (no AI re-call)', () => {
  it('changing a catalog param re-emits SCAD with the new value', () => {
    const intent = { shapeId: 'cylinder', params: { diameter: 20, height: 50 } };
    const updated = applyScadSlider(intent, ['params', 'height'], 80);
    const out = scadFromIntent(updated);
    expect(out.ok).toBe(true);
    // height changed, original untouched (immutable)
    expect((updated as typeof intent).params.height).toBe(80);
    expect(intent.params.height).toBe(50);
    if (out.ok) expect(out.scad).toMatch(/80/);
  });

  it('changing an assembly part param re-emits the union', () => {
    const intent = {
      kind: 'assembly' as const,
      parts: [
        { name: 'a', shapeId: 'box', params: { width: 40, height: 5, depth: 40 } as Record<string, number>, position: [0, 0, 0] as [number, number, number] },
        { name: 'b', shapeId: 'cylinder', params: { diameter: 10, height: 40 } as Record<string, number>, position: [0, 20, 0] as [number, number, number] },
      ],
    };
    const updated = applyScadSlider(intent, ['parts', 1, 'params', 'diameter'], 25);
    const out = scadFromIntent(updated);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.scad).toMatch(/union/);
  });
});
