'use client';

import { useCallback } from 'react';
import { estimateWeight, exportBomCSV, exportBomExcel, type BomRow } from '../io/bomExport';

type MetricResult = {
  bbox: { w: number; h: number; d: number };
  volume_cm3: number;
  surface_area_cm2: number;
};

type BomPartInput = { name: string; result: MetricResult };
type CartItemInput = MetricResult & { shapeId: string; shapeName: string };

export type WorkspaceBomSource = {
  bomParts: readonly BomPartInput[];
  cartItems: readonly CartItemInput[];
  effectiveResult: MetricResult | null;
  isSketchResult: boolean;
  selectedId: string;
  selectedShapeName: string;
  materialId: string;
};

const dimensionsOf = (result: MetricResult): string => (
  `${result.bbox.w.toFixed(1)}×${result.bbox.h.toFixed(1)}×${result.bbox.d.toFixed(1)} mm`
);

function rowFromResult(
  rows: BomRow[],
  result: MetricResult,
  { name, shape, material }: { name: string; shape: string; material: string },
): BomRow {
  return {
    no: rows.length + 1,
    name,
    shape,
    material,
    dimensions: dimensionsOf(result),
    volume_cm3: result.volume_cm3,
    surface_area_cm2: result.surface_area_cm2,
    weight_g: estimateWeight(result.volume_cm3, material),
    quantity: 1,
  };
}

export function buildWorkspaceBomRows(source: WorkspaceBomSource): BomRow[] {
  const rows: BomRow[] = [];
  for (const part of source.bomParts) {
    rows.push(rowFromResult(rows, part.result, {
      name: part.name,
      shape: part.name,
      material: source.materialId,
    }));
  }
  for (const item of source.cartItems) {
    rows.push(rowFromResult(rows, item, {
      name: item.shapeName,
      shape: item.shapeId,
      material: source.materialId,
    }));
  }
  if (rows.length === 0 && source.effectiveResult) {
    rows.push(rowFromResult(rows, source.effectiveResult, {
      name: source.selectedShapeName,
      shape: source.isSketchResult ? 'sketch' : source.selectedId,
      material: source.materialId,
    }));
  }
  return rows;
}

export function useBomExportActions({
  source,
  bomLabel,
  closeMenu,
}: {
  source: WorkspaceBomSource;
  bomLabel: string;
  closeMenu: () => void;
}) {
  const buildBomRows = useCallback(() => buildWorkspaceBomRows(source), [source]);
  const handleExportBomCSV = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomCSV(rows, `BOM_${bomLabel || 'export'}.csv`);
    closeMenu();
  }, [bomLabel, buildBomRows, closeMenu]);
  const handleExportBomExcel = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomExcel(rows, `BOM_${bomLabel || 'export'}.xls`);
    closeMenu();
  }, [bomLabel, buildBomRows, closeMenu]);

  return { buildBomRows, handleExportBomCSV, handleExportBomExcel };
}
