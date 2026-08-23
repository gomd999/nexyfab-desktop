'use client';

import ShapeGeneratorClientPage from '../ShapeGeneratorClientPage';

/** Simulation / FEA workspace; URL stays under `/shape-generator/analysis`. */
export default function AnalysisPage() {
  return <ShapeGeneratorClientPage initialMode="expert" />;
}
