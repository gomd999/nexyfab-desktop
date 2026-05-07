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

describe('AutoDrawingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
