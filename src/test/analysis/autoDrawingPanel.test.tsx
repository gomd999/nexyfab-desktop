/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import * as THREE from 'three';

vi.mock('next/navigation', () => ({
  usePathname: () => '/en/nexyfab/shape',
}));

const reportInfo = vi.fn();
vi.mock('@/app/[lang]/shape-generator/lib/telemetry', () => ({
  reportInfo: (...args: unknown[]) => reportInfo(...args),
}));

vi.mock('@/lib/platform', () => ({
  downloadBlob: vi.fn(async () => undefined),
}));

vi.mock('@/app/[lang]/shape-generator/analysis/drawingExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/[lang]/shape-generator/analysis/drawingExport')>();
  return {
    ...actual,
    exportDrawingPDF: vi.fn(async () => undefined),
    exportDrawingDXF: vi.fn(async () => undefined),
  };
});

vi.mock('@/app/[lang]/shape-generator/analysis/autoDrawing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/[lang]/shape-generator/analysis/autoDrawing')>();
  return {
    ...actual,
    computeDrawingGeometryFingerprint: vi.fn((g: THREE.BufferGeometry) => `fp_${g.uuid}`),
    generateDrawing: vi.fn((): import('@/app/[lang]/shape-generator/analysis/autoDrawing').DrawingResult => ({
      paperWidth: 297,
      paperHeight: 210,
      views: [
        {
          projection: 'front',
          lines: [],
          texts: [],
          position: { x: 10, y: 10 },
          width: 40,
          height: 40,
        },
      ],
      titleBlock: {
        partName: 'p',
        material: 'm',
        drawnBy: 'd',
        date: '2020-01-01',
        scale: '1:1',
        revision: 'A',
      },
      tolerance: { linear: '±0.1', angular: "±0°30'" },
    })),
  };
});

import AutoDrawingPanel from '@/app/[lang]/shape-generator/analysis/AutoDrawingPanel';
import { exportDrawingPDF, exportDrawingDXF } from '@/app/[lang]/shape-generator/analysis/drawingExport';
import {
  DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
  clearDrawingTemplatePrefs,
  loadDrawingTemplatePrefs,
} from '@/app/[lang]/shape-generator/analysis/drawingTemplatePrefs';

describe('AutoDrawingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('disables SVG/PDF/DXF exports when drawing is stale after geometry change', async () => {
    const geoA = new THREE.BoxGeometry(1, 1, 1);
    const { rerender } = render(
      <AutoDrawingPanel lang="en" geometry={geoA} partName="P" material="alum" onClose={() => {}} />,
    );
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    await waitFor(() => {
      expect(screen.getByTestId('auto-drawing-preview-svg')).toBeInTheDocument();
    });

    expect(screen.getByTestId('auto-drawing-export-svg')).not.toBeDisabled();

    const geoB = new THREE.BoxGeometry(2, 1, 1);
    rerender(<AutoDrawingPanel lang="en" geometry={geoB} partName="P" material="alum" onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByTestId('auto-drawing-stale-banner')).toBeInTheDocument();
    });
    expect(screen.getByTestId('auto-drawing-export-svg')).toBeDisabled();
    expect(screen.getByTestId('auto-drawing-export-pdf')).toBeDisabled();
    expect(screen.getByTestId('auto-drawing-export-dxf')).toBeDisabled();

    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    await waitFor(() => {
      expect(screen.queryByTestId('auto-drawing-stale-banner')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('auto-drawing-export-svg')).not.toBeDisabled();
  });

  it('calls reportInfo on PDF export when not stale', async () => {
    const geo = new THREE.BoxGeometry(1, 2, 3);
    render(<AutoDrawingPanel lang="en" geometry={geo} partName="PartX" material="steel" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    await waitFor(() => expect(screen.getByTestId('auto-drawing-preview-svg')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('auto-drawing-export-pdf'));
    await waitFor(() => expect(vi.mocked(exportDrawingPDF)).toHaveBeenCalled());
    expect(reportInfo).toHaveBeenCalledWith(
      'drawing_export',
      'pdf_export',
      expect.objectContaining({ format: 'pdf', partName: 'PartX' }),
    );
  });

  it('calls reportInfo on DXF export when not stale', async () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    render(<AutoDrawingPanel lang="en" geometry={geo} partName="P" material="m" onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('auto-drawing-generate'));
    await waitFor(() => expect(screen.getByTestId('auto-drawing-preview-svg')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('auto-drawing-export-dxf'));
    await waitFor(() => expect(vi.mocked(exportDrawingDXF)).toHaveBeenCalled());
    expect(reportInfo).toHaveBeenCalledWith(
      'drawing_export',
      'dxf_export',
      expect.objectContaining({ format: 'dxf', partName: 'P' }),
    );
  });

  it('save-default button writes current settings to prefs storage', async () => {
    clearDrawingTemplatePrefs();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    render(<AutoDrawingPanel lang="en" geometry={geo} partName="P" material="m" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId('auto-drawing-save-default'));

    await waitFor(() => {
      const raw = window.localStorage.getItem(DRAWING_TEMPLATE_PREFS_STORAGE_KEY);
      expect(raw).not.toBeNull();
    });
    expect(screen.getByTestId('auto-drawing-save-default-toast')).toBeInTheDocument();
    expect(reportInfo).toHaveBeenCalledWith(
      'drawing_export',
      'save_default_template',
      expect.objectContaining({ partName: 'P' }),
    );
  });

  it('hydrates template-level state from prefs on mount (Phase 6e round-trip)', async () => {
    // Pre-seed prefs as if user had previously saved A3 portrait + custom tolerances.
    window.localStorage.setItem(
      DRAWING_TEMPLATE_PREFS_STORAGE_KEY,
      JSON.stringify({
        views: ['front', 'iso'],
        scale: 2,
        paperSize: 'A3',
        orientation: 'portrait',
        showDimensions: false,
        showCenterlines: true,
        tolerance: { linear: '±0.05', angular: "±0°15'" },
        roughness: [{ ra: 1.6, nx: 0.85, ny: 0.15 }],
        titleBlock: {
          partName: 'IGNORE_ME',
          material: 'IGNORE_ME',
          drawnBy: 'gomd9',
          date: '2020-01-01',
          scale: '2:1',
          revision: 'C',
        },
      }),
    );

    const geo = new THREE.BoxGeometry(1, 1, 1);
    render(<AutoDrawingPanel lang="en" geometry={geo} partName="WidgetA" material="alum" onClose={() => {}} />);

    // After hydration, generate must use the prefs-restored config — verify by
    // round-tripping through Save (which serialises current state).
    await waitFor(() => {
      fireEvent.click(screen.getByTestId('auto-drawing-save-default'));
      const saved = loadDrawingTemplatePrefs();
      expect(saved.scale).toBe(2);
      expect(saved.paperSize).toBe('A3');
      expect(saved.orientation).toBe('portrait');
      expect(saved.showDimensions).toBe(false);
      expect(saved.tolerance?.linear).toBe('±0.05');
      expect(saved.titleBlock.drawnBy).toBe('gomd9');
      expect(saved.titleBlock.revision).toBe('C');
      // Per-part fields must NOT hydrate from prefs — they come from props.
      expect(saved.titleBlock.partName).toBe('WidgetA');
      expect(saved.titleBlock.material).toBe('alum');
    });
  });
});
