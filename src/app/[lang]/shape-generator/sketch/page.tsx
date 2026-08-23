'use client';

import ShapeGeneratorClientPage from '../ShapeGeneratorClientPage';

/** Sketch-first entry; URL stays under `/shape-generator/sketch` (see ShapeGeneratorInner path routing). */
export default function SketchPage() {
  return <ShapeGeneratorClientPage initialMode="expert" />;
}
