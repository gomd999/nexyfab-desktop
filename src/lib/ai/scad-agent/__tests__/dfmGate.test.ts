import { describe, it, expect } from 'vitest';
import { runDfmGate, runDfmGateAllProcesses } from '../dfmGate';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

const goodBox: IntentInput = {
  shapeId: 'box',
  params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
};

describe('runDfmGate · wall thickness', () => {
  it('rejects a 0.5mm shell for FDM (limit 0.8mm)', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'shell', params: { thickness_mm: 0.5 } }],
    };
    const r = runDfmGate(intent, 'fdm');
    expect(r.manufacturable).toBe(false);
    expect(r.issues[0].code).toBe('wall-too-thin');
    expect(r.issues[0].suggestion).toContain('≥ 0.8');
  });

  it('accepts a 0.5mm shell for SLA (limit 0.4mm)', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'shell', params: { thickness_mm: 0.5 } }],
    };
    const r = runDfmGate(intent, 'sla');
    expect(r.issues.some(i => i.code === 'wall-too-thin')).toBe(false);
  });
});

describe('runDfmGate · hole diameter', () => {
  it('rejects 0.6mm hole for FDM (limit 1.0mm)', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'hole', params: { diameter_mm: 0.6 } }],
    };
    const r = runDfmGate(intent, 'fdm');
    expect(r.manufacturable).toBe(false);
    expect(r.issues[0].code).toBe('hole-too-small');
  });

  it('accepts 0.6mm hole for SLA (limit 0.5mm)', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'hole', params: { diameter_mm: 0.6 } }],
    };
    expect(runDfmGate(intent, 'sla').manufacturable).toBe(true);
  });
});

describe('runDfmGate · aspect ratio', () => {
  it('warns on a 100×10×10 box for FDM (10:1 > 8:1 limit)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 100, height_mm: 10, depth_mm: 10 },
    };
    const r = runDfmGate(intent, 'fdm');
    expect(r.issues.some(i => i.code === 'aspect-ratio-too-high')).toBe(true);
    expect(r.issues.every(i => i.severity === 'warning')).toBe(true);
    // Warning only → still manufacturable
    expect(r.manufacturable).toBe(true);
  });

  it('does not flag a moderate aspect ratio (5:1)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 10, depth_mm: 10 },
    };
    expect(runDfmGate(intent, 'fdm').issues.some(i => i.code === 'aspect-ratio-too-high')).toBe(false);
  });

  it('sheet metal tolerates very high aspect ratios (up to 100:1)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 200, height_mm: 5, depth_mm: 5 },
    };
    expect(runDfmGate(intent, 'sheetMetal').issues.some(i => i.code === 'aspect-ratio-too-high')).toBe(false);
  });
});

describe('runDfmGate · CNC internal radius', () => {
  it('warns when a CNC intent has no fillet feature', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'hole', params: { diameter_mm: 5 } }],
    };
    const r = runDfmGate(intent, 'cnc');
    expect(r.issues.some(i => i.code === 'no-internal-radius')).toBe(true);
  });

  it('does not warn when a fillet is present', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [{ type: 'fillet', params: { radius_mm: 1 } }],
    };
    expect(runDfmGate(intent, 'cnc').issues.some(i => i.code === 'no-internal-radius')).toBe(false);
  });

  it('does not warn for FDM (no internal-radius rule)', () => {
    const intent: IntentInput = { ...goodBox };
    expect(runDfmGate(intent, 'fdm').issues.some(i => i.code === 'no-internal-radius')).toBe(false);
  });
});

describe('runDfmGate · injection draft', () => {
  it('rejects an injection design without a draft feature', () => {
    const r = runDfmGate(goodBox, 'injection');
    expect(r.manufacturable).toBe(false);
    expect(r.issues.some(i => i.code === 'draft-required')).toBe(true);
  });

  it('accepts an injection design with a draft feature', () => {
    const intent: IntentInput = {
      ...goodBox,
      features: [
        { type: 'fillet', params: { radius_mm: 1 } },
        // 'draft' is not in the schema's allow-list yet; we use type
        // assertion to simulate what the agent would emit.
        ({ type: 'draft', params: { angle_deg: 1 } }) as never,
      ],
    };
    expect(runDfmGate(intent, 'injection').issues.some(i => i.code === 'draft-required')).toBe(false);
  });
});

describe('runDfmGateAllProcesses', () => {
  it('returns a report per process, manufacturable ones first', () => {
    const reports = runDfmGateAllProcesses(goodBox);
    expect(reports).toHaveLength(5);
    // The manufacturable ones (FDM/SLA/CNC/sheetMetal) should come before
    // the non-manufacturable one (injection, missing draft).
    const firstNon = reports.findIndex(r => !r.manufacturable);
    if (firstNon !== -1) {
      for (let i = firstNon + 1; i < reports.length; i++) {
        expect(reports[i].manufacturable).toBe(false);
      }
    }
  });

  it('reports each process exactly once', () => {
    const reports = runDfmGateAllProcesses(goodBox);
    const procs = new Set(reports.map(r => r.process));
    expect(procs.size).toBe(5);
  });
});
