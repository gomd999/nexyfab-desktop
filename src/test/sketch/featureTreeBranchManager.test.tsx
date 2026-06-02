/** @vitest-environment jsdom */
/**
 * FeatureTreeBranchManager — UI surface for featureTreeOps (clone / merge /
 * diff). Verifies storage layout, the 5 row actions, and the 20-branch
 * eviction cap.
 *
 * Coverage matrix:
 *   - empty list shows "No branches saved"
 *   - save adds a row + persists to localStorage (index + blob)
 *   - load fires onLoadTree with the deserialized branch
 *   - diff toggles a +N -N ~N preview keyed off counts
 *   - merge fires onLoadTree with mergeTrees output (default 'suffix')
 *   - merge reports remap count when ids collide
 *   - delete drops the row, the blob, and updates the index
 *   - 20-branch cap → oldest is evicted on save
 *   - rename moves the blob to the new key and refreshes the index
 *   - 6-lang i18n smoke (each lang's empty-state copy)
 *   - corrupt branch surfaces an error status
 *   - duplicate name on save is rejected
 *   - empty name on save is rejected
 *   - reading pre-existing branches on mount (hydration)
 *   - storageKeyPrefix swap re-reads index
 *   - diff toggle off
 *   - rename to existing name is rejected
 *   - rename cancel restores original
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import FeatureTreeBranchManager, {
  MAX_BRANCHES,
} from '@/app/[lang]/shape-generator/sketch/FeatureTreeBranchManager';
import {
  serializeFeatureTree,
} from '@/lib/cad/featureTreePersist';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';

// ─── fixtures ────────────────────────────────────────────────────────────

function makeExtrudePayload() {
  // Minimal extrude payload — matches the required fields in
  // featureTreePersist.validatePayload (loop / depth / direction / mode).
  return {
    kind: 'extrude' as const,
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    depth: 5,
    direction: 'one_sided' as const,
    mode: 'add' as const,
  };
}

function makeNode(id: string, name?: string, deps: string[] = []): FeatureNode {
  return {
    id,
    name: name ?? id,
    dependencies: deps,
    payload: makeExtrudePayload() as unknown as FeatureNode['payload'],
  };
}

function makeTree(nodes: FeatureNode[]): FeatureTree {
  return { nodes };
}

const PREFIX = 'test:bm';

function seedBranch(name: string, tree: FeatureTree, prefix = PREFIX): void {
  const idx = JSON.parse(window.localStorage.getItem(`${prefix}:_index`) ?? '[]');
  if (!idx.includes(name)) idx.push(name);
  window.localStorage.setItem(`${prefix}:_index`, JSON.stringify(idx));
  window.localStorage.setItem(`${prefix}:${name}`, serializeFeatureTree(tree));
}

beforeEach(() => {
  window.localStorage.clear();
});

// ─── tests ────────────────────────────────────────────────────────────────

describe('FeatureTreeBranchManager', () => {
  it('empty list → shows "No branches saved"', () => {
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    expect(screen.getByTestId('branch-manager-panel')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-empty').textContent).toMatch(/No branches/);
    expect(screen.getByTestId('branch-manager-count').textContent).toBe(`0/${MAX_BRANCHES}`);
  });

  it('save current as branch → +1 row + persisted to localStorage', () => {
    const tree = makeTree([makeNode('a'), makeNode('b')]);
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={tree}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'wip-1' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));

    expect(screen.getByTestId('branch-manager-row-wip-1')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-count').textContent).toBe(`1/${MAX_BRANCHES}`);

    // localStorage now has both the blob and the index.
    expect(window.localStorage.getItem(`${PREFIX}:wip-1`)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(`${PREFIX}:_index`)!)).toEqual(['wip-1']);
    // input cleared after save.
    expect((screen.getByTestId('branch-manager-new-name') as HTMLInputElement).value).toBe('');
  });

  it('load → fires onLoadTree with the persisted tree', () => {
    const tree = makeTree([makeNode('a'), makeNode('b')]);
    seedBranch('saved-1', tree);
    const onLoad = vi.fn();
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={onLoad}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-saved-1-load'));
    expect(onLoad).toHaveBeenCalledTimes(1);
    const [received] = onLoad.mock.calls[0] as [FeatureTree];
    expect(received.nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('diff → shows added / removed / modified counts', () => {
    // branch has [a, b]; current has [a, c] → added=1 (c), removed=1 (b), modified=0
    const branchTree = makeTree([makeNode('a'), makeNode('b')]);
    seedBranch('feature-x', branchTree);
    const currentTree = makeTree([makeNode('a'), makeNode('c')]);
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={currentTree}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-feature-x-diff'));
    const diffEl = screen.getByTestId('branch-manager-row-feature-x-diff-result');
    expect(diffEl.getAttribute('data-added')).toBe('1');
    expect(diffEl.getAttribute('data-removed')).toBe('1');
    expect(diffEl.getAttribute('data-modified')).toBe('0');
    expect(diffEl.getAttribute('data-unchanged')).toBe('1');
    expect(diffEl.textContent).toContain('+1');
    expect(diffEl.textContent).toContain('-1');
  });

  it('diff → clicking again toggles the preview off', () => {
    seedBranch('toggleme', makeTree([makeNode('a')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([makeNode('a')])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    const btn = screen.getByTestId('branch-manager-row-toggleme-diff');
    fireEvent.click(btn);
    expect(screen.getByTestId('branch-manager-row-toggleme-diff-result')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByTestId('branch-manager-row-toggleme-diff-result')).not.toBeInTheDocument();
  });

  it('merge → fires onLoadTree with the merged tree (no collisions → no remap)', () => {
    const branchTree = makeTree([makeNode('b1'), makeNode('b2')]);
    seedBranch('feature-y', branchTree);
    const currentTree = makeTree([makeNode('c1')]);
    const onLoad = vi.fn();
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={currentTree}
        onLoadTree={onLoad}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-feature-y-merge'));
    expect(onLoad).toHaveBeenCalledTimes(1);
    const [received] = onLoad.mock.calls[0] as [FeatureTree];
    expect(received.nodes.map((n) => n.id).sort()).toEqual(['b1', 'b2', 'c1']);
    expect(screen.getByTestId('branch-manager-status').textContent).toMatch(/Merged/);
  });

  it('merge with id collision → status reports remapped count', () => {
    // both trees share 'a'; suffix strategy renames the branch's 'a' to 'a__2'
    const branchTree = makeTree([makeNode('a'), makeNode('b')]);
    seedBranch('collider', branchTree);
    const currentTree = makeTree([makeNode('a'), makeNode('c')]);
    const onLoad = vi.fn();
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={currentTree}
        onLoadTree={onLoad}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-collider-merge'));
    const [received] = onLoad.mock.calls[0] as [FeatureTree];
    // current's 'a' + 'c' kept; branch's 'a' renamed; branch's 'b' kept.
    const ids = received.nodes.map((n) => n.id);
    expect(ids).toContain('a');
    expect(ids).toContain('c');
    expect(ids).toContain('a__2');
    expect(ids).toContain('b');
    expect(screen.getByTestId('branch-manager-status').textContent).toMatch(/1/);
  });

  it('delete → row removed + localStorage cleaned', () => {
    seedBranch('to-delete', makeTree([makeNode('a')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    expect(screen.getByTestId('branch-manager-row-to-delete')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('branch-manager-row-to-delete-delete'));
    expect(screen.queryByTestId('branch-manager-row-to-delete')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(`${PREFIX}:to-delete`)).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(`${PREFIX}:_index`)!)).toEqual([]);
  });

  it('max 20 branches → oldest is evicted on the 21st save', () => {
    // Pre-seed the cap.
    for (let i = 0; i < MAX_BRANCHES; i++) {
      seedBranch(`b${i}`, makeTree([makeNode(`n${i}`)]));
    }
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([makeNode('new')])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    expect(screen.getByTestId('branch-manager-count').textContent).toBe(
      `${MAX_BRANCHES}/${MAX_BRANCHES}`,
    );
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'fresh' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));

    // 'b0' (oldest) gone, 'fresh' (newest) added.
    expect(screen.queryByTestId('branch-manager-row-b0')).not.toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-row-fresh')).toBeInTheDocument();
    expect(window.localStorage.getItem(`${PREFIX}:b0`)).toBeNull();
    expect(window.localStorage.getItem(`${PREFIX}:fresh`)).toBeTruthy();
    expect(screen.getByTestId('branch-manager-status').textContent).toMatch(/b0/);
  });

  it('rename → blob moves to new key + index updated', () => {
    seedBranch('old-name', makeTree([makeNode('a')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    // Click name to enter rename mode.
    fireEvent.click(screen.getByTestId('branch-manager-row-old-name-name'));
    const input = screen.getByTestId('branch-manager-row-old-name-name-input') as HTMLInputElement;
    expect(input.value).toBe('old-name');
    fireEvent.change(input, { target: { value: 'new-name' } });
    fireEvent.click(screen.getByTestId('branch-manager-row-old-name-rename-confirm'));

    expect(screen.queryByTestId('branch-manager-row-old-name')).not.toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-row-new-name')).toBeInTheDocument();
    expect(window.localStorage.getItem(`${PREFIX}:old-name`)).toBeNull();
    expect(window.localStorage.getItem(`${PREFIX}:new-name`)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(`${PREFIX}:_index`)!)).toEqual(['new-name']);
  });

  it('rename to existing name → rejected with duplicate error', () => {
    seedBranch('alpha', makeTree([makeNode('a')]));
    seedBranch('beta', makeTree([makeNode('b')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-alpha-name'));
    fireEvent.change(
      screen.getByTestId('branch-manager-row-alpha-name-input'),
      { target: { value: 'beta' } },
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-alpha-rename-confirm'));

    // Both branches still under their original keys.
    expect(screen.getByTestId('branch-manager-row-alpha')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-row-beta')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-status').getAttribute('data-status-kind')).toBe('error');
  });

  it.each([
    ['ko', /브랜치/, /저장된/],
    ['en', /Branches/, /No branches/],
    ['ja', /ブランチ/, /保存/],
    ['zh', /分支/, /分支/],
    ['es', /Ramas/, /ramas/],
    ['ar', /الفروع/, /فروع/],
  ] as const)('lang=%s renders localized header + empty copy', (lang, headerRe, emptyRe) => {
    render(
      <FeatureTreeBranchManager
        lang={lang}
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    expect(screen.getByTestId('branch-manager-header').textContent ?? '').toMatch(headerRe);
    expect(screen.getByTestId('branch-manager-empty').textContent ?? '').toMatch(emptyRe);
  });

  it('save with empty name → error status', () => {
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([makeNode('a')])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-save'));
    const status = screen.getByTestId('branch-manager-status');
    expect(status.getAttribute('data-status-kind')).toBe('error');
    expect(status.textContent).toMatch(/name/i);
    expect(screen.getByTestId('branch-manager-empty')).toBeInTheDocument();
  });

  it('save with duplicate name → error status, no new row', () => {
    seedBranch('dup', makeTree([makeNode('a')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([makeNode('a')])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.change(screen.getByTestId('branch-manager-new-name'), {
      target: { value: 'dup' },
    });
    fireEvent.click(screen.getByTestId('branch-manager-save'));
    expect(screen.getByTestId('branch-manager-status').getAttribute('data-status-kind')).toBe('error');
    expect(screen.getByTestId('branch-manager-count').textContent).toBe(`1/${MAX_BRANCHES}`);
  });

  it('pre-existing branches → hydrated on mount', () => {
    seedBranch('hydrate-1', makeTree([makeNode('a')]));
    seedBranch('hydrate-2', makeTree([makeNode('b')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    expect(screen.getByTestId('branch-manager-row-hydrate-1')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-row-hydrate-2')).toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-count').textContent).toBe(`2/${MAX_BRANCHES}`);
  });

  it('corrupt branch → load surfaces error status', () => {
    // Seed index but write garbage blob.
    window.localStorage.setItem(`${PREFIX}:_index`, JSON.stringify(['broken']));
    window.localStorage.setItem(`${PREFIX}:broken`, '{not json');
    const onLoad = vi.fn();
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={onLoad}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-broken-load'));
    expect(onLoad).not.toHaveBeenCalled();
    expect(screen.getByTestId('branch-manager-status').getAttribute('data-status-kind')).toBe('error');
  });

  it('rename cancel → restores original name without writing', () => {
    seedBranch('keepme', makeTree([makeNode('a')]));
    render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix={PREFIX}
      />,
    );
    fireEvent.click(screen.getByTestId('branch-manager-row-keepme-name'));
    fireEvent.change(
      screen.getByTestId('branch-manager-row-keepme-name-input'),
      { target: { value: 'should-not-stick' } },
    );
    // Cancel button (only one Cancel under this row).
    const cancelBtn = screen
      .getByTestId('branch-manager-row-keepme')
      .querySelector('button[aria-label="Cancel"]');
    expect(cancelBtn).not.toBeNull();
    fireEvent.click(cancelBtn!);

    expect(screen.getByTestId('branch-manager-row-keepme')).toBeInTheDocument();
    expect(window.localStorage.getItem(`${PREFIX}:keepme`)).toBeTruthy();
    expect(window.localStorage.getItem(`${PREFIX}:should-not-stick`)).toBeNull();
  });

  it('storageKeyPrefix swap → re-reads index from new scope', () => {
    seedBranch('scope-a', makeTree([makeNode('a')]), 'test:scope-a');
    seedBranch('scope-b', makeTree([makeNode('b')]), 'test:scope-b');
    const { rerender } = render(
      <FeatureTreeBranchManager
        lang="en"
        currentTree={makeTree([])}
        onLoadTree={vi.fn()}
        storageKeyPrefix="test:scope-a"
      />,
    );
    expect(screen.getByTestId('branch-manager-row-scope-a')).toBeInTheDocument();
    expect(screen.queryByTestId('branch-manager-row-scope-b')).not.toBeInTheDocument();

    act(() => {
      rerender(
        <FeatureTreeBranchManager
          lang="en"
          currentTree={makeTree([])}
          onLoadTree={vi.fn()}
          storageKeyPrefix="test:scope-b"
        />,
      );
    });
    expect(screen.queryByTestId('branch-manager-row-scope-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('branch-manager-row-scope-b')).toBeInTheDocument();
  });
});
