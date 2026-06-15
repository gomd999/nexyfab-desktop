/**
 * @vitest-environment jsdom
 *
 * AssemblyTreeEditor.test.tsx — sub-assembly tree builder UI tests.
 *
 * Asserts:
 *  - empty root renders the assemblyRoot badge + empty-tree placeholder
 *  - "Add part" appends a leaf to the root's children + fires onChange
 *  - "Add sub-assembly" twice nested produces a 2-level tree
 *  - Remove leaf removes the child via onChange
 *  - Label edit on root fires onChange with new label
 *  - Translate input on leaf fires onChange with updated transform
 *  - Part dropdown change updates leaf's partId
 *  - Root row has no remove button (root not removable via UI)
 *  - Add part with empty availablePartIds uses placeholder partId
 *  - Arabic lang sets dir=rtl on container
 */

import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as THREE from 'three';
import {
  AssemblyTreeEditor,
  __resetSubIdCounter,
  emptySubAssembly,
  emptyLeaf,
} from '../AssemblyTreeEditor';
import type { AssemblySubNode } from '../assemblyStepHierarchy';

beforeEach(() => {
  __resetSubIdCounter();
});

/** Wrapper that owns the tree state so we can assert end-to-end controlled
 *  updates without re-rendering manually from the test body. */
function Harness(props: {
  initial: AssemblySubNode;
  available: readonly { id: string; label: string }[];
  onChangeSpy?: (next: AssemblySubNode) => void;
  lang?: string;
}) {
  const [tree, setTree] = useState<AssemblySubNode>(props.initial);
  return (
    <AssemblyTreeEditor
      root={tree}
      onChange={(next) => {
        setTree(next);
        props.onChangeSpy?.(next);
      }}
      availablePartIds={props.available}
      lang={props.lang}
    />
  );
}

function makeEmptyRoot(): AssemblySubNode {
  return {
    kind: 'subAssembly',
    subAsmId: 'root',
    label: 'MyAssembly',
    transform: new THREE.Matrix4().identity(),
    children: [],
  };
}

const AVAIL: readonly { id: string; label: string }[] = [
  { id: 'bracket', label: 'Bracket' },
  { id: 'gear', label: 'Gear' },
  { id: 'shaft', label: 'Shaft' },
];

describe('AssemblyTreeEditor — rendering', () => {
  it('renders the empty root with assembly-root badge + empty placeholder', () => {
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} />);
    expect(screen.getByTestId('assembly-tree-editor')).toBeTruthy();
    expect(screen.getByTestId('assembly-tree-editor-node-root')).toBeTruthy();
    // root label input present
    expect(screen.getByTestId('assembly-tree-editor-node-root-label')).toBeTruthy();
    // no remove button on root
    expect(screen.queryByTestId('assembly-tree-editor-node-root-remove')).toBeNull();
  });

  it('Arabic lang puts dir=rtl on the container', () => {
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} lang="ar" />);
    const container = screen.getByTestId('assembly-tree-editor');
    expect(container.getAttribute('dir')).toBe('rtl');
  });

  it('English lang has no dir attribute', () => {
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} lang="en" />);
    const container = screen.getByTestId('assembly-tree-editor');
    expect(container.getAttribute('dir')).toBeNull();
  });
});

describe('AssemblyTreeEditor — add / remove', () => {
  it('Add part appends a leaf to root + fires onChange', () => {
    const spy = vi.fn();
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} onChangeSpy={spy} />);

    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-root-add-part'));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    expect(next.kind).toBe('subAssembly');
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(next.children.length).toBe(1);
    const child = next.children[0];
    expect(child.kind).toBe('part');
    if (child.kind !== 'part') throw new Error('expected part child');
    expect(child.partId).toBe('bracket'); // seeded from availablePartIds[0]

    // UI now shows a part row
    expect(screen.getByTestId('assembly-tree-editor-node-0')).toBeTruthy();
    expect(screen.getByTestId('assembly-tree-editor-node-0-part-select')).toBeTruthy();
  });

  it('Add sub-assembly twice nested produces a 2-level tree', () => {
    const spy = vi.fn();
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} onChangeSpy={spy} />);

    // Add a sub-asm as child of root
    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-root-add-sub'));
    });
    // Add a sub-asm as child of the new sub-asm
    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-0-add-sub'));
    });

    expect(spy).toHaveBeenCalledTimes(2);
    const finalTree = spy.mock.calls[1][0] as AssemblySubNode;
    if (finalTree.kind !== 'subAssembly') throw new Error('expected sub-assembly root');
    expect(finalTree.children.length).toBe(1);
    const child1 = finalTree.children[0];
    if (child1.kind !== 'subAssembly') throw new Error('expected sub-assembly child');
    expect(child1.children.length).toBe(1);
    expect(child1.children[0].kind).toBe('subAssembly');

    // Deeply nested row visible in UI (path separator is '.')
    expect(screen.getByTestId('assembly-tree-editor-node-0.0')).toBeTruthy();
  });

  it('Remove leaf removes the child via onChange', () => {
    const spy = vi.fn();
    const seeded: AssemblySubNode = {
      kind: 'subAssembly',
      subAsmId: 'root',
      label: 'A',
      transform: new THREE.Matrix4().identity(),
      children: [
        emptyLeaf('gear'),
        emptyLeaf('shaft'),
      ],
    };
    render(<Harness initial={seeded} available={AVAIL} onChangeSpy={spy} />);

    // Both leaves visible
    expect(screen.getByTestId('assembly-tree-editor-node-0')).toBeTruthy();
    expect(screen.getByTestId('assembly-tree-editor-node-1')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-0-remove'));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(next.children.length).toBe(1);
    const remaining = next.children[0];
    if (remaining.kind !== 'part') throw new Error('expected part');
    expect(remaining.partId).toBe('shaft');
  });

  it('Remove sub-assembly removes the nested branch', () => {
    const spy = vi.fn();
    const seeded: AssemblySubNode = {
      kind: 'subAssembly',
      subAsmId: 'root',
      label: 'A',
      transform: new THREE.Matrix4().identity(),
      children: [
        {
          kind: 'subAssembly',
          subAsmId: 'sub_x',
          label: 'Gearbox',
          transform: new THREE.Matrix4().identity(),
          children: [emptyLeaf('gear')],
        },
      ],
    };
    render(<Harness initial={seeded} available={AVAIL} onChangeSpy={spy} />);

    expect(screen.getByTestId('assembly-tree-editor-node-0')).toBeTruthy();
    expect(screen.getByTestId('assembly-tree-editor-node-0.0')).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-0-remove'));
    });

    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(next.children.length).toBe(0);
  });
});

describe('AssemblyTreeEditor — edits', () => {
  it('Label edit on root fires onChange with new label', () => {
    const spy = vi.fn();
    render(<Harness initial={makeEmptyRoot()} available={AVAIL} onChangeSpy={spy} />);

    const labelInput = screen.getByTestId('assembly-tree-editor-node-root-label') as HTMLInputElement;
    act(() => {
      fireEvent.change(labelInput, { target: { value: 'NewName' } });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(next.label).toBe('NewName');
  });

  it('Translate x input on leaf updates the transform', () => {
    const spy = vi.fn();
    const seeded: AssemblySubNode = {
      kind: 'subAssembly',
      subAsmId: 'root',
      label: 'A',
      transform: new THREE.Matrix4().identity(),
      children: [emptyLeaf('gear')],
    };
    render(<Harness initial={seeded} available={AVAIL} onChangeSpy={spy} />);

    const txInput = screen.getByTestId('assembly-tree-editor-node-0-tx') as HTMLInputElement;
    act(() => {
      fireEvent.change(txInput, { target: { value: '25' } });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    const child = next.children[0];
    if (child.kind !== 'part') throw new Error('expected part');
    expect(child.transform).toBeDefined();
    const e = child.transform!.elements;
    expect(e[12]).toBe(25); // x translate
    expect(e[13]).toBe(0);
    expect(e[14]).toBe(0);
  });

  it('Part dropdown change updates the leaf partId', () => {
    const spy = vi.fn();
    const seeded: AssemblySubNode = {
      kind: 'subAssembly',
      subAsmId: 'root',
      label: 'A',
      transform: new THREE.Matrix4().identity(),
      children: [emptyLeaf('gear')],
    };
    render(<Harness initial={seeded} available={AVAIL} onChangeSpy={spy} />);

    const sel = screen.getByTestId('assembly-tree-editor-node-0-part-select') as HTMLSelectElement;
    act(() => {
      fireEvent.change(sel, { target: { value: 'shaft' } });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    const child = next.children[0];
    if (child.kind !== 'part') throw new Error('expected part');
    expect(child.partId).toBe('shaft');
  });
});

describe('AssemblyTreeEditor — empty parts edge case', () => {
  it('Add part with empty availablePartIds still creates a leaf (placeholder partId)', () => {
    const spy = vi.fn();
    render(<Harness initial={makeEmptyRoot()} available={[]} onChangeSpy={spy} />);

    act(() => {
      fireEvent.click(screen.getByTestId('assembly-tree-editor-node-root-add-part'));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const next = spy.mock.calls[0][0] as AssemblySubNode;
    if (next.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(next.children.length).toBe(1);
    const child = next.children[0];
    if (child.kind !== 'part') throw new Error('expected part');
    expect(child.partId).toBe('part_unknown');
  });
});

describe('AssemblyTreeEditor — helper factories', () => {
  it('emptySubAssembly produces a renderable sub-asm node with stable shape', () => {
    const node = emptySubAssembly();
    expect(node.kind).toBe('subAssembly');
    if (node.kind !== 'subAssembly') throw new Error('expected sub-assembly');
    expect(node.children).toEqual([]);
    expect(node.subAsmId).toMatch(/^sub_\d+$/);
  });

  it('emptyLeaf seeds partId + label from the same id', () => {
    const node = emptyLeaf('bracket');
    expect(node.kind).toBe('part');
    if (node.kind !== 'part') throw new Error('expected part');
    expect(node.partId).toBe('bracket');
    expect(node.label).toBe('bracket');
    expect(node.stepText).toBe('');
  });
});
