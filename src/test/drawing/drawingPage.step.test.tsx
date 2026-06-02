/** @vitest-environment jsdom */
/**
 * drawingPage.step.test.tsx — STEP+PMI export button (Phase 4.4.x).
 *
 * Covers:
 *   - button renders under the existing PNG / JSON pair
 *   - sample-cube path produces a valid ISO-10303-21 file
 *   - sample-pentagon path runs the polygon writer (5 cartesian points)
 *   - sheet annotations get spliced into the DATA section
 *   - empty sheet → geometry-only STEP (no PMI fragment)
 *   - writeStepWithPmi throw → inline error banner
 *   - i18n (en / ko) label surfacing
 *
 * The PNG canvas plumbing isn't needed here — we mock URL.createObjectURL
 * directly and inspect the Blob argument for STEP contents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { DrawingPageContent } from '@/app/[lang]/shape-generator/drawing/_content';

// ─── env shims ───────────────────────────────────────────────────────────

let createObjectUrlSpy: ReturnType<typeof vi.fn>;
let revokeObjectUrlSpy: ReturnType<typeof vi.fn>;
let originalCreate: typeof URL.createObjectURL | undefined;
let originalRevoke: typeof URL.revokeObjectURL | undefined;

/** Read back text from a Blob created via URL.createObjectURL spy. */
async function blobToText(blob: Blob): Promise<string> {
  // jsdom Blob#text exists; fall back to FileReader if not.
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

beforeEach(() => {
  originalCreate = URL.createObjectURL;
  originalRevoke = URL.revokeObjectURL;
  createObjectUrlSpy = vi.fn(() => 'blob:mock-url');
  revokeObjectUrlSpy = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectUrlSpy, configurable: true, writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectUrlSpy, configurable: true, writable: true,
  });
});

afterEach(() => {
  if (originalCreate) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: originalCreate, configurable: true, writable: true,
    });
  }
  if (originalRevoke) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: originalRevoke, configurable: true, writable: true,
    });
  }
  vi.restoreAllMocks();
});

function mount(lang = 'en') {
  return render(<DrawingPageContent lang={lang} />);
}

function lastBlob(): Blob {
  const arg = createObjectUrlSpy.mock.calls.at(-1)?.[0];
  expect(arg).toBeInstanceOf(Blob);
  return arg as Blob;
}

// ─── tests ───────────────────────────────────────────────────────────────

describe('DrawingPageContent STEP+PMI export', () => {
  it('renders the Export STEP+PMI button in the footer', () => {
    mount();
    const btn = screen.getByTestId('drawing-export-step-button');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent ?? '').toMatch(/STEP/);
  });

  it('clicking with sample-cube selected triggers URL.createObjectURL with an application/step Blob', async () => {
    mount();
    // Default selection is sample-cube.
    fireEvent.click(screen.getByTestId('drawing-export-step-button'));
    expect(createObjectUrlSpy).toHaveBeenCalled();
    const blob = lastBlob();
    expect(blob.type).toBe('application/step');
    const text = await blobToText(blob);
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(text).toMatch(/END-ISO-10303-21;/);
  });

  it('sample-pentagon selection runs the polygon writer (5 CARTESIAN_POINT vertices on the profile)', async () => {
    mount();
    fireEvent.change(screen.getByTestId('drawing-part-select'), {
      target: { value: 'sample-pentagon' },
    });
    fireEvent.click(screen.getByTestId('drawing-export-step-button'));
    const text = await blobToText(lastBlob());
    // Pentagon prism = 5 bottom + 5 top = 10 profile CARTESIAN_POINTs.
    // Plus an origin point in the global coordinate context. The count
    // is writer-dependent; assert ≥ 10 to pin "real polygon, not bbox".
    const cpMatches = text.match(/CARTESIAN_POINT/g) ?? [];
    expect(cpMatches.length).toBeGreaterThanOrEqual(10);
  });

  it('annotated sheet produces a STEP with DIMENSIONAL_SIZE in the DATA section', async () => {
    mount();
    // Add one linear dimension via the modal so the sheet picks up a PMI row.
    fireEvent.click(screen.getByTestId('drawing-add-annotation-button'));
    fireEvent.change(screen.getByTestId('solver-dim-ref-0-input'), { target: { value: 'e1' } });
    fireEvent.change(screen.getByTestId('solver-dim-ref-1-input'), { target: { value: 'e2' } });
    fireEvent.click(screen.getByTestId('solver-dim-submit'));
    fireEvent.click(screen.getByTestId('drawing-export-step-button'));
    const text = await blobToText(lastBlob());
    expect(text).toContain('DIMENSIONAL_SIZE');
  });

  it('empty sheet (no annotations) produces a STEP with no PMI DIMENSIONAL_SIZE row', async () => {
    mount();
    fireEvent.click(screen.getByTestId('drawing-export-step-button'));
    const text = await blobToText(lastBlob());
    expect(text).not.toContain('DIMENSIONAL_SIZE');
    // But it must still be a valid STEP envelope.
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(text).toMatch(/END-ISO-10303-21;/);
  });

  it('writeStepWithPmi throw surfaces the error inline via role=alert', () => {
    // Trigger a real error path: stub URL.createObjectURL to throw inside
    // downloadBlob. The component wraps the entire export in try/catch so
    // the thrown error must reach the inline alert banner.
    createObjectUrlSpy.mockImplementation(() => {
      throw new Error('boom — mocked failure');
    });
    mount();
    expect(screen.queryByTestId('drawing-export-step-error')).toBeNull();
    fireEvent.click(screen.getByTestId('drawing-export-step-button'));
    const alert = screen.getByTestId('drawing-export-step-error');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent ?? '').toMatch(/boom — mocked failure/);
  });

  it('English i18n shows "Export STEP+PMI"', () => {
    mount('en');
    expect(screen.getByTestId('drawing-export-step-button').textContent ?? '').toMatch(/Export STEP\+PMI/);
  });

  it('Korean i18n shows "STEP+PMI 내보내기"', () => {
    mount('ko');
    expect(screen.getByTestId('drawing-export-step-button').textContent ?? '').toMatch(/STEP\+PMI 내보내기/);
  });
});
