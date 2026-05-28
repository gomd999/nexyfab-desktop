/**
 * branchTypes.test.ts — Wave 2 Phase 3 Z6.
 *
 * Pure-type / pure-helper cases. The bulk of branching coverage lives in
 * the registry + store + hook tests; this file just nails down the
 * predicates and the empty-state shape.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_BRANCH_REGISTRY,
  isRootBranch,
  sameParent,
  type BranchRef,
} from '../branchTypes';

function makeRef(overrides: Partial<BranchRef> = {}): BranchRef {
  return {
    id: 'b1',
    name: 'main',
    parentDocId: 'doc-1',
    parentBranchId: null,
    forkedFromBranchHead: '',
    createdAt: 1_700_000_000_000,
    createdBy: 'peer-alpha',
    ...overrides,
  };
}

describe('branchTypes — EMPTY_BRANCH_REGISTRY', () => {
  it('has empty branches and activeBranchByDoc records', () => {
    expect(EMPTY_BRANCH_REGISTRY.branches).toEqual({});
    expect(EMPTY_BRANCH_REGISTRY.activeBranchByDoc).toEqual({});
  });

  it('is deeply frozen so callers can\'t mutate by accident', () => {
    expect(Object.isFrozen(EMPTY_BRANCH_REGISTRY)).toBe(true);
    expect(Object.isFrozen(EMPTY_BRANCH_REGISTRY.branches)).toBe(true);
    expect(Object.isFrozen(EMPTY_BRANCH_REGISTRY.activeBranchByDoc)).toBe(true);
  });
});

describe('branchTypes — isRootBranch', () => {
  it('returns true for null parentBranchId', () => {
    expect(isRootBranch(makeRef({ parentBranchId: null }))).toBe(true);
  });

  it('returns false for any non-null parent', () => {
    expect(isRootBranch(makeRef({ parentBranchId: 'b-other' }))).toBe(false);
  });

  it('treats empty-string parent id as non-root (defensive)', () => {
    // Empty string is technically truthy-by-id; the type system says
    // string|null. We treat anything not-null as a parent ref.
    expect(isRootBranch(makeRef({ parentBranchId: '' }))).toBe(false);
  });
});

describe('branchTypes — sameParent', () => {
  it('two roots share parentBranchId = null', () => {
    const a = makeRef({ id: 'b1', parentBranchId: null });
    const b = makeRef({ id: 'b2', parentBranchId: null });
    expect(sameParent(a, b)).toBe(true);
  });

  it('two children of the same parent return true', () => {
    const a = makeRef({ id: 'b1', parentBranchId: 'main' });
    const b = makeRef({ id: 'b2', parentBranchId: 'main' });
    expect(sameParent(a, b)).toBe(true);
  });

  it('different parents return false', () => {
    const a = makeRef({ id: 'b1', parentBranchId: 'main' });
    const b = makeRef({ id: 'b2', parentBranchId: 'experiment' });
    expect(sameParent(a, b)).toBe(false);
  });

  it('root vs child returns false', () => {
    const root = makeRef({ id: 'b1', parentBranchId: null });
    const child = makeRef({ id: 'b2', parentBranchId: 'main' });
    expect(sameParent(root, child)).toBe(false);
  });
});

describe('branchTypes — BranchRef shape', () => {
  it('description is optional', () => {
    const ref = makeRef();
    expect(ref.description).toBeUndefined();
  });

  it('description can be provided', () => {
    const ref = makeRef({ description: 'For testing draft fillets' });
    expect(ref.description).toBe('For testing draft fillets');
  });

  it('forkedFromBranchHead is a plain string (may be empty)', () => {
    expect(makeRef({ forkedFromBranchHead: '' }).forkedFromBranchHead).toBe('');
    expect(makeRef({ forkedFromBranchHead: 'abcdef1234567890' }).forkedFromBranchHead)
      .toBe('abcdef1234567890');
  });
});
