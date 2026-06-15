'use client';

/**
 * Direct preview route for the solver-backed SolverSketchEditor + the
 * Extrude wrapper. Accessible at /[lang]/shape-generator/sketch/solver.
 *
 *   planegcs solver sketch → ProfileInput → extrude IR → FeatureTree →
 *   /api/extrude-render → openscad CLI → SCAD + PNG + binary STL →
 *   Three.js StlViewer + PNG snapshots + SCAD preview
 */

import { use } from 'react';
import { SolverSketchPageContent } from './_content';

interface PageProps {
  params: Promise<{ lang: string }>;
}

export default function SolverSketchPage({ params }: PageProps): React.ReactElement {
  const { lang } = use(params);
  return <SolverSketchPageContent lang={lang} />;
}
