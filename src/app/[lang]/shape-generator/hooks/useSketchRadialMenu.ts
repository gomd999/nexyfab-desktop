'use client';

/**
 * useSketchRadialMenu — owns the 2D-sketch radial (pie) menu position +
 * visibility and its open/close primitives.
 *
 * Extracted from the ShapeGeneratorInner monolith alongside useContextMenu:
 * pure UI-local state, no CAD/scene coupling, so it lifts out verbatim.
 */

import { useCallback, useState } from 'react';

export interface SketchRadialState {
  visible: boolean;
  x: number;
  y: number;
}

export interface SketchRadialController {
  sketchRadial: SketchRadialState;
  openSketchRadial: (x: number, y: number) => void;
  closeSketchRadial: () => void;
}

export function useSketchRadialMenu(): SketchRadialController {
  const [sketchRadial, setSketchRadial] = useState<SketchRadialState>({ visible: false, x: 0, y: 0 });

  const openSketchRadial = useCallback((x: number, y: number) => {
    setSketchRadial({ x, y, visible: true });
  }, []);

  const closeSketchRadial = useCallback(() => {
    setSketchRadial((prev) => ({ ...prev, visible: false }));
  }, []);

  return { sketchRadial, openSketchRadial, closeSketchRadial };
}
