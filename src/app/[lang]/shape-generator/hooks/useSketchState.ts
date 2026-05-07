/**
 * useSketchState — extracted from shape-generator/page.tsx
 *
 * Consolidates all sketch-related local state (profiles, constraints,
 * dimensions, history, action-menu visibility) that were previously
 * inlined in ShapeGeneratorInner.
 */

import { useState } from 'react';
import { loadSketchHistory } from '../sketch/SketchHistory';
import type {
  SketchProfile,
  SketchConstraint,
  SketchDimension,
  ConstraintType,
} from '../sketch/types';
import type { SketchHistoryEntry } from '../sketch/SketchHistory';

export function useSketchState() {
  // ── Multi-profile state ───────────────────────────────────────────────────
  const [sketchProfiles, setSketchProfiles] = useState<SketchProfile[]>([
    { segments: [], closed: false },
  ]);
  const [activeProfileIdx, setActiveProfileIdx] = useState(0);

  // ── Operation mode ────────────────────────────────────────────────────────
  const [sketchOperation, setSketchOperation] = useState<'add' | 'subtract'>('add');
  const [sketchPlaneOffset, setSketchPlaneOffset] = useState<number>(0);

  // ── Constraints / Dimensions ──────────────────────────────────────────────
  const [sketchConstraints, setSketchConstraints] = useState<SketchConstraint[]>([]);
  const [sketchDimensions, setSketchDimensions] = useState<SketchDimension[]>([]);
  const [selectedConstraintType, setSelectedConstraintType] = useState<ConstraintType>('horizontal');
  const [autoSolve, setAutoSolve] = useState(false);
  const [constraintStatus, setConstraintStatus] = useState<
    'ok' | 'over-defined' | 'under-defined' | 'inconsistent'
  >('ok');
  const [constraintDiagnostic, setConstraintDiagnostic] = useState<{
    dof?: number;
    residual?: number;
    message?: string;
    unsatisfiedCount?: number;
    redundant?: string[];
    onRemoveRedundant?: (id: string) => void;
  }>({});

  // ── History ───────────────────────────────────────────────────────────────
  const [sketchHistory, setSketchHistory] = useState<SketchHistoryEntry[]>(
    () => loadSketchHistory(),
  );
  const [showSketchHistory, setShowSketchHistory] = useState(false);
  const [editingSketchFeatureId, setEditingSketchFeatureId] = useState<string | null>(null);

  // ── Post-close action menu ────────────────────────────────────────────────
  const [showSketchActionMenu, setShowSketchActionMenu] = useState(false);

  return {
    // Multi-profile
    sketchProfiles, setSketchProfiles,
    activeProfileIdx, setActiveProfileIdx,
    // Operation
    sketchOperation, setSketchOperation,
    sketchPlaneOffset, setSketchPlaneOffset,
    // Constraints
    sketchConstraints, setSketchConstraints,
    sketchDimensions, setSketchDimensions,
    selectedConstraintType, setSelectedConstraintType,
    autoSolve, setAutoSolve,
    constraintStatus, setConstraintStatus,
    constraintDiagnostic, setConstraintDiagnostic,
    // History
    sketchHistory, setSketchHistory,
    showSketchHistory, setShowSketchHistory,
    editingSketchFeatureId, setEditingSketchFeatureId,
    // Action menu
    showSketchActionMenu, setShowSketchActionMenu,
  };
}
