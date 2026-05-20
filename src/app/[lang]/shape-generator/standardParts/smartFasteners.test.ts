import { describe, it, expect } from 'vitest';
import {
  findThreadSpec,
  tapDrillFor,
  counterBoreFor,
  counterSinkFor,
  autoFitFastener,
  generateWizardHole,
  THREAD_CATALOG,
} from './smartFasteners';

describe('findThreadSpec', () => {
  it('returns M5 spec', () => {
    const s = findThreadSpec('M5');
    expect(s).not.toBeNull();
    expect(s!.pitchMm).toBe(0.8);
    expect(s!.tapDrillMm).toBe(4.2);
  });

  it('returns null for unknown', () => {
    expect(findThreadSpec('M99')).toBeNull();
  });
});

describe('tapDrillFor', () => {
  it('75% engagement matches table default', () => {
    const s = findThreadSpec('M5')!;
    expect(tapDrillFor(s, 75)).toBeCloseTo(5 - 2 * 0.65 * 0.8 * 0.75, 3);
  });

  it('50% engagement → larger drill', () => {
    const s = findThreadSpec('M5')!;
    expect(tapDrillFor(s, 50)).toBeGreaterThan(tapDrillFor(s, 75));
  });

  it('100% engagement → smaller drill', () => {
    const s = findThreadSpec('M5')!;
    expect(tapDrillFor(s, 100)).toBeLessThan(tapDrillFor(s, 75));
  });
});

describe('counterBoreFor', () => {
  it('M5 socket cap → cBore ≈ 8.9mm', () => {
    const cb = counterBoreFor('M5', 'socket-cap', 10);
    expect(cb).not.toBeNull();
    expect(cb!.cBoreDiameterMm).toBeCloseTo(8.5 + 0.4, 2);
  });

  it('depth capped at 70% of plate thickness', () => {
    const cb = counterBoreFor('M5', 'socket-cap', 3);
    expect(cb!.cBoreDepthMm).toBeLessThanOrEqual(3 * 0.7);
  });

  it('returns null for unknown thread', () => {
    expect(counterBoreFor('M99', 'socket-cap', 10)).toBeNull();
  });
});

describe('counterSinkFor', () => {
  it('ISO → 90°', () => {
    const cs = counterSinkFor('M5', 'ISO');
    expect(cs!.angleDeg).toBe(90);
  });

  it('ANSI → 82°', () => {
    const cs = counterSinkFor('M5', 'ANSI');
    expect(cs!.angleDeg).toBe(82);
  });
});

describe('autoFitFastener', () => {
  it('returns full fit dimensions for M6 through 2 plates', () => {
    const r = autoFitFastener({
      threadId: 'M6',
      plateStackMm: [8, 10],
      threadedPlateMaterial: 'steel',
    });
    expect(r).not.toBeNull();
    expect(r!.clearanceHoleMm).toBe(6.6); // medium fit
    expect(r!.tapDrillMm).toBe(5.0);
    expect(r!.engagementMm).toBeCloseTo(6, 1); // ratio 1 × 6
    expect(r!.fastenerLengthMm).toBeGreaterThanOrEqual(14); // 8 + 6 = 14
  });

  it('aluminum requires more engagement', () => {
    const steel = autoFitFastener({ threadId: 'M6', plateStackMm: [5, 20], threadedPlateMaterial: 'steel' });
    const alu = autoFitFastener({ threadId: 'M6', plateStackMm: [5, 20], threadedPlateMaterial: 'aluminum' });
    expect(alu!.engagementMm).toBeGreaterThan(steel!.engagementMm);
  });

  it('warns when threaded plate too thin', () => {
    const r = autoFitFastener({ threadId: 'M10', plateStackMm: [3, 4], threadedPlateMaterial: 'steel' });
    expect(r!.warnings.some(w => w.includes('too thin'))).toBe(true);
  });

  it('flat-head triggers counterSink not counterBore', () => {
    const r = autoFitFastener({
      threadId: 'M5', plateStackMm: [10, 10],
      headStyle: 'flat-head',
    });
    expect(r!.counterSink).toBeDefined();
    expect(r!.counterBore).toBeUndefined();
  });

  it('socket-cap triggers counterBore', () => {
    const r = autoFitFastener({
      threadId: 'M5', plateStackMm: [10, 10],
      headStyle: 'socket-cap',
    });
    expect(r!.counterBore).toBeDefined();
    expect(r!.counterSink).toBeUndefined();
  });

  it('fastener length rounded to 5mm increment', () => {
    const r = autoFitFastener({ threadId: 'M6', plateStackMm: [5, 10] });
    expect(r!.fastenerLengthMm % 5).toBe(0);
  });

  it('fit class affects clearance hole', () => {
    const close = autoFitFastener({ threadId: 'M6', plateStackMm: [5, 10], fitClass: 'close' });
    const loose = autoFitFastener({ threadId: 'M6', plateStackMm: [5, 10], fitClass: 'loose' });
    expect(loose!.clearanceHoleMm).toBeGreaterThan(close!.clearanceHoleMm);
  });
});

describe('generateWizardHole', () => {
  it('tapped-blind hole uses tap drill', () => {
    const h = generateWizardHole({ holeType: 'tapped-blind', threadId: 'M5' }, 10);
    expect(h!.diameterMm).toBe(4.2);
    expect(h!.isTapped).toBe(true);
  });

  it('clearance-counterbore returns medium clearance', () => {
    const h = generateWizardHole({
      holeType: 'clearance-counterbore', threadId: 'M5', headStyle: 'socket-cap',
    }, 10);
    expect(h!.diameterMm).toBe(5.5);
    expect(h!.hasCounterFeature).toBe(true);
  });

  it('tapped-through uses plate thickness', () => {
    const h = generateWizardHole({ holeType: 'tapped-through', threadId: 'M6' }, 8);
    expect(h!.depthMm).toBe(8);
  });

  it('clearance-countersink emits counterSink dims', () => {
    const h = generateWizardHole({ holeType: 'clearance-countersink', threadId: 'M5' }, 10);
    expect(h!.counterSink).toBeDefined();
    expect(h!.counterSink!.angleDeg).toBe(90);
  });

  it('returns null for unknown thread', () => {
    expect(generateWizardHole({ holeType: 'simple-drilled', threadId: 'M99' }, 10)).toBeNull();
  });
});

describe('THREAD_CATALOG', () => {
  it('contains M3 through M12', () => {
    const ids = THREAD_CATALOG.map(s => s.id);
    expect(ids).toContain('M3');
    expect(ids).toContain('M12');
  });

  it('tap drill is monotonically smaller than nominal', () => {
    for (const s of THREAD_CATALOG) {
      expect(s.tapDrillMm).toBeLessThan(s.nominalMm);
    }
  });

  it('clearance fits ascending (close < medium < loose)', () => {
    for (const s of THREAD_CATALOG) {
      expect(s.clearanceCloseMm).toBeLessThanOrEqual(s.clearanceMediumMm);
      expect(s.clearanceMediumMm).toBeLessThanOrEqual(s.clearanceLooseMm);
    }
  });
});
