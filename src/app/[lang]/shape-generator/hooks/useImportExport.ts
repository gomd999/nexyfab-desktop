'use client';

import { useState, useCallback, useRef } from 'react';
import * as THREE from 'three';
import type { ShapeResult } from '../shapes';
import { makeEdges, meshVolume, meshSurfaceArea } from '../shapes';

export interface ImportExportState {
  importedGeometry: THREE.BufferGeometry | null;
  setImportedGeometry: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  importedFilename: string;
  setImportedFilename: React.Dispatch<React.SetStateAction<string>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImportFile: () => void;
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { importFile } = await import('../io/importers');
      const { geometry, filename } = await importFile(file);
      const edgeGeometry = makeEdges(geometry);
      const volume_cm3 = meshVolume(geometry) / 1000;
      const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const size = bb.getSize(new THREE.Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setImportedGeometry(geometry);
      setImportedFilename(filename);
      setSketchResult({ geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
      setBomParts([]); setBomLabel('');
      setIsSketchMode(false);
      // Save to recent files
      try {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const recent = JSON.parse(localStorage.getItem('nf_recent_files') || '[]');
        const entry = { name: filename, ext, size: file.size, date: Date.now() };
        const updated = [entry, ...recent.filter((r: any) => r.name !== filename)].slice(0, 5);
        localStorage.setItem('nf_recent_files', JSON.stringify(updated));
      } catch { /* localStorage unavailable */ }
      addToast('success', `Imported "${filename}" successfully`);
    } catch (err) {
      console.error('Import failed:', err);
      addToast('error', `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    e.target.value = '';
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
    exportSTL(geo, activeTab === 'optimize' ? 'generative-design' : 'shape-design');
    addToast('success', 'STL exported successfully');
  }, [activeTab, resultMesh, getEffectiveGeometry, addToast]);

  const handleExportOBJ = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    const { exportOBJ } = await import('../io/exporters');
    exportOBJ(geo, 'shape-design');
    addToast('success', 'OBJ exported successfully');
  }, [getEffectiveGeometry, addToast]);

  const handleExportPLY = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    const { exportPLY } = await import('../io/exporters');
    exportPLY(geo, 'shape-design');
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
    export3MF(geo, activeTab === 'optimize' ? 'generative-design' : 'shape-design');
    addToast('success', '3MF exported successfully');
  }, [activeTab, resultMesh, getEffectiveGeometry, addToast]);

  return {
    importedGeometry, setImportedGeometry,
    importedFilename, setImportedFilename,
    fileInputRef,
    handleImportFile,
    handleFileSelected,
    handleExportCurrentSTL,
    handleExportOBJ,
    handleExportPLY,
    handleExport3MF,
  };
}
