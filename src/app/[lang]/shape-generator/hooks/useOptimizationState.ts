'use client';

import { useState, useCallback } from 'react';
import * as THREE from 'three';
import type { Face, OptProgress, OptResult } from '../topology/optimizer/types';
import { MATERIALS } from '../topology/optimizer/types';

export const RESOLUTION_MAP: Record<'low' | 'medium' | 'high', { nx: number; ny: number; nz: number }> = {
  low: { nx: 16, ny: 8, nz: 16 },
  medium: { nx: 24, ny: 12, nz: 24 },
  high: { nx: 32, ny: 16, nz: 32 },
};

export interface OptimizationState {
  dimX: number;
  setDimX: React.Dispatch<React.SetStateAction<number>>;
  dimY: number;
  setDimY: React.Dispatch<React.SetStateAction<number>>;
  dimZ: number;
  setDimZ: React.Dispatch<React.SetStateAction<number>>;
  materialKey: string;
  setMaterialKey: React.Dispatch<React.SetStateAction<string>>;
  fixedFaces: Face[];
  setFixedFaces: React.Dispatch<React.SetStateAction<Face[]>>;
  loads: Array<{ face: Face; force: [number, number, number] }>;
  setLoads: React.Dispatch<React.SetStateAction<Array<{ face: Face; force: [number, number, number] }>>>;
  volfrac: number;
  setVolfrac: React.Dispatch<React.SetStateAction<number>>;
  resolution: 'low' | 'medium' | 'high';
  setResolution: React.Dispatch<React.SetStateAction<'low' | 'medium' | 'high'>>;
  penal: number;
  setPenal: React.Dispatch<React.SetStateAction<number>>;
  rmin: number;
  setRmin: React.Dispatch<React.SetStateAction<number>>;
  maxIter: number;
  setMaxIter: React.Dispatch<React.SetStateAction<number>>;
  selectionMode: 'none' | 'fixed' | 'load';
  setSelectionMode: React.Dispatch<React.SetStateAction<'none' | 'fixed' | 'load'>>;
  isOptimizing: boolean;
  setIsOptimizing: React.Dispatch<React.SetStateAction<boolean>>;
  progress: OptProgress | null;
  setProgress: React.Dispatch<React.SetStateAction<OptProgress | null>>;
  optResult: OptResult | null;
  setOptResult: React.Dispatch<React.SetStateAction<OptResult | null>>;
  resultMesh: THREE.BufferGeometry | null;
  setResultMesh: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  activeLoadForce: [number, number, number];
  setActiveLoadForce: React.Dispatch<React.SetStateAction<[number, number, number]>>;
  useCustomDomain: boolean;
  setUseCustomDomain: React.Dispatch<React.SetStateAction<boolean>>;
  customDomainGeometry: THREE.BufferGeometry | null;
  setCustomDomainGeometry: React.Dispatch<React.SetStateAction<THREE.BufferGeometry | null>>;
  handleGenerate: () => Promise<void>;
}

export function useOptimizationState(addToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void): OptimizationState {
  const [dimX, setDimX] = useState(200);
  const [dimY, setDimY] = useState(100);
  const [dimZ, setDimZ] = useState(200);
  const [materialKey, setMaterialKey] = useState('aluminum');
  const [fixedFaces, setFixedFaces] = useState<Face[]>([]);
  const [loads, setLoads] = useState<Array<{ face: Face; force: [number, number, number] }>>([]);
  const [volfrac, setVolfrac] = useState(0.4);
  const [resolution, setResolution] = useState<'low' | 'medium' | 'high'>('low');
  const [penal, setPenal] = useState(3);
  const [rmin, setRmin] = useState(1.5);
  const [maxIter, setMaxIter] = useState(50);
  const [selectionMode, setSelectionMode] = useState<'none' | 'fixed' | 'load'>('none');
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [progress, setProgress] = useState<OptProgress | null>(null);
  const [optResult, setOptResult] = useState<OptResult | null>(null);
  const [resultMesh, setResultMesh] = useState<THREE.BufferGeometry | null>(null);
  const [activeLoadForce, setActiveLoadForce] = useState<[number, number, number]>([0, -1000, 0]);
  const [useCustomDomain, setUseCustomDomain] = useState(false);
  const [customDomainGeometry, setCustomDomainGeometry] = useState<THREE.BufferGeometry | null>(null);

  const handleGenerate = useCallback(async () => {
    if (fixedFaces.length === 0 || loads.length === 0) return;
    const { nx, ny, nz } = RESOLUTION_MAP[resolution];
    const material = MATERIALS[materialKey];
    let domainMask: Uint8Array | undefined;
    if (useCustomDomain && customDomainGeometry) {
      const { voxelizeMesh } = await import('../topology/optimizer/voxelizer');
      domainMask = voxelizeMesh(customDomainGeometry, nx, ny, nz, dimX, dimY, dimZ);
    }
    const config = {
      dimX, dimY, dimZ, nx, ny, nz, volfrac, penal, rmin, maxIter, material,
      boundary: { fixedFaces, loads },
      ...(domainMask ? { domainMask } : {}),
    };
    setIsOptimizing(true); setProgress(null); setOptResult(null); setResultMesh(null);
    try {
      const { runSIMP } = await import('../topology/optimizer/simp');
      const { densityToMesh } = await import('../topology/optimizer/marchingCubes');
      const res = await runSIMP(config, (p: OptProgress) => { setProgress({ ...p, densities: p.densities }); });
      setOptResult(res);
      setResultMesh(densityToMesh(res.densities, res.nx, res.ny, res.nz, res.dimX, res.dimY, res.dimZ, 0.3));
    } catch (err) { console.error('Optimization failed:', err); addToast('error', `Optimization failed: ${err instanceof Error ? err.message : 'Unknown error'}`); }
    finally { setIsOptimizing(false); }
  }, [dimX, dimY, dimZ, materialKey, fixedFaces, loads, volfrac, resolution, penal, rmin, maxIter, useCustomDomain, customDomainGeometry, addToast]);

  return {
    dimX, setDimX,
    dimY, setDimY,
    dimZ, setDimZ,
    materialKey, setMaterialKey,
    fixedFaces, setFixedFaces,
    loads, setLoads,
    volfrac, setVolfrac,
    resolution, setResolution,
    penal, setPenal,
    rmin, setRmin,
    maxIter, setMaxIter,
    selectionMode, setSelectionMode,
    isOptimizing, setIsOptimizing,
    progress, setProgress,
    optResult, setOptResult,
    resultMesh, setResultMesh,
    activeLoadForce, setActiveLoadForce,
    useCustomDomain, setUseCustomDomain,
    customDomainGeometry, setCustomDomainGeometry,
    handleGenerate,
  };
}
