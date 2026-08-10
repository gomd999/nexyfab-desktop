// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import StepReversePanel from './StepReversePanel';
import type { ReconstructedFeatureTree } from './stepReverseEngineer';

let result: ReconstructedFeatureTree;

vi.mock('./stepReverseEngineer', async () => {
  const actual = await vi.importActual<typeof import('./stepReverseEngineer')>('./stepReverseEngineer');
  return { ...actual, reverseEngineerStep: vi.fn(async () => result) };
});

const baseTree = (): ReconstructedFeatureTree => ({
  baseShape: { type: 'box', label: '100 × 50 × 20', params: { width: 100, height: 50, depth: 20 }, confidence: 0.92 },
  features: [],
  bbox: {
    width: 100, height: 50, depth: 20, cx: 0, cy: 0, cz: 0,
    sphereRadius: 57, cylinderRadius: 10, cylinderHeight: 100,
    aspectXY: 2, aspectXZ: 5, aspectYZ: 2.5,
  },
  meshStats: { vertices: 8, triangles: 12 },
  overallConfidence: 0.92,
  limitations: [],
});

describe('StepReversePanel review gate', () => {
  beforeEach(() => { result = baseTree(); });

  it('shows a C grade and disables editable application when detection is unverified', async () => {
    result = { ...baseTree(), limitations: ['Topology map unavailable.'], overallConfidence: 0.46 };
    const onApply = vi.fn();
    render(<StepReversePanel geometry={new THREE.BufferGeometry()} lang="en" onApplyBase={onApply} />);
    await screen.findByTestId('step-reverse-review-required');
    expect(screen.getByTestId('step-reverse-grade').textContent).toContain('Grade D');
    const button = screen.getByRole('button', { name: 'Apply to Feature Tree' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/Features unverified/)).toBeInTheDocument();
  });

  it('allows an A-grade analytic candidate to be applied', async () => {
    const onApply = vi.fn();
    render(<StepReversePanel geometry={new THREE.BufferGeometry()} lang="en" onApplyBase={onApply} />);
    await waitFor(() => expect(screen.getByTestId('step-reverse-grade').textContent).toContain('Grade A'));
    const button = screen.getByRole('button', { name: 'Apply to Feature Tree' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith('box', { width: 100, height: 50, depth: 20 });
  });
});
