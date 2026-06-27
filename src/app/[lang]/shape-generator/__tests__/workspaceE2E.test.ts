/**
 * Workspace E2E (#3) — the manufacturing-output workflows end-to-end, headless:
 *   CAM:     toolpath → post-processor → G-code (validate dialect output)
 *   Drawing: 3D solid → orthographic/iso projection → 2D line art
 * The individual functions are unit-tested; this verifies the full chain that
 * actually produces the deliverable a user exports from each workspace.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toGcode } from '../analysis/gcodeEmitter';
import { projectGeometry } from '../analysis/autoDrawing';

describe('workspace E2E: CAM toolpath → G-code post', () => {
   
  const camResult: any = {
    toolpaths: [[
      new THREE.Vector3(0, 0, 5), new THREE.Vector3(20, 0, 5),
      new THREE.Vector3(20, 20, -1), new THREE.Vector3(0, 20, -1), new THREE.Vector3(0, 0, -1),
    ]],
    totalLength: 80, estimatedTime: 1.2, passes: 1, warnings: [],
  };
   
  const op: any = { type: 'contour', toolDiameter: 6, stepover: 40, stepdown: 1, feedRate: 800, spindleSpeed: 12000 };

  for (const post of ['fanuc', 'haas', 'linuxcnc', 'mazak']) {
    it(`emits valid G-code (${post})`, () => {
      const g = toGcode(camResult, op, { postProcessor: post });
      expect(typeof g.code).toBe('string');
      expect(g.code.length).toBeGreaterThan(0);
      expect(g.code).toMatch(/G0?[01]\b/);          // has rapid / linear-feed moves
      expect(g.moveCount).toBeGreaterThan(0);
      expect(g.lineCount).toBeGreaterThan(0);
      expect(g.postProcessorId).toBeTruthy();
    });
  }
});

describe('workspace E2E: drawing projection (solid → 2D views)', () => {
  const box = () => new THREE.BoxGeometry(40, 20, 30);
  for (const view of ['front', 'top', 'right', 'iso'] as const) {
    it(`projects a box to non-empty line art (${view})`, () => {
      const lines = projectGeometry(box(), view, 1);
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
    });
  }
  it('returns nothing for an empty geometry (no crash)', () => {
    const empty = new THREE.BufferGeometry();
    expect(projectGeometry(empty, 'front', 1)).toEqual([]);
  });
});
