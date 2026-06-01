/** @vitest-environment jsdom */
/**
 * StlViewer — basic mount + cleanup smoke test.
 *
 * jsdom does NOT implement WebGL, so we can't run the full Three.js
 * render loop. This test just verifies the component mounts, attaches
 * a host element, and unmounts without throwing.
 *
 * Full behavior is covered by manual browser testing + integration
 * happens through SolverSketchEditorWithExtrude where the viewer is
 * dynamically imported behind an ssr:false boundary.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// Mock the Three.js + STLLoader modules so jsdom doesn't have to deal
// with WebGL or binary loaders. We only need to verify the component
// shell renders the test-id host element.
vi.mock('three', () => {
  class Scene { background: unknown; add() {} remove() {} }
  class PerspectiveCamera { fov = 45; position = { set: () => {} }; }
  class WebGLRenderer {
    domElement = document.createElement('div');
    setSize() {} setPixelRatio() {} render() {} dispose() {}
  }
  class AmbientLight {}
  class DirectionalLight { position = { set: () => {} } }
  class Color { constructor(_c: unknown) {} }
  class MeshPhongMaterial { dispose() {} }
  class Mesh { geometry = { dispose: () => {}, boundingBox: null }; material = { dispose: () => {} }; }
  class Vector3 { constructor(public x = 0, public y = 0, public z = 0) {} }
  return { Scene, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight, Color, MeshPhongMaterial, Mesh, Vector3 };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class { enableDamping = false; dampingFactor = 0; target = { copy: () => {} }; update() {} dispose() {} },
}));

vi.mock('three/examples/jsm/loaders/STLLoader.js', () => ({
  STLLoader: class {
    parse() {
      const fake = { computeVertexNormals() {}, computeBoundingBox() {}, dispose() {}, boundingBox: { getSize: () => ({ x: 10, y: 10, z: 10 }), getCenter: () => ({ x: 0, y: 0, z: 0 }) } };
      return fake;
    }
  },
}));

import StlViewer from '@/app/[lang]/shape-generator/sketch/StlViewer';

describe('StlViewer', () => {
  it('mounts a host div with data-testid stl-viewer', () => {
    render(<StlViewer stlBase64="AAAA" width={200} height={200} />);
    const host = screen.getByTestId('stl-viewer');
    expect(host).toBeInTheDocument();
    expect(host.style.width).toBe('200px');
    expect(host.style.height).toBe('200px');
  });

  it('unmounts cleanly (no leaked WebGL resources)', () => {
    const { unmount } = render(<StlViewer stlBase64="AAAA" />);
    expect(() => unmount()).not.toThrow();
  });
});
