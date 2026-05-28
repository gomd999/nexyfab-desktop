/** @vitest-environment jsdom */
/**
 * AutoDrawingDialog.test.tsx — Wave 2 Phase 2 Track B5.
 *
 * Validates the auto-drawing dialog UI shell: deferred-message banner is
 * shown (geometric unfold pending occt-worker, task #31), inputs are
 * editable, and clicking Generate PDF invokes the (mockable) PDF stub
 * generator.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  AutoDrawingDialog,
  type AutoDrawingPdfInput,
  type AutoDrawingPdfResult,
} from '../AutoDrawingDialog';

function mockPdfGen() {
  const calls: AutoDrawingPdfInput[] = [];
  const impl = vi.fn(async (input: AutoDrawingPdfInput): Promise<AutoDrawingPdfResult> => {
    calls.push(input);
    return { ok: true, jspdfLoaded: true, byteLength: 4096 };
  });
  return { calls, impl };
}

describe('AutoDrawingDialog — render baseline', () => {
  it('renders the dialog and overlay', () => {
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('auto-drawing-dialog')).toBeTruthy();
    expect(screen.getByTestId('auto-drawing-dialog-card')).toBeTruthy();
  });

  it('renders the Korean title for lang=ko', () => {
    render(
      <AutoDrawingDialog
        lang="ko"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('auto-drawing-dialog-title').textContent).toBe('자동 도면');
  });

  it('shows the deferred-worker banner with task #31 reference', () => {
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    const banner = screen.getByTestId('auto-drawing-deferred-banner');
    // Default English deferred copy mentions K-factor (case-insensitive).
    expect(banner.textContent!.toLowerCase()).toContain('k-factor');
    expect(screen.getByTestId('auto-drawing-task-ref').textContent).toContain('task #31');
  });
});

describe('AutoDrawingDialog — inputs', () => {
  it('material picker contains all 7 Schema A materials', () => {
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    const sel = screen.getByTestId('auto-drawing-material') as HTMLSelectElement;
    expect(sel.options.length).toBe(7);
  });

  it('thickness input updates on change', () => {
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId('auto-drawing-thickness') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3.2' } });
    expect(Number(input.value)).toBeCloseTo(3.2, 3);
  });

  it('units toggle switches between mm and inch', () => {
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
      />,
    );
    const units = screen.getByTestId('auto-drawing-units') as HTMLSelectElement;
    fireEvent.change(units, { target: { value: 'inch' } });
    expect(units.value).toBe('inch');
  });
});

describe('AutoDrawingDialog — PDF generation', () => {
  it('clicking Generate PDF invokes the impl with the current inputs', async () => {
    const { calls, impl } = mockPdfGen();
    render(
      <AutoDrawingDialog
        lang="en"
        material="aluminum5052"
        thickness={2.0}
        onClose={() => {}}
        generatePdfImpl={impl}
      />,
    );
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    await waitFor(() => {
      expect(impl).toHaveBeenCalled();
    });
    expect(calls[0].material).toBe('aluminum5052');
    expect(calls[0].thickness).toBeCloseTo(2.0, 3);
    expect(calls[0].units).toBe('mm');
    expect(calls[0].deferredNote.toLowerCase()).toContain('k-factor');
  });

  it('shows the success result with byte length when jsPDF loaded', async () => {
    const { impl } = mockPdfGen();
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={() => {}}
        generatePdfImpl={impl}
      />,
    );
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    const result = await screen.findByTestId('auto-drawing-result');
    expect(result.textContent).toMatch(/4096/);
    expect(result.getAttribute('data-jspdf-loaded')).toBe('true');
  });
});

describe('AutoDrawingDialog — close', () => {
  it('cancel button invokes onClose', () => {
    const onClose = vi.fn();
    render(
      <AutoDrawingDialog
        lang="en"
        material="mildSteel"
        thickness={1.5}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('auto-drawing-cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
