'use client';

/**
 * useSketchPaletteToggles — owns the sketch canvas/palette display toggles:
 * grid, snap, dimension overlay, constraint overlay, and profile highlight.
 * Pure UI display state (wired to the palette toolbar's onChange props and a
 * couple of context-menu actions), so it lifts cleanly out of the
 * ShapeGeneratorInner monolith.
 */

import { useState, type Dispatch, type SetStateAction } from 'react';

export interface SketchPaletteToggles {
  grid: boolean;
  setGrid: Dispatch<SetStateAction<boolean>>;
  snap: boolean;
  setSnap: Dispatch<SetStateAction<boolean>>;
  dims: boolean;
  setDims: Dispatch<SetStateAction<boolean>>;
  constraints: boolean;
  setConstraints: Dispatch<SetStateAction<boolean>>;
  profile: boolean;
  setProfile: Dispatch<SetStateAction<boolean>>;
}

export function useSketchPaletteToggles(): SketchPaletteToggles {
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [dims, setDims] = useState(true);
  const [constraints, setConstraints] = useState(true);
  const [profile, setProfile] = useState(true);
  return { grid, setGrid, snap, setSnap, dims, setDims, constraints, setConstraints, profile, setProfile };
}
