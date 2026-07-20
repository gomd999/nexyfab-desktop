/** @vitest-environment jsdom */
/**
 * drawingPage.detailBroken.test.tsx — W4-C page wiring: the add-detail /
 * add-broken buttons append working viewports, and (fraction-anchored) they
 * survive a model switch associatively like the W4-B section views.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

describe('drawing page detail + broken views (W4-C)', () => {
  it('add-detail appends a detail viewport with a source marker on FRONT', () => {
    const { container } = render(<DrawingPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('drawing-add-detail'));
    expect(screen.getByTestId('drawing-detail-count').textContent).toMatch(/1/);
    expect(container.querySelector('g[data-vp-kind="detail"]')).not.toBeNull();
    // The front view carries the mapped detail circle marker.
    expect(
      container.querySelector('[data-testid^="sheet-renderer-detail-marker-front-"]'),
    ).not.toBeNull();
  });

  it('add-broken appends a broken viewport with real collapsed line work', () => {
    const { container } = render(<DrawingPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('drawing-add-broken'));
    expect(screen.getByTestId('drawing-broken-count').textContent).toMatch(/1/);
    const g = container.querySelector('[data-testid^="sheet-renderer-broken-geometry-"]');
    expect(g).not.toBeNull();
    expect(Number(g?.getAttribute('data-visible'))).toBeGreaterThan(0);
  });

  it('detail + broken views survive a part switch (fraction re-derivation)', () => {
    const { container } = render(<DrawingPageContent lang="en" />);
    fireEvent.click(screen.getByTestId('drawing-add-detail'));
    fireEvent.click(screen.getByTestId('drawing-add-broken'));
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cylinder' },
    });
    expect(screen.getByTestId('drawing-detail-count').textContent).toMatch(/1/);
    expect(screen.getByTestId('drawing-broken-count').textContent).toMatch(/1/);
    expect(container.querySelector('g[data-vp-kind="detail"]')).not.toBeNull();
    expect(container.querySelector('g[data-vp-kind="broken"]')).not.toBeNull();
    // The broken view still shows real geometry for the NEW part.
    const g = container.querySelector('[data-testid^="sheet-renderer-broken-geometry-"]');
    expect(Number(g?.getAttribute('data-visible'))).toBeGreaterThan(0);
  });
});
