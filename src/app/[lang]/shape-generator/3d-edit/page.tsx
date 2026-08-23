'use client';

import ShapeGeneratorClientPage from '../ShapeGeneratorClientPage';

/** Parametric 3D design workspace (not sketch-first, not simulation). */
export default function DirectEditPage() {
  return <ShapeGeneratorClientPage initialMode="expert" />;
}
