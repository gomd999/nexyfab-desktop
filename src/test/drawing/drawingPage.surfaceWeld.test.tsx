/** @vitest-environment jsdom */
/**
 * drawingPage.surfaceWeld.test.tsx — W4-D authoring UI for surface-finish +
 * weld symbols (roadmap B-grade #4: renderer existed, producer/UI did not).
 *
 * The modal builds the IR, the lib validators gate it, the sheet splices it,
 * the existing SymbolCallout renderer draws it, and the annotation list
 * shows the SAME formatter string the canvas uses.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
}));
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

function openModal(): void {
  fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
}

describe('drawing page surface finish + weld authoring (W4-D)', () => {
  it('authors a surface-finish symbol: canvas callout + list entry with the formatter string', () => {
    const { container } = render(<DrawingPageContent lang="en" />);
    openModal();
    fireEvent.click(screen.getByTestId('solver-dim-kind-surface'));
    fireEvent.change(screen.getByTestId('solver-dim-sf-target-input'), { target: { value: 'f.side.0' } });
    fireEvent.change(screen.getByTestId('solver-dim-sf-method-input'), { target: { value: 'milled' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));

    expect(screen.queryByTestId('solver-dim-modal')).toBeNull();
    const callout = container.querySelector('[data-testid^="sheet-renderer-surface-finish-"]');
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain('Ra 3.2');
    const list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('Ra 3.2 milled');
  });

  it('authors a weld symbol and deleting the list entry removes the callout', () => {
    const { container } = render(<DrawingPageContent lang="en" />);
    openModal();
    fireEvent.click(screen.getByTestId('solver-dim-kind-weld'));
    fireEvent.change(screen.getByTestId('solver-dim-weld-target-input'), { target: { value: 'e.vert.0' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));

    const callout = container.querySelector('[data-testid^="sheet-renderer-weld-"]');
    expect(callout).not.toBeNull();
    expect(callout?.textContent).toContain('fillet 6 (arrow)');
    const list = screen.getByTestId('drawing-page-annotation-list');
    expect(list.textContent).toContain('fillet 6 (arrow)');

    // Delete via the list's delete button.
    const weldId = callout?.getAttribute('data-testid')?.replace('sheet-renderer-weld-', '') ?? '';
    fireEvent.click(screen.getByTestId(`drawing-page-delete-annotation-${weldId}`));
    expect(container.querySelector('[data-testid^="sheet-renderer-weld-"]')).toBeNull();
  });

  it('surface submit without a target ref is refused with the validator message', () => {
    render(<DrawingPageContent lang="en" />);
    openModal();
    fireEvent.click(screen.getByTestId('solver-dim-kind-surface'));
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(screen.getByTestId('solver-dim-error').textContent).toContain('targetRef');
    // Modal stayed open; nothing was added.
    expect(screen.getByTestId('solver-dim-modal')).not.toBeNull();
    expect(screen.queryByTestId('drawing-page-annotation-list')).toBeNull();
  });

  it('weld pitch without length is refused (intermittent weld needs both)', () => {
    render(<DrawingPageContent lang="en" />);
    openModal();
    fireEvent.click(screen.getByTestId('solver-dim-kind-weld'));
    fireEvent.change(screen.getByTestId('solver-dim-weld-target-input'), { target: { value: 'e.vert.0' } });
    fireEvent.change(screen.getByTestId('solver-dim-weld-pitch-input'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    expect(screen.getByTestId('solver-dim-error').textContent).toContain('pitch requires length');
  });
});
