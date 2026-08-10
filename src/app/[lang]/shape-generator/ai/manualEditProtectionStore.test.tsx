// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MANUAL_EDIT_PROTECTION_STORAGE_KEY,
  getManualEditProtectionLocks,
  protectManualEdit,
  releaseManualEditProtection,
  resetManualEditProtectionSession,
  useManualEditProtectionLocks,
} from './manualEditProtectionStore';

describe('manual edit protection store', () => {
  beforeEach(() => resetManualEditProtectionSession());

  it('persists exact parameter locks without project or account data', () => {
    const { result } = renderHook(() => useManualEditProtectionLocks());
    act(() => { protectManualEdit({ kind: 'parameter', objectId: 'feature-1', field: 'height' }); });
    expect(result.current).toMatchObject([{ source: 'human', target: { kind: 'parameter', objectId: 'feature-1', field: 'height' } }]);
    expect(JSON.parse(window.sessionStorage.getItem(MANUAL_EDIT_PROTECTION_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('updates the same target lock and requires an explicit release', () => {
    const first = protectManualEdit({ kind: 'parameter', objectId: 'feature-1', field: 'height' });
    const second = protectManualEdit({ kind: 'parameter', objectId: 'feature-1', field: 'height' }, { source: 'expert', reason: 'Approved dimension' });
    expect(first.id).toBe(second.id);
    expect(getManualEditProtectionLocks()).toMatchObject([{ source: 'expert', reason: 'Approved dimension' }]);
    expect(releaseManualEditProtection(second.id)).toBe(true);
    expect(getManualEditProtectionLocks()).toEqual([]);
  });
});
