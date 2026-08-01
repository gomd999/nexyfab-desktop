// @vitest-environment jsdom
/**
 * ShapePreview — sketch-plane selector i18n regression.
 *
 * i18n audit batch 6 found the centered "Sketch Plane" selector heading
 * hardcoded as a raw `lang === 'ko' ? '스케치 평면' : 'Sketch Plane'` ternary
 * (pattern (b)): the file already carries a full 6-language `dict`/`t` for
 * every other toolbar label, but this one spot bypassed it and silently
 * fell back to English for ja/zh/es/ar. This test locks the fix: the label
 * now reads `t.sketchPlaneLabel` from the same pathname-derived dict.
 *
 * `result={null}` keeps the component on its no-content branch, which never
 * mounts the r3f <Canvas> — so no WebGL/three.js mocking is needed here.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

let mockPathname = '/en/shape-generator';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import ShapePreview from '../ShapePreview';

const EXPECTED: Record<string, string> = {
  '/ko/shape-generator': '스케치 평면',
  '/en/shape-generator': 'Sketch Plane',
  '/ja/shape-generator': 'スケッチ平面',
  '/zh/shape-generator': '草图平面',
  '/es/shape-generator': 'Plano de Boceto',
  '/ar/shape-generator': 'مستوى الرسم',
};

describe('ShapePreview sketch-plane selector (6-lang dict)', () => {
  for (const [path, expected] of Object.entries(EXPECTED)) {
    it(`renders the localized "Sketch Plane" heading for ${path}`, () => {
      mockPathname = path;
      const { getByText } = render(
        <ShapePreview
          result={null}
          sketchPlane="xy"
          onSketchPlaneChange={() => {}}
        />,
      );
      expect(getByText(expected)).toBeTruthy();
    });
  }

  it('cn alias maps to the zh string (route segment normalisation)', () => {
    mockPathname = '/cn/shape-generator';
    const { getByText } = render(
      <ShapePreview
        result={null}
        sketchPlane="xy"
        onSketchPlaneChange={() => {}}
      />,
    );
    expect(getByText('草图平面')).toBeTruthy();
  });
});
