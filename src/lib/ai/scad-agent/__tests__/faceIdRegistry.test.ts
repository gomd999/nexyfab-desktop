/**
 * Z2 — Face ID registry tests.
 *
 * Pins:
 *   - primitive role tags become stable ids
 *   - mapped derived faces inherit parent stable ids (boolean op survives)
 *   - unmapped derived faces get synthetic but unique ids
 *   - resolution finds the right handle + index, returns null for stale ids
 */

import { describe, it, expect } from 'vitest';
import {
  createFaceIdRegistry,
  assignPrimitiveFaceIds,
  recordPropagation,
  resolveFaceIndex,
  listFaceIds,
  unregister,
} from '../faceIdRegistry';

describe('faceIdRegistry', () => {
  it('cube primitive gets 6 axis-aligned tags', () => {
    const reg = createFaceIdRegistry();
    const provs = assignPrimitiveFaceIds(reg, 'occt:1', 'cube');
    expect(provs.map(p => p.stableId)).toEqual([
      'occt:1:x+', 'occt:1:x-', 'occt:1:y+', 'occt:1:y-', 'occt:1:z+', 'occt:1:z-',
    ]);
    expect(provs[0].faceIndex).toBe(0);
    expect(provs[5].faceIndex).toBe(5);
  });

  it('cylinder primitive gets top/bottom/side', () => {
    const reg = createFaceIdRegistry();
    const provs = assignPrimitiveFaceIds(reg, 'occt:c', 'cylinder');
    expect(provs.map(p => p.stableId)).toEqual(['occt:c:top', 'occt:c:bottom', 'occt:c:side']);
  });

  it('resolveFaceIndex finds primitive face', () => {
    const reg = createFaceIdRegistry();
    assignPrimitiveFaceIds(reg, 'occt:1', 'cube');
    const r = resolveFaceIndex(reg, 'occt:1:z+');
    expect(r).toEqual({ handle: 'occt:1', faceIndex: 4 });
  });

  it('resolveFaceIndex returns null for unknown id', () => {
    const reg = createFaceIdRegistry();
    expect(resolveFaceIndex(reg, 'nope:top')).toBeNull();
  });

  it('boolean op with mapped faces inherits parent stable ids', () => {
    const reg = createFaceIdRegistry();
    assignPrimitiveFaceIds(reg, 'occt:1', 'cube');
    assignPrimitiveFaceIds(reg, 'occt:2', 'cylinder');

    // After cube minus cylinder, say 5 cube faces survive (the through-hole
    // removed one) plus the cylinder's side is now an inner face. The host
    // adapter would map: cube faces 0-4 → newHandle 0-4, cylinder side → 5.
    recordPropagation(reg, 'occt:3', 6, [
      { parentStableId: 'occt:1:x+', newFaceIndex: 0 },
      { parentStableId: 'occt:1:x-', newFaceIndex: 1 },
      { parentStableId: 'occt:1:y+', newFaceIndex: 2 },
      { parentStableId: 'occt:1:y-', newFaceIndex: 3 },
      { parentStableId: 'occt:1:z+', newFaceIndex: 4 },
      { parentStableId: 'occt:2:side', newFaceIndex: 5 },
    ]);

    // The original cube reference now resolves to the new handle's face.
    const r1 = resolveFaceIndex(reg, 'occt:1:z+');
    expect(r1).toEqual({ handle: 'occt:3', faceIndex: 4 });

    // The cylinder's side, now an inner hole, also resolves correctly.
    const r2 = resolveFaceIndex(reg, 'occt:2:side');
    expect(r2).toEqual({ handle: 'occt:3', faceIndex: 5 });
  });

  it('boolean op without mappings creates synthetic ids', () => {
    const reg = createFaceIdRegistry();
    recordPropagation(reg, 'occt:42', 4);  // no mappings provided
    const provs = listFaceIds(reg, 'occt:42');
    expect(provs).toHaveLength(4);
    expect(provs.map(p => p.stableId)).toEqual([
      'occt:42:f0', 'occt:42:f1', 'occt:42:f2', 'occt:42:f3',
    ]);
  });

  it('partial mapping: mapped faces inherit, unmapped get synthetic', () => {
    const reg = createFaceIdRegistry();
    assignPrimitiveFaceIds(reg, 'occt:base', 'cylinder');
    recordPropagation(reg, 'occt:fil', 4, [
      { parentStableId: 'occt:base:top', newFaceIndex: 0 },
      // bottom + side dropped through fillet
    ]);
    const provs = listFaceIds(reg, 'occt:fil');
    expect(provs.find(p => p.faceIndex === 0)?.stableId).toBe('occt:base:top');
    expect(provs.find(p => p.faceIndex === 1)?.stableId).toBe('occt:fil:f1');
    expect(provs.find(p => p.faceIndex === 2)?.stableId).toBe('occt:fil:f2');
    expect(provs.find(p => p.faceIndex === 3)?.stableId).toBe('occt:fil:f3');
  });

  it('unregister drops the handle and frees its stable ids', () => {
    const reg = createFaceIdRegistry();
    assignPrimitiveFaceIds(reg, 'occt:tmp', 'cube');
    unregister(reg, 'occt:tmp');
    expect(listFaceIds(reg, 'occt:tmp')).toHaveLength(0);
    expect(resolveFaceIndex(reg, 'occt:tmp:x+')).toBeNull();
  });

  it('sphere primitive yields one face id (single closed surface)', () => {
    const reg = createFaceIdRegistry();
    const provs = assignPrimitiveFaceIds(reg, 'occt:s', 'sphere');
    expect(provs).toHaveLength(1);
    expect(provs[0].stableId).toBe('occt:s:surf');
  });
});
