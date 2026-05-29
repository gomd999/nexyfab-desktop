/**
 * @vitest-environment jsdom
 *
 * StepUploaderClassificationDetails.test.tsx — Regression tests for the
 * "Show details" expand/collapse panel inside ClassificationBanner.
 *
 * The banner is rendered while `isUploading && classification` are
 * truthy. To drive that state without spinning a real Worker / OCCT
 * WASM, we mock `useStepWorker` so `parseStep` returns a never-resolving
 * promise — analyze() reads the file, runs the classifier, sets
 * `classification`, and stays in the uploading branch waiting on the
 * worker. The mock for analytics swallows the telemetry call.
 *
 * Asserts:
 *  1. With NO file uploaded, the details toggle button is absent.
 *  2. With classification set + toggle OFF, the table is hidden.
 *  3. Clicking the toggle reveals the byType table (>=3 rows).
 *  4. Clicking again collapses the table.
 *  5. Each row's Category cell carries the per-category color via
 *     data-category attribute + inline style color.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ── Mocks (must be hoisted via vi.mock; cannot reference outer vars) ──
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/shape-generator',
}));

vi.mock('@/lib/analytics', () => ({
  analytics: {
    stepClassify: vi.fn(),
  },
}));

// Never-resolving parseStep so the banner stays mounted in the
// "uploading" branch after the classifier runs.
const cancelMock = vi.fn();
vi.mock('../../workers/useStepWorker', () => ({
  useStepWorker: () => ({
    parseStep: vi.fn(() => new Promise(() => { /* never resolves */ })),
    loading: false,
    cancel: cancelMock,
  }),
}));

// StepReversePanel pulls in heavy three deps via stepReverseEngineer.
// Only rendered after `result` is set, which never happens in these
// tests (parseStep never resolves), but stub it to keep module init
// cheap.
vi.mock('../StepReversePanel', () => ({
  default: () => null,
}));

// Hooks/useGeometryGC: noop is fine, no geometry in these tests.
vi.mock('../../hooks/useGeometryGC', () => ({
  useLocalActiveGeometries: () => {},
  trackGeometry: (g: unknown) => g,
}));

import StepUploader from '../StepUploader';

// ── Test STEP fixture ────────────────────────────────────────────────
// Crafted so classifyStepEntities produces 4+ distinct entity types
// across multiple categories (core + tessellated + units + style).
// Counts engineered for sort stability — CARTESIAN_POINT highest.
const STEP_TEXT = `ISO-10303-21;
HEADER;
FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));
ENDSEC;
DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=CARTESIAN_POINT('',(1.,0.,0.));
#3=CARTESIAN_POINT('',(0.,1.,0.));
#4=CARTESIAN_POINT('',(0.,0.,1.));
#5=CARTESIAN_POINT('',(1.,1.,1.));
#6=ADVANCED_FACE('',(#7),#8,.T.);
#7=ADVANCED_FACE('',(#6),#8,.T.);
#8=ADVANCED_FACE('',(#7),#9,.T.);
#9=TRIANGULATED_FACE('',(#1,#2,#3));
#10=TRIANGULATED_FACE('',(#2,#3,#4));
#11=MANIFOLD_SOLID_BREP('',#12);
#12=CLOSED_SHELL('',(#6));
#13=SI_UNIT(.MILLI.,.METRE.);
#14=COLOUR_RGB('',0.5,0.5,0.5);
ENDSEC;
END-ISO-10303-21;
`;

function makeStepFile(): File {
  const file = new File([STEP_TEXT], 'fixture.step', { type: 'application/STEP' });
  // jsdom's File doesn't always implement arrayBuffer(); polyfill from text.
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => {
        const enc = new TextEncoder();
        return enc.encode(STEP_TEXT).buffer;
      },
    });
  }
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClassificationBanner — details toggle visibility', () => {
  it('does not render the details toggle before any file is uploaded', () => {
    render(<StepUploader onAnalysisComplete={vi.fn()} lang="en" />);
    // Drop zone is showing, no classification + banner yet.
    expect(screen.queryByTestId('classification-banner')).toBeNull();
    expect(screen.queryByTestId('classification-details-toggle')).toBeNull();
  });

  it('shows the banner + toggle after upload; table starts hidden (toggle OFF)', async () => {
    render(<StepUploader onAnalysisComplete={vi.fn()} lang="en" />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeStepFile()] } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('classification-banner')).toBeTruthy();
    });
    expect(screen.getByTestId('classification-details-toggle')).toBeTruthy();
    // Table not yet rendered.
    expect(screen.queryByTestId('classification-details-table')).toBeNull();
    expect(screen.getByTestId('classification-details-toggle').getAttribute('aria-expanded'))
      .toBe('false');
  });
});

describe('ClassificationBanner — details toggle behaviour', () => {
  it('expanding reveals the byType table with multiple rows (≥3)', async () => {
    render(<StepUploader onAnalysisComplete={vi.fn()} lang="en" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeStepFile()] } });
    });

    await waitFor(() => screen.getByTestId('classification-details-toggle'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('classification-details-toggle'));
    });

    const table = await waitFor(() =>
      screen.getByTestId('classification-details-table'),
    );
    expect(table).toBeTruthy();
    const rows = table.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByTestId('classification-details-toggle').getAttribute('aria-expanded'))
      .toBe('true');

    // First row should be CARTESIAN_POINT (highest count = 5, sorted desc).
    const firstRow = rows[0] as HTMLElement;
    expect(firstRow.textContent).toContain('CARTESIAN_POINT');
    expect(firstRow.textContent).toContain('5');
  });

  it('clicking the toggle a second time collapses the table', async () => {
    render(<StepUploader onAnalysisComplete={vi.fn()} lang="en" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeStepFile()] } });
    });

    await waitFor(() => screen.getByTestId('classification-details-toggle'));
    const toggle = screen.getByTestId('classification-details-toggle');

    // Expand
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => screen.getByTestId('classification-details-table'));

    // Collapse
    await act(async () => { fireEvent.click(toggle); });
    await waitFor(() => {
      expect(screen.queryByTestId('classification-details-table')).toBeNull();
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ClassificationBanner — category color coding', () => {
  it('renders the per-category color on each Category cell', async () => {
    render(<StepUploader onAnalysisComplete={vi.fn()} lang="en" />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    await act(async () => {
      fireEvent.change(input, { target: { files: [makeStepFile()] } });
    });

    await waitFor(() => screen.getByTestId('classification-details-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('classification-details-toggle'));
    });
    await waitFor(() => screen.getByTestId('classification-details-table'));

    // CARTESIAN_POINT → core → green
    const coreCell = screen.getByTestId('classification-details-category-CARTESIAN_POINT');
    expect(coreCell.getAttribute('data-category')).toBe('core');
    // jsdom returns colors as the original value (we set them via inline style).
    expect((coreCell as HTMLElement).style.color.toLowerCase()).toBe('rgb(63, 185, 80)');

    // TRIANGULATED_FACE → tessellated → blue
    const tessCell = screen.getByTestId('classification-details-category-TRIANGULATED_FACE');
    expect(tessCell.getAttribute('data-category')).toBe('tessellated');
    expect((tessCell as HTMLElement).style.color.toLowerCase()).toBe('rgb(56, 139, 253)');

    // SI_UNIT → units → gray
    const unitsCell = screen.getByTestId('classification-details-category-SI_UNIT');
    expect(unitsCell.getAttribute('data-category')).toBe('units');
    expect((unitsCell as HTMLElement).style.color.toLowerCase()).toBe('rgb(139, 148, 158)');

    // COLOUR_RGB → style → yellow
    const styleCell = screen.getByTestId('classification-details-category-COLOUR_RGB');
    expect(styleCell.getAttribute('data-category')).toBe('style');
    expect((styleCell as HTMLElement).style.color.toLowerCase()).toBe('rgb(227, 179, 65)');
  });
});
