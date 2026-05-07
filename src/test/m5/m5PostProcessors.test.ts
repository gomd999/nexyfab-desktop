/**
 * M5: G-code post-processors — each registered dialect emits a non-trivial program.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateCAMToolpaths } from '@/app/[lang]/shape-generator/analysis/camLite';
import { toGcode } from '@/app/[lang]/shape-generator/analysis/gcodeEmitter';
import { POST_PROCESSOR_ORDER } from '@/app/[lang]/shape-generator/analysis/postProcessors';

const op = {
  type: 'face_mill' as const,
  toolDiameter: 8,
  stepover: 45,
  stepdown: 3,
  feedRate: 600,
  spindleSpeed: 2400,
};

describe('M5 CAM post-processors', () => {
  it('emits G-code for every built-in post (LinuxCNC, Fanuc, Mazak, Haas)', () => {
    const geo = new THREE.BoxGeometry(28, 14, 22);
    const cam = generateCAMToolpaths(geo, op);
    expect(cam.toolpaths.length).toBeGreaterThan(0);

    for (const id of POST_PROCESSOR_ORDER) {
      const out = toGcode(cam, op, { postProcessor: id, programName: `M5-${id}` });
      expect(out.postProcessorId).toBe(id);
      expect(out.lineCount).toBeGreaterThan(15);
      expect(out.code.length).toBeGreaterThan(80);
      expect(out.code).toMatch(/G0[01]/);
      expect(out.fileExtension).toMatch(/^[a-z0-9]+$/i);
    }
  });
});
