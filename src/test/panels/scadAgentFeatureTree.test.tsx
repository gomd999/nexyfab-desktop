/** @vitest-environment jsdom */
/**
 * ScadAgentFeatureTree — Z1-UI tree view tests.
 *
 * Pins the empty states, row rendering, dirty badge visibility, click-to-expand
 * details, inline param editing (numeric parse), conditional delete UI, and the
 * recursive two-level layout. Mutation paths (onParamChange / onRemove) are
 * verified through their callback contracts; the actual tree_set_param /
 * tree_remove_node tools live in featureTree.ts and have their own tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

import ScadAgentFeatureTree from '@/app/[lang]/shape-generator/panels/ScadAgentFeatureTree';
import type { FeatureTree, FeatureNode } from '@/lib/ai/scad-agent/featureTree';

function mkNode(partial: Partial<FeatureNode> & Pick<FeatureNode, 'id' | 'op'>): FeatureNode {
  return {
    name: partial.name,
    id: partial.id,
    op: partial.op,
    params: partial.params ?? {},
    parents: partial.parents ?? [],
    resultHandle: partial.resultHandle ?? null,
    dirty: partial.dirty ?? false,
    seq: partial.seq ?? 0,
  };
}

function mkTree(nodes: FeatureNode[]): FeatureTree {
  const map: Record<string, FeatureNode> = {};
  for (const n of nodes) map[n.id] = n;
  const roots = nodes.filter(n => n.parents.length === 0).map(n => n.id);
  return { nodes: map, roots, nextSeq: nodes.length };
}

describe('ScadAgentFeatureTree', () => {
  it('renders empty state when tree is null', () => {
    render(<ScadAgentFeatureTree lang="en" tree={null} />);
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
    expect(screen.getByText(/No feature tree yet/i)).toBeInTheDocument();
  });

  it('renders empty state when tree.nodes is empty', () => {
    const tree: FeatureTree = { nodes: {}, roots: [], nextSeq: 0 };
    render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    expect(screen.getByTestId('feature-tree-empty')).toBeInTheDocument();
  });

  it('renders one row per node', () => {
    const tree = mkTree([
      mkNode({ id: 'n1', op: 'primitive', params: { kind: 'box' }, seq: 0 }),
      mkNode({ id: 'n2', op: 'primitive', params: { kind: 'cylinder' }, seq: 1 }),
      mkNode({ id: 'n3', op: 'boolean', parents: ['n1', 'n2'], seq: 2 }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    // Roots render at top level. Children only appear once their parent is
    // expanded — so n3 isn't shown initially; that's by design.
    expect(screen.getByTestId('feature-tree-row-n1')).toBeInTheDocument();
    expect(screen.getByTestId('feature-tree-row-n2')).toBeInTheDocument();
    // The third node is a child of n1+n2, so expanding either reveals it.
    fireEvent.click(screen.getByTestId('feature-tree-row-n1'));
    expect(screen.getByTestId('feature-tree-row-n3')).toBeInTheDocument();
  });

  it('shows the dirty badge when node.dirty is true', () => {
    const tree = mkTree([
      mkNode({ id: 'n1', op: 'primitive', dirty: true }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    // The orange ● badge has aria-label = the localized "needs rebuild" string.
    expect(screen.getByLabelText(/needs rebuild/i)).toBeInTheDocument();
  });

  it('click expands the details subsection', () => {
    const tree = mkTree([
      mkNode({
        id: 'n1',
        op: 'fillet',
        params: { radius: 2.5 },
        parents: [],
        resultHandle: 'brep_42',
      }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    // Details panel hidden initially.
    expect(screen.queryByTestId('feature-tree-row-n1-details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('feature-tree-row-n1'));
    const details = screen.getByTestId('feature-tree-row-n1-details');
    expect(details).toBeInTheDocument();
    expect(details).toHaveTextContent(/brep_42/);
    expect(details).toHaveTextContent(/Fillet/);
  });

  it('param input emits onParamChange with parsed number on blur', () => {
    const onParamChange = vi.fn();
    const tree = mkTree([
      mkNode({
        id: 'n1',
        op: 'primitive',
        params: { radius: 5 },
      }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} onParamChange={onParamChange} />);
    fireEvent.click(screen.getByTestId('feature-tree-row-n1'));
    const input = screen.getByTestId('feature-tree-param-n1-radius') as HTMLInputElement;
    expect(input.type).toBe('number');
    fireEvent.change(input, { target: { value: '12.5' } });
    fireEvent.blur(input);
    expect(onParamChange).toHaveBeenCalledTimes(1);
    expect(onParamChange).toHaveBeenCalledWith('n1', 'radius', 12.5);
  });

  it('delete button only renders when onRemove is provided', () => {
    const tree = mkTree([
      mkNode({ id: 'n1', op: 'primitive', params: { width: 10 } }),
    ]);
    const { rerender } = render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    fireEvent.click(screen.getByTestId('feature-tree-row-n1'));
    expect(screen.queryByTestId('feature-tree-delete-n1')).not.toBeInTheDocument();

    const onRemove = vi.fn();
    rerender(<ScadAgentFeatureTree lang="en" tree={tree} onRemove={onRemove} />);
    // The first row is still expanded from the previous render — but the
    // selection model lives in component state, so the rerender keeps the
    // expansion. Click delete and confirm the callback fires.
    const deleteBtn = screen.getByTestId('feature-tree-delete-n1');
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(onRemove).toHaveBeenCalledWith('n1');
  });

  it('renders two-level nesting (parent → child) when parent is expanded', () => {
    const tree = mkTree([
      mkNode({ id: 'parent', op: 'primitive', seq: 0 }),
      mkNode({ id: 'child', op: 'fillet', parents: ['parent'], seq: 1 }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} />);
    // Initially only the parent is visible.
    expect(screen.getByTestId('feature-tree-row-parent')).toBeInTheDocument();
    expect(screen.queryByTestId('feature-tree-row-child')).not.toBeInTheDocument();
    // Expand parent → child becomes visible.
    fireEvent.click(screen.getByTestId('feature-tree-row-parent'));
    expect(screen.getByTestId('feature-tree-row-child')).toBeInTheDocument();
  });

  it('Enter key in the param input commits the new value', () => {
    const onParamChange = vi.fn();
    const tree = mkTree([
      mkNode({ id: 'n1', op: 'primitive', params: { size: 10 } }),
    ]);
    render(<ScadAgentFeatureTree lang="en" tree={tree} onParamChange={onParamChange} />);
    fireEvent.click(screen.getByTestId('feature-tree-row-n1'));
    const input = screen.getByTestId('feature-tree-param-n1-size') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onParamChange).toHaveBeenCalledWith('n1', 'size', 20);
  });
});
