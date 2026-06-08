// @vitest-environment jsdom
/**
 * ConflictResolutionOverlay — A1 viewport feedback: renders the non-destructive
 * proposals, badges the recommended option, and emits accept/highlight events
 * (the host wires the 3D mesh highlight + the actual mate drop).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ConflictResolutionOverlay from '../ConflictResolutionOverlay';
import { proposeConflictResolutions, MATE_TYPE_DOFS, type AssemblyMate } from '../mateConflictResolver';

function mate(id: string, type: AssemblyMate['type'], strength: number): AssemblyMate {
  return { id, bodyA: 'A', bodyB: 'B', type, strength, dofsRemoved: MATE_TYPE_DOFS[type] };
}

const overConstrained = (): AssemblyMate[] => [
  mate('m1', 'coincident', 50),
  mate('m2', 'coincident', 80),
  mate('m3', 'coincident', 100),
  mate('m4', 'coincident', 30),
];

describe('ConflictResolutionOverlay (A1)', () => {
  it('renders nothing when there are no conflicts', () => {
    const { container } = render(
      <ConflictResolutionOverlay proposals={[]} onAccept={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a card with ranked options and badges the recommended (weakest)', () => {
    const proposals = proposeConflictResolutions(overConstrained(), ['A', 'B']);
    const { getByTestId } = render(
      <ConflictResolutionOverlay lang="en" proposals={proposals} onAccept={() => {}} />,
    );
    expect(getByTestId('conflict-overlay')).toBeTruthy();
    // First (top-ranked) option is the weakest mate m4 and is recommended.
    const first = getByTestId('conflict-0-option-0');
    expect(first.getAttribute('data-recommended')).toBe('true');
    expect(first.textContent).toContain('m4');
    expect(getByTestId('conflict-0-recommended')).toBeTruthy();
  });

  it('clicking an option emits onAccept with that mate id', () => {
    const proposals = proposeConflictResolutions(overConstrained(), ['A', 'B']);
    const onAccept = vi.fn();
    const { getByTestId } = render(
      <ConflictResolutionOverlay proposals={proposals} onAccept={onAccept} />,
    );
    fireEvent.click(getByTestId('conflict-0-option-0'));
    expect(onAccept).toHaveBeenCalledWith('m4');
  });

  it('hovering a card highlights the whole over-constrained subgraph', () => {
    const proposals = proposeConflictResolutions(overConstrained(), ['A', 'B']);
    const onHighlight = vi.fn();
    const { getByTestId } = render(
      <ConflictResolutionOverlay proposals={proposals} onAccept={() => {}} onHighlight={onHighlight} />,
    );
    fireEvent.mouseEnter(getByTestId('conflict-card-0'));
    expect(onHighlight).toHaveBeenCalledWith(expect.arrayContaining(['m1', 'm2', 'm3', 'm4']));
    fireEvent.mouseLeave(getByTestId('conflict-card-0'));
    expect(onHighlight).toHaveBeenLastCalledWith([]);
  });

  it('auto-resolve button fires onAcceptAllRecommended', () => {
    const proposals = proposeConflictResolutions(overConstrained(), ['A', 'B']);
    const onAll = vi.fn();
    const { getByTestId } = render(
      <ConflictResolutionOverlay proposals={proposals} onAccept={() => {}} onAcceptAllRecommended={onAll} />,
    );
    fireEvent.click(getByTestId('conflict-accept-all'));
    expect(onAll).toHaveBeenCalledTimes(1);
  });
});
