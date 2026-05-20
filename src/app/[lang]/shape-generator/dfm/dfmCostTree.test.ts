import { describe, it, expect } from 'vitest';
import {
  buildCostTree,
  findNode,
  flattenLeaves,
  summarize,
  type DFMIssue,
} from './dfmCostTree';

function issue(id: string, family: string, category: string, cost: number, severity: DFMIssue['severity'] = 'warning'): DFMIssue {
  return { id, operationFamily: family, category, feature: id, costImpactUsd: cost, severity, fix: 'fix this' };
}

describe('buildCostTree', () => {
  it('empty input → empty tree', () => {
    const r = buildCostTree([]);
    expect(r.root.children).toEqual([]);
    expect(r.totalSavingsUsd).toBe(0);
  });

  it('groups issues by family and category', () => {
    const issues = [
      issue('i1', 'machining', 'tight-tolerance', 20),
      issue('i2', 'machining', 'tight-tolerance', 15),
      issue('i3', 'machining', 'small-feature', 5),
      issue('i4', 'casting', 'sharp-corner', 10),
    ];
    const r = buildCostTree(issues);
    expect(r.root.children).toHaveLength(2);
    const machining = r.root.children.find(c => c.label === 'machining');
    expect(machining!.children).toHaveLength(2);
  });

  it('cost rolls up to parent nodes', () => {
    const issues = [
      issue('i1', 'machining', 'tight-tolerance', 20),
      issue('i2', 'machining', 'tight-tolerance', 15),
    ];
    const r = buildCostTree(issues);
    expect(r.root.children[0]!.costRollupUsd).toBe(35);
    expect(r.root.costRollupUsd).toBe(35);
  });

  it('worst severity propagates up', () => {
    const issues = [
      issue('i1', 'machining', 'tight-tol', 5, 'info'),
      issue('i2', 'machining', 'tight-tol', 10, 'critical'),
    ];
    const r = buildCostTree(issues);
    expect(r.root.worstSeverity).toBe('critical');
  });

  it('topFixes ordered by cost desc', () => {
    const issues = [
      issue('cheap', 'm', 'a', 1),
      issue('expensive', 'm', 'b', 100),
      issue('mid', 'm', 'c', 50),
    ];
    const r = buildCostTree(issues);
    expect(r.topFixes[0]!.id).toBe('expensive');
    expect(r.topFixes[1]!.id).toBe('mid');
  });

  it('topN limit respected', () => {
    const issues = Array.from({ length: 20 }, (_, i) => issue(`i${i}`, 'm', 'c', i + 1));
    const r = buildCostTree(issues, { topN: 5 });
    expect(r.topFixes).toHaveLength(5);
  });

  it('families sorted by cost desc', () => {
    const issues = [
      issue('a', 'small-family', 'c', 10),
      issue('b', 'big-family', 'c', 100),
    ];
    const r = buildCostTree(issues);
    expect(r.root.children[0]!.label).toBe('big-family');
  });

  it('total savings = sum of all issues', () => {
    const issues = [issue('a', 'f', 'c', 10), issue('b', 'f', 'c', 20)];
    const r = buildCostTree(issues);
    expect(r.totalSavingsUsd).toBe(30);
  });
});

describe('findNode', () => {
  it('finds root by id /', () => {
    const r = buildCostTree([issue('i', 'm', 'c', 1)]);
    expect(findNode(r.root, '/')).not.toBeNull();
  });

  it('finds nested category', () => {
    const r = buildCostTree([issue('i', 'machining', 'small', 1)]);
    expect(findNode(r.root, 'machining/small')).not.toBeNull();
  });

  it('returns null for unknown id', () => {
    const r = buildCostTree([issue('i', 'm', 'c', 1)]);
    expect(findNode(r.root, 'ghost')).toBeNull();
  });
});

describe('flattenLeaves', () => {
  it('returns all issues', () => {
    const issues = [issue('a', 'f', 'c', 1), issue('b', 'f', 'd', 2)];
    const r = buildCostTree(issues);
    const flat = flattenLeaves(r.root);
    expect(flat).toHaveLength(2);
  });

  it('empty tree → empty', () => {
    const r = buildCostTree([]);
    expect(flattenLeaves(r.root)).toEqual([]);
  });
});

describe('summarize', () => {
  it('empty tree summary', () => {
    const s = summarize(buildCostTree([]));
    expect(s.issueCount).toBe(0);
    expect(s.familyCount).toBe(0);
  });

  it('counts families + categories', () => {
    const issues = [
      issue('i1', 'machining', 'tol', 5),
      issue('i2', 'machining', 'feat', 5),
      issue('i3', 'casting', 'corner', 5),
    ];
    const s = summarize(buildCostTree(issues));
    expect(s.familyCount).toBe(2);
    expect(s.categoryCount).toBe(3);
  });

  it('topFixCount matches topN', () => {
    const issues = Array.from({ length: 5 }, (_, i) => issue(`i${i}`, 'm', 'c', i + 1));
    const s = summarize(buildCostTree(issues, { topN: 3 }));
    expect(s.topFixCount).toBe(3);
  });
});
