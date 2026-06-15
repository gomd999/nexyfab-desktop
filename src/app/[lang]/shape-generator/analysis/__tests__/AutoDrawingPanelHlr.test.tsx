/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import * as THREE from 'three';

// Mock next/navigation to avoid the App-Router context requirement.
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
  useSearchParams: () => new URLSearchParams(),
}));

// Capture the config generateDrawing is called with, so we can assert the
// trueHlr toggle reaches the engine. Re-export everything else untouched.
const generateSpy = vi.fn();
vi.mock('../autoDrawing', async (importActual) => {
  const actual = await importActual<typeof import('../autoDrawing')>();
  return {
    ...actual,
    generateDrawing: (geom: THREE.BufferGeometry, config: unknown) => {
      generateSpy(config);
      return actual.generateDrawing(geom, config as Parameters<typeof actual.generateDrawing>[1]);
    },
  };
});

import AutoDrawingPanel from '../AutoDrawingPanel';

function box(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(10, 10, 10).toNonIndexed();
}

describe('AutoDrawingPanel — true HLR toggle', () => {
  it('renders the hidden-lines checkbox, unchecked by default', () => {
    render(<AutoDrawingPanel lang="en" geometry={box()} partName="P" material="steel" onClose={() => {}} />);
    const cb = screen.getByTestId('auto-drawing-truehlr') as HTMLInputElement;
    expect(cb).toBeTruthy();
    expect(cb.checked).toBe(false);
  });

  it('toggling the checkbox carries trueHlr into the generated drawing config', () => {
    generateSpy.mockClear();
    render(<AutoDrawingPanel lang="en" geometry={box()} partName="P" material="steel" onClose={() => {}} />);
    const cb = screen.getByTestId('auto-drawing-truehlr') as HTMLInputElement;

    // Off by default → config.trueHlr falsy.
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    expect(generateSpy).toHaveBeenCalled();
    expect((generateSpy.mock.calls.at(-1)![0] as { trueHlr?: boolean }).trueHlr).toBeFalsy();

    // Turn it on → next generate passes trueHlr: true.
    fireEvent.click(cb);
    expect(cb.checked).toBe(true);
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    expect((generateSpy.mock.calls.at(-1)![0] as { trueHlr?: boolean }).trueHlr).toBe(true);
  });
});
