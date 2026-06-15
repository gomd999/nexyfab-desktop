/**
 * mobileViewer — the read-only mobile 3D viewer's decision + i18n logic (the part
 * that's testable without WebGL). The R3F Canvas itself is runtime/visual.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { hasViewableGeometry, mobileViewerLabels } from './mobileViewer';

describe('mobileViewer — viewer-vs-wall decision', () => {
  it('shows the viewer for a real (non-empty) geometry', () => {
    expect(hasViewableGeometry(new THREE.BoxGeometry(10, 10, 10))).toBe(true);
  });

  it('falls back to the wall for null / undefined / empty geometry', () => {
    expect(hasViewableGeometry(null)).toBe(false);
    expect(hasViewableGeometry(undefined)).toBe(false);
    const empty = new THREE.BufferGeometry();
    expect(hasViewableGeometry(empty)).toBe(false);
  });
});

describe('mobileViewer — i18n labels', () => {
  it('covers all six product languages with non-empty strings', () => {
    for (const lang of ['ko', 'en', 'ja', 'cn', 'es', 'ar']) {
      const l = mobileViewerLabels(lang);
      expect(l.badge.length).toBeGreaterThan(0);
      expect(l.gesture.length).toBeGreaterThan(0);
      expect(l.edit.length).toBeGreaterThan(0);
    }
  });

  it('falls back to English for an unknown language', () => {
    expect(mobileViewerLabels('xx')).toEqual(mobileViewerLabels('en'));
  });

  it('returns the right language (ko ≠ en)', () => {
    expect(mobileViewerLabels('ko').badge).not.toBe(mobileViewerLabels('en').badge);
    expect(mobileViewerLabels('ko').badge).toBe('보기 전용');
  });
});
