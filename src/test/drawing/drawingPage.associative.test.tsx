/** @vitest-environment jsdom */
/**
 * drawingPage.associative.test.tsx — W4-B associative behaviour on the
 * production drawing page.
 *
 *   1. Section views SURVIVE a model (part) switch — re-anchored, not
 *      deleted (the roadmap's honest-audit called out the old deletion).
 *   2. The annotation list shows the REAL measured value for a dimension
 *      (W4-A wiring surfaced beyond the canvas), and a model switch that
 *      breaks measurability shows an explicit ⚠ status — never a stale
 *      number.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

describe('drawing page associative update (W4-B)', () => {
  it('section views survive a part switch (re-anchored, not deleted)', () => {
    const { container } = mount();
    fireEvent.click(screen.getByTestId('drawing-add-section'));
    expect(screen.getByTestId('drawing-section-count').textContent).toMatch(/1/);
    const sectionVpsBefore = container.querySelectorAll('g[data-vp-kind="section"]');
    expect(sectionVpsBefore.length).toBe(1);

    // Model change: sample-cube → sample-cylinder.
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cylinder' },
    });

    // The section view is still there (old behaviour deleted it).
    expect(screen.getByTestId('drawing-section-count').textContent).toMatch(/1/);
    const sectionVpsAfter = container.querySelectorAll('g[data-vp-kind="section"]');
    expect(sectionVpsAfter.length).toBe(1);
  });

  it('annotation list shows the measured value, and a part switch flips it to an explicit ⚠ loss', () => {
    const { container } = mount();
    // Dimension between the cube's two X side faces — measurable on 'front'.
    fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
    fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: 'f.side.3' } });
    fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: 'f.side.1' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));

    const list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('= 50');
    const dimEl = container.querySelector('[data-dim-id]');
    expect(dimEl?.getAttribute('data-dim-measured')).toBe('ok');

    // Cube → cylinder: f.side.1/f.side.3 still exist on the 16-gon prism but
    // are no longer parallel — the value must become an explicit refusal,
    // not keep showing 50.
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-cylinder' },
    });
    const listAfter = screen.getByTestId('drawing-page-annotation-list');
    expect(listAfter.textContent).not.toContain('= 50');
    expect(listAfter.textContent).toContain('⚠');
  });
});
