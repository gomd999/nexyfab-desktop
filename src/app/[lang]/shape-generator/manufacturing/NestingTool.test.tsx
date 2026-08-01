// @vitest-environment jsdom
/**
 * NestingTool — i18n regression.
 *
 * The rotated-part tooltip (`title="{label} {w}×{h}mm (rotated)"`) used to hardcode the
 * English word "(rotated)" outside the component's own 6-language `dict`, even though every
 * other label in the file was correctly wired. Non-English users would see this one English
 * fragment leak into an otherwise fully localized tooltip. Locks the fix: the tooltip must use
 * the localized `dict[lang].rotated` string, not the literal ' (rotated)'.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import NestingTool from './NestingTool';

vi.mock('next/navigation', () => ({ usePathname: () => '/ar/shape-generator' }));

describe('NestingTool i18n', () => {
  it('localizes the rotated-part tooltip instead of leaving it hardcoded English', () => {
    // width < height with a square-ish sheet forces the shelf-packer to rotate this part.
    const parts = [{ id: 'p1', label: 'X', width: 50, height: 300, quantity: 1 }];
    const { container } = render(<NestingTool lang="ar" parts={parts} />);

    const titled = container.querySelector('[title*="مُدار"]'); // "مُدار" (ar: rotated)
    expect(titled).toBeTruthy();
    expect(titled?.getAttribute('title')).not.toContain('(rotated)');
  });
});
