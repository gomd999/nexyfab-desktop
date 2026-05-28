/**
 * ksConventions.test.ts — Wave 2 Phase 2 Track D4 KS B 0001 datum label tests.
 *
 * Verifies the per-kind alphabet (planes: A/B/C, axes: A'/B'/C',
 * points: a/b/c, csys: [A]/[B]/[C]) and the `buildKsDatumLabels` walker
 * that scopes the running index per kind.
 */

import { describe, it, expect } from 'vitest';
import {
  KS_DATUM_LETTERS,
  buildKsDatumLabels,
  formatKsDatumDisplay,
  ksDatumLabel,
  ksDatumLetterForIndex,
  DEFAULT_USE_KS_CONVENTIONS,
} from '../ksConventions';
import type { ReferenceNode } from '../types';

function planeNode(id: string): ReferenceNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: [],
    params: { method: 'standard', id: 'front' },
  };
}

function axisNode(id: string): ReferenceNode {
  return {
    id,
    kind: 'axis',
    method: 'standard',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: [],
    params: { method: 'standard', id: 'x' },
  };
}

function pointNode(id: string): ReferenceNode {
  return {
    id,
    kind: 'point',
    method: 'byCoordinates',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: [],
    params: { method: 'byCoordinates', position: [0, 0, 0] },
  };
}

function csysNode(id: string): ReferenceNode {
  return {
    id,
    kind: 'csys',
    method: 'world',
    label: id,
    hidden: false,
    evaluatedAt: 0,
    dependsOn: [],
    params: { method: 'world' },
  };
}

describe('KS_DATUM_LETTERS alphabet', () => {
  it('starts with A through Z', () => {
    expect(KS_DATUM_LETTERS[0]).toBe('A');
    expect(KS_DATUM_LETTERS[25]).toBe('Z');
  });

  it('continues into double-letter overflow (AA, AB, ...) per KS A 0005', () => {
    expect(KS_DATUM_LETTERS[26]).toBe('AA');
    expect(KS_DATUM_LETTERS[27]).toBe('AB');
  });

  it('covers at least 700 datums (single + double letters)', () => {
    expect(KS_DATUM_LETTERS.length).toBeGreaterThanOrEqual(700);
  });
});

describe('ksDatumLetterForIndex per-kind decoration', () => {
  it('plane index 0,1,2 → A, B, C', () => {
    expect(ksDatumLetterForIndex('plane', 0)).toBe('A');
    expect(ksDatumLetterForIndex('plane', 1)).toBe('B');
    expect(ksDatumLetterForIndex('plane', 2)).toBe('C');
  });

  it("axis index 0,1,2 → A', B', C'", () => {
    expect(ksDatumLetterForIndex('axis', 0)).toBe("A'");
    expect(ksDatumLetterForIndex('axis', 1)).toBe("B'");
    expect(ksDatumLetterForIndex('axis', 2)).toBe("C'");
  });

  it('point index 0,1,2 → a, b, c (lower-case)', () => {
    expect(ksDatumLetterForIndex('point', 0)).toBe('a');
    expect(ksDatumLetterForIndex('point', 1)).toBe('b');
    expect(ksDatumLetterForIndex('point', 2)).toBe('c');
  });

  it('csys index 0,1,2 → [A], [B], [C]', () => {
    expect(ksDatumLetterForIndex('csys', 0)).toBe('[A]');
    expect(ksDatumLetterForIndex('csys', 1)).toBe('[B]');
    expect(ksDatumLetterForIndex('csys', 2)).toBe('[C]');
  });
});

describe('buildKsDatumLabels — per-kind running index', () => {
  it('assigns plane=A, axis=A\' even when both appear first', () => {
    const nodes: ReferenceNode[] = [planeNode('p1'), axisNode('a1')];
    const labels = buildKsDatumLabels(nodes);
    expect(labels.get('p1')).toBe('A');
    expect(labels.get('a1')).toBe("A'");
  });

  it('mixed list scopes the index per kind (not global)', () => {
    const nodes: ReferenceNode[] = [
      planeNode('p1'),
      axisNode('a1'),
      planeNode('p2'),
      pointNode('pt1'),
      csysNode('c1'),
      axisNode('a2'),
      planeNode('p3'),
    ];
    const labels = buildKsDatumLabels(nodes);
    expect(labels.get('p1')).toBe('A');
    expect(labels.get('p2')).toBe('B');
    expect(labels.get('p3')).toBe('C');
    expect(labels.get('a1')).toBe("A'");
    expect(labels.get('a2')).toBe("B'");
    expect(labels.get('pt1')).toBe('a');
    expect(labels.get('c1')).toBe('[A]');
  });

  it('returns an empty map for an empty node list', () => {
    expect(buildKsDatumLabels([]).size).toBe(0);
  });
});

describe('ksDatumLabel(node, orderedNodes) one-shot lookup', () => {
  it('matches the buildKsDatumLabels assignment', () => {
    const p1 = planeNode('p1');
    const p2 = planeNode('p2');
    const a1 = axisNode('a1');
    const nodes = [p1, a1, p2];
    expect(ksDatumLabel(p1, nodes)).toBe('A');
    expect(ksDatumLabel(p2, nodes)).toBe('B');
    expect(ksDatumLabel(a1, nodes)).toBe("A'");
  });

  it('returns null when the node is not in the list', () => {
    const ghost = planeNode('ghost');
    expect(ksDatumLabel(ghost, [planeNode('p1')])).toBe(null);
  });
});

describe('formatKsDatumDisplay', () => {
  it('prefixes the letter with " · " separator when present', () => {
    expect(formatKsDatumDisplay('A', 'Offset Plane 1')).toBe('A · Offset Plane 1');
    expect(formatKsDatumDisplay("B'", 'Axis edge')).toBe("B' · Axis edge");
  });

  it('returns the label alone when ksLetter is null/empty', () => {
    expect(formatKsDatumDisplay(null, 'Offset Plane')).toBe('Offset Plane');
    expect(formatKsDatumDisplay('', 'Offset Plane')).toBe('Offset Plane');
    expect(formatKsDatumDisplay(undefined, 'Offset Plane')).toBe('Offset Plane');
  });
});

describe('DEFAULT_USE_KS_CONVENTIONS', () => {
  it('defaults to true (Korean-market default)', () => {
    expect(DEFAULT_USE_KS_CONVENTIONS).toBe(true);
  });
});
