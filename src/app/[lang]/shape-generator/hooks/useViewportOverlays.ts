'use client';

/**
 * useViewportOverlays — owns the two optional viewport overlay geometries that
 * temporarily replace the part in the 3D view: the generative-design preview
 * and the thermal heat-map. Pure UI display state (the geometries are produced
 * by analysis panels and pushed in via the setters), so it lifts cleanly out of
 * the ShapeGeneratorInner monolith.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';
import type * as THREE from 'three';

export interface ViewportOverlays {
  genDesignResult: THREE.BufferGeometry | null;
  setGenDesignResult: Dispatch<SetStateAction<THREE.BufferGeometry | null>>;
  showGenOverlay: boolean;
  setShowGenOverlay: Dispatch<SetStateAction<boolean>>;
  thermalOverlayGeo: THREE.BufferGeometry | null;
  setThermalOverlayGeo: Dispatch<SetStateAction<THREE.BufferGeometry | null>>;
  showThermalOverlay: boolean;
  setShowThermalOverlay: Dispatch<SetStateAction<boolean>>;
}

export function useViewportOverlays(): ViewportOverlays {
  const [genDesignResult, setGenDesignResult] = useState<THREE.BufferGeometry | null>(null);
  const [showGenOverlay, setShowGenOverlay] = useState(false);
  const [thermalOverlayGeo, setThermalOverlayGeo] = useState<THREE.BufferGeometry | null>(null);
  const [showThermalOverlay, setShowThermalOverlay] = useState(false);

  return {
    genDesignResult, setGenDesignResult,
    showGenOverlay, setShowGenOverlay,
    thermalOverlayGeo, setThermalOverlayGeo,
    showThermalOverlay, setShowThermalOverlay,
  };
}
