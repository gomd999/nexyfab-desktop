import { useCallback } from 'react';
import { Vector3 } from 'three';
import type * as THREE from 'three';
import type { BomPartResult } from '../ShapePreview';
import type { ShapeResult } from '../shapes';

/**
 * Step 5.2 of the MainWorkspace decomposition plan
 * (docs/strategy/mainworkspace-decomposition.md).
 *
 * Encapsulates the file-import flow that used to be a 42-line inline async
 * callback inside ShapeGeneratorInner's ShapePreview prop block. Moving it
 * out keeps the canvas region readable and lets a future MainWorkspace
 * component call this hook directly.
 */
export interface UseCanvasFileImportArgs {
  setImportedGeometry: (geo: THREE.BufferGeometry) => void;
  setSketchResult: (result: ShapeResult) => void;
  setBomParts: (parts: BomPartResult[]) => void;
  setBomLabel: (label: string) => void;
  setIsSketchMode: (value: boolean) => void;
  addToast: (type: 'success' | 'error' | 'info', message: string) => void;
  labels: {
    importedFile: (name: string) => string;
    importFailedFile: (reason: string) => string;
  };
}

export interface UseCanvasFileImportResult {
  onFileImport: (file: File) => Promise<void>;
}

export function useCanvasFileImport(
  args: UseCanvasFileImportArgs,
): UseCanvasFileImportResult {
  const {
    setImportedGeometry,
    setSketchResult,
    setBomParts,
    setBomLabel,
    setIsSketchMode,
    addToast,
    labels,
  } = args;

  const onFileImport = useCallback(async (file: File) => {
    try {
      const { prepareImportedShapeFromFile, pushRecentImportFile } = await import('../io/importMeshPipeline');
      const prepared = await prepareImportedShapeFromFile(file);
      const ext = prepared.filename.split('.').pop()?.toLowerCase() ?? '';
      setImportedGeometry(prepared.geometry);
      setSketchResult({
        geometry: prepared.geometry,
        edgeGeometry: prepared.edgeGeometry,
        volume_cm3: prepared.volume_cm3,
        surface_area_cm2: prepared.surface_area_cm2,
        bbox: prepared.bbox,
      });

      // Multi-part STEP / assembly imports flow into the BOM panel so users
      // can manage each piece independently. Single-part files clear any
      // stale BOM rows from a prior import.
      if (prepared.parts && prepared.parts.length > 1) {
        const { makeEdges, meshVolume, meshSurfaceArea } = await import('../shapes');
        const bomResults = prepared.parts.map(p => {
          const pGeo = p.geometry;
          const pEdge = makeEdges(pGeo);
          pGeo.computeBoundingBox();
          const pBb = pGeo.boundingBox;
          const pSize = pBb ? new Vector3() : null;
          if (pBb && pSize) pBb.getSize(pSize);
          const pBbox = pSize
            ? { w: Math.round(pSize.x), h: Math.round(pSize.y), d: Math.round(pSize.z) }
            : { w: 0, h: 0, d: 0 };
          return {
            name: p.name,
            result: {
              geometry: pGeo,
              edgeGeometry: pEdge,
              volume_cm3: meshVolume(pGeo) / 1000,
              surface_area_cm2: meshSurfaceArea(pGeo) / 100,
              bbox: pBbox,
            },
          };
        });
        setBomParts(bomResults);
        setBomLabel(prepared.filename);
      } else {
        setBomParts([]);
        setBomLabel('');
      }

      setIsSketchMode(false);
      pushRecentImportFile(prepared.filename, ext, file.size);
      addToast('success', labels.importedFile(prepared.filename));
    } catch (err) {
      addToast('error', labels.importFailedFile(err instanceof Error ? err.message : String(err)));
    }
  }, [setImportedGeometry, setSketchResult, setBomParts, setBomLabel, setIsSketchMode, addToast, labels]);

  return { onFileImport };
}
