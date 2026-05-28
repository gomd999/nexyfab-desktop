'use client';

/**
 * ReferenceGeometryDropdown.tsx — toolbar entry-point for ref-geom creation.
 *
 * Wave 2 Phase 2 Track D Week 2. Spec §13.1.
 *
 * Renders a single dropdown button labelled "Reference geometry" with four
 * category sub-menus (Plane / Axis / Point / CSys). Each sub-menu entry
 * opens the matching method-picker dialog via a `kind`/`method` callback.
 *
 * Scope (W2):
 *   - Pure presentation. The dialog open-state lives in the parent so the
 *     dropdown can be hosted in different toolbars without coupling.
 *   - No keyboard shortcuts yet (P / X / . / C from spec §13.1) — those
 *     ship with the broader ribbon-shortcut pass in W3.
 *   - English labels only. Korean canonical strings land W4 per project
 *     i18n policy.
 *
 * Why a single component instead of four buttons: the spec calls for one
 * compound toolbar entry so users learn "ref geom" as a feature group
 * rather than four disconnected buttons. The discoverability story
 * matches Onshape/Fusion's "Construct" menu.
 */

import React, { useEffect, useRef, useState } from 'react';
import type {
  AxisMethod,
  CsysMethod,
  PlaneMethod,
  PointMethod,
  ReferenceKind,
} from '../types';

export type AnyMethod = PlaneMethod | AxisMethod | PointMethod | CsysMethod;

export interface ReferenceGeometryDropdownProps {
  /** Called when the user picks a category + method. The parent opens
   *  the matching dialog (Plane/Axis/Point/Csys) using these args. */
  onPick: (kind: ReferenceKind, method: AnyMethod) => void;
  /** Optional disabled state — e.g. while a worker rebuild is in flight. */
  disabled?: boolean;
  /** Optional className for layout integration. */
  className?: string;
}

// ─── Method catalogues per kind ──────────────────────────────────────────
//
// Mirrors the unions in `referenceGeometry/types.ts`. The label set here is
// the *English* canonical for now; Korean strings come in W4 (spec §13.4).
// Order chosen to match Onshape's construct menu for muscle-memory.

interface MethodRow<M extends string> {
  readonly method: M;
  readonly label: string;
}

const PLANE_METHODS: ReadonlyArray<MethodRow<PlaneMethod>> = [
  { method: 'standard', label: 'Standard' },
  { method: 'offset', label: 'Offset' },
  { method: 'angle', label: 'Angle' },
  { method: 'through3Points', label: 'Through 3 points' },
  { method: 'parallelThroughPoint', label: 'Parallel through point' },
  { method: 'midBetween', label: 'Mid plane' },
  { method: 'throughLineAndPoint', label: 'Through line and point' },
  { method: 'tangentToCylinder', label: 'Tangent to cylinder' },
];

const AXIS_METHODS: ReadonlyArray<MethodRow<AxisMethod>> = [
  { method: 'standard', label: 'Standard' },
  { method: 'through2Points', label: 'Through 2 points' },
  { method: 'alongEdge', label: 'Along edge' },
  { method: 'twoPlaneIntersect', label: 'Intersection of 2 planes' },
  { method: 'normalToPlaneAtPoint', label: 'Normal to plane at point' },
  { method: 'cylinderConeAxis', label: 'Cylinder / cone axis' },
];

const POINT_METHODS: ReadonlyArray<MethodRow<PointMethod>> = [
  { method: 'byCoordinates', label: 'By coordinates' },
  { method: 'vertex', label: 'Vertex' },
  { method: 'midOfEdge', label: 'Midpoint of edge' },
  { method: 'centerOfFace', label: 'Center of face' },
  { method: 'intersectLineAndPlane', label: 'Line / plane intersection' },
  { method: 'intersectThreePlanes', label: 'Three-plane intersection' },
  { method: 'projectPointOntoPlane', label: 'Project point onto plane' },
];

const CSYS_METHODS: ReadonlyArray<MethodRow<CsysMethod>> = [
  { method: 'world', label: 'World' },
  { method: 'originAndTwoAxes', label: 'Origin + 2 axes' },
  { method: 'originAndPlane', label: 'Origin + plane' },
  { method: 'byFaceVertex', label: 'By face + vertex' },
];

// Expose method catalogues so dialogs can render in the same order
// without re-declaring them.
export const REF_GEOM_METHOD_CATALOGUE = {
  plane: PLANE_METHODS,
  axis: AXIS_METHODS,
  point: POINT_METHODS,
  csys: CSYS_METHODS,
} as const;

// ─── Styles (design-token based; matches IPShareConfirmModal idiom) ───────

const styles = {
  trigger: (disabled: boolean): React.CSSProperties => ({
    padding: '6px 10px',
    background: 'var(--nx-panel)',
    color: disabled ? 'var(--nx-text-3)' : 'var(--nx-text)',
    border: '1px solid var(--nx-border)',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  }),
  menu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    background: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 8,
    boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    padding: 4,
    minWidth: 200,
    zIndex: 500,
  } as React.CSSProperties,
  category: (active: boolean): React.CSSProperties => ({
    position: 'relative',
    padding: '8px 10px',
    fontSize: 12,
    color: 'var(--nx-text)',
    background: active ? 'var(--nx-panel-2)' : 'transparent',
    borderRadius: 4,
    display: 'flex',
    justifyContent: 'space-between',
    cursor: 'default',
  }),
  submenu: {
    position: 'absolute',
    top: 0,
    left: '100%',
    marginLeft: 4,
    background: 'var(--nx-panel)',
    border: '1px solid var(--nx-border)',
    borderRadius: 8,
    boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    padding: 4,
    minWidth: 220,
  } as React.CSSProperties,
  methodRow: {
    padding: '6px 10px',
    fontSize: 12,
    color: 'var(--nx-text)',
    borderRadius: 4,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  methodRowHover: {
    background: 'var(--nx-panel-2)',
  },
};

interface CategoryDef {
  readonly kind: ReferenceKind;
  readonly label: string;
  readonly hotkey: string;
  readonly methods: ReadonlyArray<MethodRow<AnyMethod>>;
}

const CATEGORIES: readonly CategoryDef[] = [
  { kind: 'plane', label: 'Plane', hotkey: 'P', methods: PLANE_METHODS },
  { kind: 'axis', label: 'Axis', hotkey: 'X', methods: AXIS_METHODS },
  { kind: 'point', label: 'Point', hotkey: '.', methods: POINT_METHODS },
  { kind: 'csys', label: 'Coordinate System', hotkey: 'C', methods: CSYS_METHODS },
];

export default function ReferenceGeometryDropdown(
  props: ReferenceGeometryDropdownProps,
): React.ReactElement {
  const { onPick, disabled = false, className } = props;
  const [open, setOpen] = useState(false);
  const [hoverKind, setHoverKind] = useState<ReferenceKind | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click. Listener attached only when menu is open.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setHoverKind(null);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Close on Escape — accessibility table-stakes for a menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        setHoverKind(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const handlePick = (kind: ReferenceKind, method: AnyMethod): void => {
    setOpen(false);
    setHoverKind(null);
    onPick(kind, method);
  };

  return (
    <div
      ref={rootRef}
      className={className}
      style={{ position: 'relative', display: 'inline-block' }}
      data-testid="ref-geom-dropdown-root"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        style={styles.trigger(disabled)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="ref-geom-dropdown-trigger"
      >
        Reference geometry <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div role="menu" style={styles.menu}>
          {CATEGORIES.map((c) => (
            <div
              key={c.kind}
              role="menuitem"
              onMouseEnter={() => setHoverKind(c.kind)}
              style={styles.category(hoverKind === c.kind)}
              data-testid={`ref-geom-cat-${c.kind}`}
            >
              <span>{c.label}</span>
              <span aria-hidden style={{ opacity: 0.5, marginLeft: 12 }}>
                {c.hotkey} ›
              </span>
              {hoverKind === c.kind ? (
                <div role="menu" style={styles.submenu}>
                  {c.methods.map((m) => (
                    <SubmenuRow
                      key={m.method}
                      label={m.label}
                      onClick={() => handlePick(c.kind, m.method)}
                      testId={`ref-geom-method-${c.kind}-${m.method}`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SubmenuRowProps {
  readonly label: string;
  readonly onClick: () => void;
  readonly testId: string;
}

function SubmenuRow(props: SubmenuRowProps): React.ReactElement {
  const [hover, setHover] = useState(false);
  return (
    <div
      role="menuitem"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={props.onClick}
      style={{ ...styles.methodRow, ...(hover ? styles.methodRowHover : {}) }}
      data-testid={props.testId}
    >
      {props.label}
    </div>
  );
}
