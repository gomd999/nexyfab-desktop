import { describe, it, expect } from 'vitest';
import {
  readLifecycleFromNfabSceneData,
  assertReleasedSceneEditAllowed,
} from '@/lib/nfProjectReleasedGuard';
import { NFAB_PDM_META_KEY } from '@/lib/nfProjectPdmConstants';

function scene(lifecycle: 'wip' | 'released', part = 'P1') {
  return JSON.stringify({
    magic: 'nfab',
    version: 1,
    name: 't',
    meta: { [NFAB_PDM_META_KEY]: { partNumber: part, lifecycle } },
    tree: { nodes: [], rootId: 'r', activeNodeId: 'r' },
    scene: { selectedId: 'box', params: {}, paramExpressions: {}, materialId: 'aluminum', color: '#fff', isSketchMode: false, sketchPlane: 'xy', sketchProfile: { segments: [], closed: false }, sketchConfig: { mode: 'extrude', depth: 1, revolveAngle: 360, revolveAxis: 'y', segments: 8 } },
  });
}

describe('nfProjectReleasedGuard', () => {
  it('reads wip by default', () => {
    expect(readLifecycleFromNfabSceneData(undefined)).toBe('wip');
    expect(readLifecycleFromNfabSceneData('not json')).toBe('wip');
  });

  it('reads released from nfab json', () => {
    expect(readLifecycleFromNfabSceneData(scene('released'))).toBe('released');
    expect(readLifecycleFromNfabSceneData(scene('wip'))).toBe('wip');
  });

  it('allows identical scene replace', () => {
    const s = scene('released');
    expect(assertReleasedSceneEditAllowed(s, s)).toEqual({ ok: true });
  });

  it('allows edit when current wip', () => {
    const cur = scene('wip');
    const next = scene('released');
    expect(assertReleasedSceneEditAllowed(cur, next)).toEqual({ ok: true });
  });

  it('blocks geometry change while released', () => {
    const cur = scene('released', 'A');
    const next = scene('released', 'B');
    const r = assertReleasedSceneEditAllowed(cur, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Released/i);
  });

  it('allows un-release (wip payload) from released', () => {
    const cur = scene('released');
    const next = scene('wip');
    expect(assertReleasedSceneEditAllowed(cur, next)).toEqual({ ok: true });
  });
});
