'use client';

import { useState, useCallback } from 'react';
import * as THREE from 'three';
import type { ShapeResult } from '../shapes';
import { pickImportMeshFile } from '@/lib/platform';
import { formatCadImportError } from '../io/formatCadImportError';
import { reportInfo } from '../lib/telemetry';

export interface ImportExportState {
  importedGeometry: THREE.BufferGeometry | null;
  setImportedGeometry: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  importedFilename: string;
  setImportedFilename: React.Dispatch<React.SetStateAction<string>>;
  handleImportFile: () => void;
  handleExportCurrentSTL: () => Promise<void>;
  handleExportOBJ: () => Promise<void>;
  handleExportPLY: () => Promise<void>;
  handleExport3MF: () => Promise<void>;
}

export function useImportExport(
  addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void,
  getEffectiveGeometry: () => THREE.BufferGeometry | null,
  setSketchResult: React.Dispatch<React.SetStateAction<ShapeResult | null>>,
  setBomParts: React.Dispatch<React.SetStateAction<any[]>>,
  setBomLabel: React.Dispatch<React.SetStateAction<string>>,
  setIsSketchMode: React.Dispatch<React.SetStateAction<boolean>>,
  activeTab: string,
  resultMesh: THREE.BufferGeometry | null,
): ImportExportState {
  const [importedGeometry, setImportedGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [importedFilename, setImportedFilename] = useState<string>('');

  const handleImportFile = useCallback(() => {
    void (async () => {
      let importFilename: string | undefined;
      try {
        const picked = await pickImportMeshFile();
        if (!picked) return;
        importFilename = picked.filename;
        const { prepareImportedShapeFromBuffer, pushRecentImportFile } = await import('../io/importMeshPipeline');
        const prepared = await prepareImportedShapeFromBuffer(picked.filename, picked.buffer);
        const ext = prepared.filename.split('.').pop()?.toLowerCase() || '';
        setImportedGeometry(prepared.geometry);
        setImportedFilename(prepared.filename);
        setSketchResult({
          geometry: prepared.geometry,
          edgeGeometry: prepared.edgeGeometry,
          volume_cm3: prepared.volume_cm3,
          surface_area_cm2: prepared.surface_area_cm2,
          bbox: prepared.bbox,
        });

        if (prepared.parts && prepared.parts.length > 1) {
          import('../shapes').then(({ makeEdges, meshVolume, meshSurfaceArea }) => {
            const bomResults = prepared.parts!.map(p => {
              const pGeo = p.geometry;
              const pEdge = makeEdges(pGeo);
              pGeo.computeBoundingBox();
              const pBb = pGeo.boundingBox;
              const pSize = pBb ? new THREE.Vector3() : null;
              if (pBb && pSize) pBb.getSize(pSize);
              const pBbox = pSize ? { w: Math.round(pSize.x), h: Math.round(pSize.y), d: Math.round(pSize.z) } : { w: 0, h: 0, d: 0 };
              return {
                name: p.name,
                result: { geometry: pGeo, edgeGeometry: pEdge, volume_cm3: meshVolume(pGeo) / 1000, surface_area_cm2: meshSurfaceArea(pGeo) / 100, bbox: pBbox }
              };
            });
            setBomParts(bomResults);
            setBomLabel(prepared.filename);
          });
        } else {
          setBomParts([]);
          setBomLabel('');
        }

        setIsSketchMode(false);
        pushRecentImportFile(prepared.filename, ext, picked.byteSize);
        addToast('success', `Imported "${prepared.filename}" successfully`);
      } catch (err) {
        console.error('Import failed:', err);
        addToast('error', formatCadImportError(err, { filename: importFilename }));
      }
    })();
  }, [addToast, setSketchResult, setBomParts, setBomLabel, setIsSketchMode]);

  const handleExportCurrentSTL = useCallback(async () => {
    const geo = activeTab === 'optimize' ? resultMesh : getEffectiveGeometry();
    if (!geo) return;
    // Validate geometry has actual content before export
    if (!geo.attributes.position || geo.attributes.position.count === 0) {
      console.warn('Cannot export: geometry is empty');
      addToast('warning', 'Cannot export: geometry is empty');
      return;
    }
    const { exportSTL } = await import('../topology/optimizer/stlExporter');
    await exportSTL(geo, activeTab === 'optimize' ? 'generative-design' : 'shape-design');
    reportInfo('mesh_export', 'stl_export', {
      format: 'stl',
      source: activeTab === 'optimize' ? 'generative-design' : 'shape-design',
    });
    addToast('success', 'STL exported successfully');
  }, [activeTab, resultMesh, getEffectiveGeometry, addToast]);

  const handleExportOBJ = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    const { exportOBJ } = await import('../io/exporters');
    await exportOBJ(geo, 'shape-design');
    reportInfo('mesh_export', 'obj_export', { format: 'obj', source: 'shape-design' });
    addToast('success', 'OBJ exported successfully');
  }, [getEffectiveGeometry, addToast]);

  const handleExportPLY = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    const { exportPLY } = await import('../io/exporters');
    await exportPLY(geo, 'shape-design');
    reportInfo('mesh_export', 'ply_export', { format: 'ply', source: 'shape-design' });
    addToast('success', 'PLY exported successfully');
  }, [getEffectiveGeometry, addToast]);

  const handleExport3MF = useCallback(async () => {
    const geo = activeTab === 'optimize' ? resultMesh : getEffectiveGeometry();
    if (!geo) return;
    if (!geo.attributes.position || geo.attributes.position.count === 0) {
      addToast('warning', 'Cannot export: geometry is empty');
      return;
    }
    const { export3MF } = await import('../io/exporters');
    await export3MF(geo, activeTab === 'optimize' ? 'generative-design' : 'shape-design');
    reportInfo('mesh_export', '3mf_export', {
      format: '3mf',
      source: activeTab === 'optimize' ? 'generative-design' : 'shape-design',
    });
    addToast('success', '3MF exported successfully');
  }, [activeTab, resultMesh, getEffectiveGeometry, addToast]);

  return {
    importedGeometry, setImportedGeometry,
    importedFilename, setImportedFilename,
    handleImportFile,
    handleExportCurrentSTL,
    handleExportOBJ,
    handleExportPLY,
    handleExport3MF,
  };
}
