import { describe, it, expect } from 'vitest';
import {
  runChecklist,
  failedBySeverity,
  runChecklistWithCustom,
  summarize,
  type ModelFeature,
  type PmiAnnotation,
} from './pmiReviewChecklist';

function feat(id: string, kind: ModelFeature['kind'], functional: boolean = false, ctf: boolean = false): ModelFeature {
  return { id, kind, isFunctional: functional, isCTF: ctf };
}

function annot(id: string, kind: PmiAnnotation['kind'], text: string, featureId?: string, ctf?: boolean): PmiAnnotation {
  const a: PmiAnnotation = { id, kind, text };
  if (featureId !== undefined) a.featureId = featureId;
  if (ctf !== undefined) a.ctf = ctf;
  return a;
}

describe('runChecklist', () => {
  it('empty inputs → low score', () => {
    const r = runChecklist([], []);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.scorePct).toBeGreaterThanOrEqual(0);
  });

  it('CHK-1 passes with global Ra note', () => {
    const r = runChecklist(
      [feat('s1', 'plane', true)],
      [annot('n1', 'note', 'All surfaces Ra 3.2 unless noted')],
    );
    const chk1 = r.items.find(i => i.id === 'CHK-1')!;
    expect(chk1.passed).toBe(true);
  });

  it('CHK-1 passes with per-surface callouts', () => {
    const r = runChecklist(
      [feat('s1', 'plane', true), feat('s2', 'plane', true)],
      [annot('a1', 'surface-finish', 'Ra 1.6', 's1'), annot('a2', 'surface-finish', 'Ra 0.8', 's2')],
    );
    expect(r.items.find(i => i.id === 'CHK-1')!.passed).toBe(true);
  });

  it('CHK-2 fails on duplicate datum', () => {
    const r = runChecklist(
      [feat('s1', 'plane')],
      [annot('d1', 'datum', 'A', 's1'), annot('d2', 'datum', 'A', 's1')],
    );
    expect(r.items.find(i => i.id === 'CHK-2')!.passed).toBe(false);
  });

  it('CHK-3 fails when cylinder dim missing Ø', () => {
    const r = runChecklist(
      [feat('c1', 'cylinder')],
      [annot('d1', 'dimension', '10', 'c1')],
    );
    expect(r.items.find(i => i.id === 'CHK-3')!.passed).toBe(false);
  });

  it('CHK-3 passes with Ø prefix', () => {
    const r = runChecklist(
      [feat('c1', 'cylinder')],
      [annot('d1', 'dimension', 'Ø10', 'c1')],
    );
    expect(r.items.find(i => i.id === 'CHK-3')!.passed).toBe(true);
  });

  it('CHK-4 fails for CTF without GD&T', () => {
    const r = runChecklist([feat('s1', 'plane', true, true)], []);
    expect(r.items.find(i => i.id === 'CHK-4')!.passed).toBe(false);
  });

  it('CHK-4 passes when CTF has GD&T', () => {
    const r = runChecklist(
      [feat('s1', 'plane', true, true)],
      [annot('g1', 'gdt', 'position Ø0.1 A B C', 's1')],
    );
    expect(r.items.find(i => i.id === 'CHK-4')!.passed).toBe(true);
  });

  it('CHK-6 fails when position FCF missing Ø', () => {
    const r = runChecklist(
      [feat('h1', 'hole', true, true)],
      [annot('g1', 'gdt', 'position 0.1 A B C', 'h1')],
    );
    expect(r.items.find(i => i.id === 'CHK-6')!.passed).toBe(false);
  });

  it('CHK-5 fails on excessive TYP notes', () => {
    const annotations: PmiAnnotation[] = [];
    for (let i = 0; i < 10; i++) annotations.push(annot(`n${i}`, 'note', `TYP ${i}`));
    const r = runChecklist([], annotations);
    expect(r.items.find(i => i.id === 'CHK-5')!.passed).toBe(false);
  });

  it('scorePct between 0 and 100', () => {
    const r = runChecklist([], []);
    expect(r.scorePct).toBeGreaterThanOrEqual(0);
    expect(r.scorePct).toBeLessThanOrEqual(100);
  });
});

describe('failedBySeverity', () => {
  it('critical first', () => {
    const r = runChecklist(
      [feat('s1', 'plane', true, true), feat('c1', 'cylinder')],
      [annot('d1', 'datum', 'A', 's1'), annot('d2', 'datum', 'A', 's1'), annot('dim', 'dimension', '10', 'c1')],
    );
    const failed = failedBySeverity(r);
    if (failed.length >= 2) {
      const sevOrder: Record<string, number> = { critical: 0, major: 1, minor: 2 };
      for (let i = 1; i < failed.length; i++) {
        expect(sevOrder[failed[i]!.severity]!).toBeGreaterThanOrEqual(sevOrder[failed[i - 1]!.severity]!);
      }
    }
  });
});

describe('runChecklistWithCustom', () => {
  it('custom check appended', () => {
    const r = runChecklistWithCustom([], [], [{
      id: 'CUST-1', title: 'Custom rule', severity: 'minor',
      evaluate: () => ({ passed: true }),
    }]);
    expect(r.items.some(i => i.id === 'CUST-1')).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = runChecklist([], []);
    const s = summarize(r);
    expect(s.totalChecks).toBe(r.items.length);
    expect(s.passedCount + s.failedCount).toBe(r.items.length);
  });
});
