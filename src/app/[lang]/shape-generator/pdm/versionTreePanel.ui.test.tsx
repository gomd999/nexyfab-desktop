// @vitest-environment jsdom

/**
 * versionTreePanel.ui.test.tsx — Wave 6 Track W6-D.
 *
 * jsdom proof that VersionTreePanel consumes REAL session PDM state:
 *  - empty state ("no commits") with NO auto-seeded demo data
 *  - first commit is recorded from the live shell-bridge feature snapshot
 *  - demo history is opt-in and visibly labeled as sample data
 *  - merge UI consumes mergeFeatures/resolveConflict end-to-end for at
 *    least 2 of the 5 conflict kinds (modify-modify, delete-modify)
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuthStore: (sel: (s: { user: { name: string; email: string } }) => unknown) =>
    sel({ user: { name: 'tester', email: 'tester@example.com' } }),
}));

import { VersionTreePanel } from '../_shell/VersionTreePanel';
import { useShellBridge } from '../_shell/shellBridgeStore';
import { usePdmSessionStore } from './sessionRepoStore';
import type { FeatureInstance } from '../features/types';

const f = (id: string, params: Record<string, number> = {}): FeatureInstance => ({
  id, type: 'fillet', params, enabled: true,
});

beforeEach(() => {
  usePdmSessionStore.setState({ repo: null, rev: 0, isDemo: false, pendingMerge: null });
  useShellBridge.setState({ featureItems: [], selectedFeatureId: null });
});

afterEach(() => cleanup());

describe('VersionTreePanel — real-data empty state', () => {
  it('renders "No commits" empty state with zero graph nodes (no demo seed)', () => {
    render(<VersionTreePanel isKo={false} />);
    expect(screen.getByTestId('pdm-empty')).toBeTruthy();
    expect(screen.getByText('No commits')).toBeTruthy();
    expect(screen.queryAllByTestId('pdm-graph-node')).toHaveLength(0);
    expect(screen.queryByTestId('pdm-demo-banner')).toBeNull();
  });

  it('records the first commit from the REAL shell-bridge feature snapshot', () => {
    useShellBridge.setState({
      featureItems: [
        { id: 'feat-1', label: 'Extrude 1', type: 'sketchExtrude', params: { depth: 12 } },
        { id: 'feat-2', label: 'Fillet 1', type: 'fillet', params: { radius: 2 }, muted: true },
      ],
      selectedFeatureId: null,
    });
    render(<VersionTreePanel isKo={false} />);
    fireEvent.click(screen.getByTestId('pdm-init-btn'));

    // Graph now shows the root commit; the repo holds the adapted snapshot.
    expect(screen.getAllByTestId('pdm-graph-node')).toHaveLength(1);
    const repo = usePdmSessionStore.getState().repo!;
    const root = repo.current().commit;
    expect(root.features.map(x => x.id)).toEqual(['feat-1', 'feat-2']);
    expect(root.features[0]!.params.depth).toBe(12);
    expect(root.features[1]!.enabled).toBe(false); // muted → disabled
    expect(usePdmSessionStore.getState().isDemo).toBe(false);
    expect(screen.queryByTestId('pdm-demo-banner')).toBeNull();
  });

  it('demo history is opt-in and shows the sample-data banner; exit returns to empty', () => {
    render(<VersionTreePanel isKo={false} />);
    const demoBtn = screen.getByTestId('pdm-demo-btn');
    expect(demoBtn.textContent).toContain('not real data');
    fireEvent.click(demoBtn);

    expect(screen.getByTestId('pdm-demo-banner').textContent).toContain('not your real project history');
    expect(screen.getAllByTestId('pdm-graph-node').length).toBeGreaterThanOrEqual(4);

    fireEvent.click(screen.getByTestId('pdm-demo-exit'));
    expect(screen.getByTestId('pdm-empty')).toBeTruthy();
  });
});

describe('VersionTreePanel — commit & branch controls', () => {
  it('commits the current live snapshot with the typed message', () => {
    useShellBridge.setState({
      featureItems: [{ id: 'feat-1', label: 'Extrude 1', type: 'sketchExtrude', params: { depth: 12 } }],
      selectedFeatureId: null,
    });
    render(<VersionTreePanel isKo={false} />);
    fireEvent.click(screen.getByTestId('pdm-init-btn'));

    // Model evolves → bridge publishes a new snapshot.
    useShellBridge.setState({
      featureItems: [
        { id: 'feat-1', label: 'Extrude 1', type: 'sketchExtrude', params: { depth: 20 } },
        { id: 'feat-3', label: 'Shell 1', type: 'shell', params: { thickness: 1.5 } },
      ],
      selectedFeatureId: null,
    });
    fireEvent.change(screen.getByTestId('pdm-commit-msg'), { target: { value: 'deeper + shell' } });
    fireEvent.click(screen.getByTestId('pdm-commit-btn'));

    expect(screen.getAllByTestId('pdm-graph-node')).toHaveLength(2);
    const head = usePdmSessionStore.getState().repo!.current().commit;
    expect(head.message).toBe('deeper + shell');
    expect(head.authorUserId).toBe('tester');
    expect(head.features.find(x => x.id === 'feat-1')?.params.depth).toBe(20);
  });

  it('creates + checks out a branch from the UI', () => {
    render(<VersionTreePanel isKo={false} />);
    fireEvent.click(screen.getByTestId('pdm-init-btn'));
    fireEvent.change(screen.getByTestId('pdm-branch-name'), { target: { value: 'variant-a' } });
    fireEvent.click(screen.getByTestId('pdm-branch-btn'));
    expect(usePdmSessionStore.getState().repo!.current().branchName).toBe('variant-a');
    const select = screen.getByTestId('pdm-branch-select') as HTMLSelectElement;
    expect(select.value).toBe('variant-a');
  });
});

describe('VersionTreePanel — merge UI consumer', () => {
  /** Seed a diverged two-branch repo directly through the tested store. */
  function seedDiverged(opts: { kind: 'modify-modify' | 'delete-modify' }) {
    const s = usePdmSessionStore.getState();
    if (opts.kind === 'modify-modify') {
      s.init([f('a', { radius: 3 })], 'tester');
      s.createBranch('alt');
      s.commit([f('a', { radius: 5 })], 'alt: r5', 'tester');
      s.checkout('main');
      s.commit([f('a', { radius: 7 })], 'main: r7', 'tester');
    } else {
      s.init([f('a', { radius: 3 }), f('b', { t: 1 })], 'tester');
      s.createBranch('alt');
      s.commit([f('a', { radius: 3 }), f('b', { t: 9 })], 'alt modifies b', 'tester');
      s.checkout('main');
      s.commit([f('a', { radius: 3 })], 'main deletes b', 'tester');
    }
  }

  it('modify-modify: conflict listed, apply gated, take-ours then apply lands a 2-parent merge', () => {
    seedDiverged({ kind: 'modify-modify' });
    render(<VersionTreePanel isKo={false} />);

    fireEvent.change(screen.getByTestId('pdm-merge-source'), { target: { value: 'alt' } });
    fireEvent.click(screen.getByTestId('pdm-merge-btn'));

    // Conflict UI
    const rows = screen.getAllByTestId('pdm-conflict-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('modify-modify');
    expect(rows[0]!.textContent).toContain('a');
    const apply = screen.getByTestId('pdm-merge-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('pdm-conflict-ours'));
    expect(screen.queryAllByTestId('pdm-conflict-row')).toHaveLength(0);
    expect((screen.getByTestId('pdm-merge-apply') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('pdm-merge-apply'));
    const head = usePdmSessionStore.getState().repo!.current().commit;
    expect(head.parents).toHaveLength(2);
    expect(head.message).toBe('Merge alt into main');
    expect(head.features.find(x => x.id === 'a')?.params.radius).toBe(7); // ours = main
    // Merge view closed, graph shows 4 commits (root + 2 branch tips + merge).
    expect(screen.queryByTestId('pdm-merge-view')).toBeNull();
    expect(screen.getAllByTestId('pdm-graph-node')).toHaveLength(4);
  });

  it('delete-modify: take-theirs restores the modified feature in the merge commit', () => {
    seedDiverged({ kind: 'delete-modify' });
    render(<VersionTreePanel isKo={false} />);

    fireEvent.change(screen.getByTestId('pdm-merge-source'), { target: { value: 'alt' } });
    fireEvent.click(screen.getByTestId('pdm-merge-btn'));

    const rows = screen.getAllByTestId('pdm-conflict-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('delete-modify');
    // ours side shows "deleted" (honest labeling of the delete side).
    expect(rows[0]!.textContent).toContain('deleted');

    fireEvent.click(screen.getByTestId('pdm-conflict-theirs'));
    fireEvent.click(screen.getByTestId('pdm-merge-apply'));

    const head = usePdmSessionStore.getState().repo!.current().commit;
    expect(head.parents).toHaveLength(2);
    expect(head.features.find(x => x.id === 'b')?.params.t).toBe(9);
  });

  it('cancel discards the pending merge without a commit', () => {
    seedDiverged({ kind: 'modify-modify' });
    render(<VersionTreePanel isKo={false} />);
    const before = usePdmSessionStore.getState().repo!.listCommits().length;

    fireEvent.change(screen.getByTestId('pdm-merge-source'), { target: { value: 'alt' } });
    fireEvent.click(screen.getByTestId('pdm-merge-btn'));
    fireEvent.click(screen.getByTestId('pdm-merge-abort'));

    expect(screen.queryByTestId('pdm-merge-view')).toBeNull();
    expect(usePdmSessionStore.getState().repo!.listCommits()).toHaveLength(before);
  });
});
