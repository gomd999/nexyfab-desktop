// @vitest-environment jsdom
/**
 * MultiViewport — empty-state i18n regression.
 *
 * i18n audit batch 5 found the "Select a shape to preview" empty-state
 * hint hardcoded in English with no dict/lang wiring at all (pattern (a):
 * a render string that bypasses localisation entirely), while the sibling
 * EmptyCanvasGuide.tsx already localises the equivalent message to 6
 * languages. This test locks the fix: the hint now reads from a
 * pathname-derived 6-lang dict, mirroring BucklingAnalysisPanel.tsx.
 *
 * The empty-state branch returns before the r3f <Canvas> mounts, so no
 * WebGL mocking is needed here.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

let mockPathname = '/en/shape-generator';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import MultiViewport from '../MultiViewport';

const EXPECTED: Record<string, string> = {
  '/ko/shape-generator': '미리보기할 형상을 선택하세요',
  '/en/shape-generator': 'Select a shape to preview',
  '/ja/shape-generator': 'プレビューする形状を選択してください',
  '/zh/shape-generator': '选择要预览的形状',
  '/es/shape-generator': 'Seleccione una forma para previsualizar',
  '/ar/shape-generator': 'اختر شكلاً للمعاينة',
};

describe('MultiViewport empty state (6-lang dict)', () => {
  for (const [path, expected] of Object.entries(EXPECTED)) {
    it(`renders the localized hint for ${path}`, () => {
      mockPathname = path;
      const { getByText } = render(<MultiViewport result={null} />);
      expect(getByText(expected)).toBeTruthy();
    });
  }

  it('falls back to English for an unmapped route segment', () => {
    mockPathname = '/xx/shape-generator';
    const { getByText } = render(<MultiViewport result={null} />);
    expect(getByText('Select a shape to preview')).toBeTruthy();
  });

  it('cn alias maps to the zh string (route segment normalisation)', () => {
    mockPathname = '/cn/shape-generator';
    const { getByText } = render(<MultiViewport result={null} />);
    expect(getByText('选择要预览的形状')).toBeTruthy();
  });
});
