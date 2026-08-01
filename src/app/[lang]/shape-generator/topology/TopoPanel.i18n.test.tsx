// @vitest-environment jsdom
/**
 * TopoPanel.i18n.test.tsx — regression for the hardcoded-English-label bug
 * class (260802 shape-generator i18n audit, batch 4).
 *
 * TopoPanel's dict already carries all six locales (ko/en/ja/zh/es/ar) and
 * every other label is wired through `t`. The "selected face detail" block
 * had one exception: the origin-feature line was rendered as a literal
 * `Origin: {...}` string that never consulted the dict, so every non-English
 * locale (including ko) saw the English word "Origin" regardless of `lang`.
 * Fixed by adding a `t.origin` field to all six dict entries and rendering
 * `{t.origin}: {...}`.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TopoPanel from './TopoPanel';
import type { TopologicalMap } from './TopologicalNaming';

function makeMap(): TopologicalMap {
  return {
    faces: {
      f1: {
        stableId: 'f1-stable-id-0123456789abcdef',
        faceIndex: 0,
        signature: { normal: [0, 1, 0], centroid: [0, 10, 0], area: 100, triCount: 2 },
        originFeatureId: 'feature-box-1',
        tag: 'top',
      },
    },
    indexToStable: { 0: 'f1' },
    generation: 1,
    builtAt: Date.now(),
  };
}

describe('TopoPanel — origin label follows lang, not hardcoded English', () => {
  it('lang=en: shows "Origin:" prefix', () => {
    render(<TopoPanel map={makeMap()} selectedFaceIndex={0} lang="en" />);
    expect(screen.getByText(/^Origin:/)).toBeInTheDocument();
  });

  it('lang=kr: shows the Korean label, not the English word "Origin"', () => {
    render(<TopoPanel map={makeMap()} selectedFaceIndex={0} lang="kr" />);
    expect(screen.getByText(/^출처:/)).toBeInTheDocument();
    expect(screen.queryByText(/^Origin:/)).not.toBeInTheDocument();
  });

  it.each(['ja', 'cn', 'es', 'ar'])('lang=%s: origin label is not the bare English word', (lang) => {
    render(<TopoPanel map={makeMap()} selectedFaceIndex={0} lang={lang} />);
    expect(screen.queryByText(/^Origin:/)).not.toBeInTheDocument();
  });
});
