/**
 * M5: CAM lite — additional operation kinds still emit G-code.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { generateCAMToolpaths, type CAMOperation } from '@/app/[lang]/shape-generator/analysis/camLite';
import { toGcode } from '@/app/[lang]/shape-generator/analysis/gcodeEmitter';

describe('M5 CAM operations', () => {
  it('contour and pocket ops produce toolpaths and LinuxCNC output', () => {
    const geo = new THREE.BoxGeometry(32, 16, 24);
    const base = {
      toolDiameter: 6,
      stepover: 40,
      stepdown: 2,
      feedRate: 500,
      spindleSpeed: 3000,
    };
    const contourOp: CAMOperation = { type: 'contour', ...base };
    const pocketOp: CAMOperation = { type: 'pocket', ...base };

    const contourCam = generateCAMToolpaths(geo, contourOp);
    expect(contourCam.toolpaths.length).toBeGreaterThan(0);
    const contourG = toGcode(contourCam, contourOp, { postProcessor: 'linuxcnc', programName: 'M5Contour' });
    expect(contourG.lineCount).toBeGreaterThan(10);

    const pocketCam = generateCAMToolpaths(geo, pocketOp);
    expect(pocketCam.toolpaths.length).toBeGreaterThan(0);
    const pocketG = toGcode(pocketCam, pocketOp, { postProcessor: 'linuxcnc', programName: 'M5Pocket' });
    expect(pocketG.lineCount).toBeGreaterThan(10);
  });
});
