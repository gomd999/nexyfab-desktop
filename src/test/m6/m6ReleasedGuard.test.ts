/**
 * M6: 서버·클라 공용 릴리스 씬 가드 (`nfProjectReleasedGuard`).
 */
import { describe, it, expect } from 'vitest';
import {
  readLifecycleFromNfabSceneData,
  assertReleasedSceneEditAllowed,
} from '@/lib/nfProjectReleasedGuard';
import { NFAB_PDM_META_KEY } from '@/lib/nfProjectPdmConstants';

function scene(lifecycle: 'wip' | 'released', extra?: Record<string, unknown>): string {
  return JSON.stringify({
    meta: {
      [NFAB_PDM_META_KEY]: { lifecycle, ...(extra ?? {}) },
    },
  });
}

describe('M6 readLifecycleFromNfabSceneData', () => {
  it('returns wip for null, empty, invalid JSON, or missing PDM', () => {
    expect(readLifecycleFromNfabSceneData(null)).toBe('wip');
    expect(readLifecycleFromNfabSceneData(undefined)).toBe('wip');
    expect(readLifecycleFromNfabSceneData('')).toBe('wip');
    expect(readLifecycleFromNfabSceneData('not-json')).toBe('wip');
    expect(readLifecycleFromNfabSceneData('{}')).toBe('wip');
    expect(readLifecycleFromNfabSceneData(JSON.stringify({ meta: {} }))).toBe('wip');
  });

  it('returns released only when lifecycle is exactly released', () => {
    expect(readLifecycleFromNfabSceneData(scene('released'))).toBe('released');
    expect(readLifecycleFromNfabSceneData(scene('wip'))).toBe('wip');
    const loose = JSON.stringify({
      meta: { [NFAB_PDM_META_KEY]: { lifecycle: 'RELEASED' } },
    });
    expect(readLifecycleFromNfabSceneData(loose)).toBe('wip');
  });
});

describe('M6 assertReleasedSceneEditAllowed', () => {
  const released = scene('released');
  const wip = scene('wip');

  it('allows undefined incoming (no scene change)', () => {
    expect(assertReleasedSceneEditAllowed(released, undefined)).toEqual({ ok: true });
  });

  it('allows identical payload', () => {
    expect(assertReleasedSceneEditAllowed(released, released)).toEqual({ ok: true });
  });

  it('allows any edit when current is wip', () => {
    expect(assertReleasedSceneEditAllowed(wip, released)).toEqual({ ok: true });
  });

  it('allows un-release (released → wip) while changing body', () => {
    expect(assertReleasedSceneEditAllowed(released, wip)).toEqual({ ok: true });
  });

  it('blocks arbitrary scene change while staying released', () => {
    const next = scene('released', { partNumber: 'X-2' });
    const r = assertReleasedSceneEditAllowed(released, next);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Released');
  });
});
