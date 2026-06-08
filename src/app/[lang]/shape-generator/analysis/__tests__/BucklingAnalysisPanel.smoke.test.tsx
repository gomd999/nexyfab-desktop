// @vitest-environment jsdom
/**
 * BucklingAnalysisPanel render smoke — the closest headless proxy for the
 * browser-only visual QA: assert the panel mounts, shows controls, and that
 * clicking Run drives the verified solver and renders a λcr result (no crash).
 * Real visual QA (layout, dock stacking, colour) still requires a browser.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import * as THREE from 'three';

vi.mock('next/navigation', () => ({ usePathname: () => '/en/shape-generator' }));

import BucklingAnalysisPanel from '../BucklingAnalysisPanel';

describe('BucklingAnalysisPanel (render smoke)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('mounts with a geometry and shows the material selector + run button', () => {
    const { getByText, container } = render(
      <BucklingAnalysisPanel lang="en" geometry={new THREE.BoxGeometry(200, 10, 10)} onClose={() => {}} />,
    );
    expect(getByText('Buckling Analysis')).toBeTruthy();
    expect(container.querySelector('select')).toBeTruthy();
    expect(getByText('Run Analysis')).toBeTruthy();
  });

  it('disables run with no geometry', () => {
    const { getByText } = render(
      <BucklingAnalysisPanel lang="en" geometry={null} onClose={() => {}} />,
    );
    expect(getByText('No geometry loaded')).toBeTruthy();
  });

  it('running the analysis drives the solver and renders a λcr result', async () => {
    let result: { criticalLoadFactor: number } | null = null;
    const { getByText, findByText } = render(
      <BucklingAnalysisPanel
        lang="en"
        geometry={new THREE.BoxGeometry(200, 10, 10)}
        onResult={(r) => { result = r; }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(getByText('Run Analysis'));
    // The solver is heavy; wait for the results section.
    await findByText('Results', {}, { timeout: 60_000 });
    await waitFor(() => expect(result).not.toBeNull(), { timeout: 60_000 });
    expect(result!.criticalLoadFactor).toBeGreaterThan(0);
  }, 90_000);
});
