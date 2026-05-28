'use client';

/**
 * PlaneMethodPickerDialog.tsx — modal for creating a new ReferencePlaneNode.
 *
 * Wave 2 Phase 2 Track D Week 2. Spec §13.2.
 *
 * Scope (W2):
 *   - Renders forms for the 8 plane methods (spec §2.1–§2.8).
 *   - For "pick from viewport" inputs (face / edge / vertex), the dialog
 *     accepts a serialised picker placeholder string (e.g. an empty
 *     PlaneRef of kind 'standard'). Real viewport picking lands W3 when
 *     the picker bus + scene state wires up.
 *   - On confirm, builds the discriminated `PlaneParams` and emits a
 *     ready-to-insert `ReferencePlaneNode` via `props.onConfirm`.
 *   - The dialog does NOT call `useReferenceGeometryStore` directly so
 *     it can be exercised in unit tests without store side-effects.
 *
 * The template established here (state-per-method, form atoms from
 * `dialogShell`, single `buildParams()` switch on confirm) is reused by
 * `AxisMethodPickerDialog`, `PointMethodPickerDialog`, and
 * `CsysMethodPickerDialog`.
 */

import React, { useState } from 'react';
import {
  computeDependsOn,
  type PlaneMethod,
  type PlaneParams,
  type PlaneRef,
  type PointRef,
  type AxisRef,
  type ReferencePlaneNode,
  type StandardPlaneId,
} from '../types';
import { REF_GEOM_METHOD_CATALOGUE } from './ReferenceGeometryDropdown';
import { DialogShell, FormRow, fieldStyle, newReferenceId } from './dialogShell';
import { pickRefGeomDict, planeMethodLabel, type RefGeomLang } from '../i18n';

export interface PlaneMethodPickerDialogProps {
  /** Initial method shown when the dialog opens — usually the one the
   *  toolbar dropdown selected. */
  readonly initialMethod?: PlaneMethod;
  readonly onConfirm: (node: ReferencePlaneNode) => void;
  readonly onClose: () => void;
  /** Display language for the dialog title + method-list labels +
   *  insert/cancel buttons. Defaults to `'en'` — existing UI behaviour
   *  preserved. W4 — spec §13.4. */
  readonly lang?: RefGeomLang | string;
}

/** Standard plane options shown in the "Standard" method form. */
const STANDARD_OPTIONS: ReadonlyArray<{ value: StandardPlaneId; label: string }> = [
  { value: 'front', label: 'Front' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
];

/** Placeholder PlaneRef used when a "pick parent plane" input has no
 *  value yet. W3 swaps this for live viewport picks. */
const DEFAULT_PARENT_PLANE: PlaneRef = { kind: 'standard', id: 'front' };

/** Placeholder PointRef. */
const DEFAULT_POINT_REF: PointRef = { kind: 'inline', position: [0, 0, 0] };

/** Placeholder AxisRef. */
const DEFAULT_AXIS_REF: AxisRef = { kind: 'standard', id: 'x' };

export default function PlaneMethodPickerDialog(
  props: PlaneMethodPickerDialogProps,
): React.ReactElement {
  const { initialMethod = 'standard', onConfirm, onClose, lang } = props;
  const [method, setMethod] = useState<PlaneMethod>(initialMethod);
  const dict = React.useMemo(() => pickRefGeomDict(lang), [lang]);
  const localizedMethods = React.useMemo(
    () =>
      REF_GEOM_METHOD_CATALOGUE.plane.map((m) => ({
        method: m.method,
        label: planeMethodLabel(dict, m.method),
      })),
    [dict],
  );

  // Form fields per method. We keep them as a flat shape so switching
  // methods is cheap; only the active fields are read on confirm.
  const [standardId, setStandardId] = useState<StandardPlaneId>('front');
  const [offsetDistance, setOffsetDistance] = useState<number>(10);
  const [offsetDirection, setOffsetDirection] = useState<1 | -1>(1);
  const [angleDeg, setAngleDeg] = useState<number>(45);
  const [angleFlip, setAngleFlip] = useState<boolean>(false);
  // Pick targets — placeholders that the W3 picker bus will replace.
  const [parentPlane] = useState<PlaneRef>(DEFAULT_PARENT_PLANE);
  const [secondaryPlane] = useState<PlaneRef>(DEFAULT_PARENT_PLANE);
  const [pickedPoints] = useState<readonly [PointRef, PointRef, PointRef]>([
    DEFAULT_POINT_REF,
    DEFAULT_POINT_REF,
    DEFAULT_POINT_REF,
  ]);
  const [pickedPoint] = useState<PointRef>(DEFAULT_POINT_REF);
  const [pickedAxis] = useState<AxisRef>(DEFAULT_AXIS_REF);

  // Build the params object for the currently-selected method. Pure —
  // safe to call from confirm and from the "is the form complete?" check.
  function buildParams(): PlaneParams {
    switch (method) {
      case 'standard':
        return { method: 'standard', id: standardId };
      case 'offset':
        return {
          method: 'offset',
          parent: parentPlane,
          distanceMm: offsetDistance,
          direction: offsetDirection,
        };
      case 'angle':
        return {
          method: 'angle',
          parent: parentPlane,
          axis: pickedAxis,
          angleDeg,
          flip: angleFlip,
        };
      case 'through3Points':
        return { method: 'through3Points', points: pickedPoints };
      case 'parallelThroughPoint':
        return { method: 'parallelThroughPoint', parent: parentPlane, point: pickedPoint };
      case 'midBetween':
        return { method: 'midBetween', a: parentPlane, b: secondaryPlane };
      case 'throughLineAndPoint':
        return { method: 'throughLineAndPoint', line: pickedAxis, point: pickedPoint };
      case 'tangentToCylinder':
        // Face ref is a "pick from viewport" — we placeholder with a
        // synthetic bodyId/faceId. The W3 picker bus replaces these.
        return {
          method: 'tangentToCylinder',
          face: { kind: 'face', bodyId: '_pending_', faceId: '_pending_' },
          refPlane: parentPlane,
        };
    }
  }

  // Confirm-disabled gate. Numeric inputs must be finite; pick targets
  // are tolerated as placeholders (the picker bus enforces W3+).
  function isValid(): boolean {
    switch (method) {
      case 'offset':
        return Number.isFinite(offsetDistance) && offsetDistance !== 0;
      case 'angle':
        return Number.isFinite(angleDeg);
      default:
        return true;
    }
  }

  function handleConfirm(): void {
    if (!isValid()) return;
    const params = buildParams();
    const draft = {
      id: newReferenceId(),
      kind: 'plane' as const,
      method,
      label: `Plane ${method}`,
      hidden: false,
      params,
      evaluatedAt: 0,
      dependsOn: [] as readonly string[],
    } as ReferencePlaneNode;
    const node: ReferencePlaneNode = {
      ...draft,
      dependsOn: computeDependsOn(draft),
    } as ReferencePlaneNode;
    onConfirm(node);
  }

  // Per-method param forms. Kept inline because they're small and
  // duplicating an abstraction across 8 methods costs more than it saves.
  function renderParams(): React.ReactElement {
    switch (method) {
      case 'standard':
        return (
          <FormRow label="Standard plane">
            <select
              value={standardId}
              onChange={(e) => setStandardId(e.target.value as StandardPlaneId)}
              style={fieldStyle}
              data-testid="plane-standard-select"
            >
              {STANDARD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormRow>
        );
      case 'offset':
        return (
          <>
            <FormRow label="Parent plane (W3 viewport pick)">
              <input value={refSummary(parentPlane)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Distance (mm)">
              <input
                type="number"
                value={offsetDistance}
                onChange={(e) => setOffsetDistance(Number(e.target.value))}
                style={fieldStyle}
                data-testid="plane-offset-distance"
              />
            </FormRow>
            <FormRow label="Direction">
              <label style={{ display: 'inline-flex', gap: 8, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={offsetDirection === -1}
                  onChange={(e) => setOffsetDirection(e.target.checked ? -1 : 1)}
                  data-testid="plane-offset-flip"
                />
                <span>Flip normal</span>
              </label>
            </FormRow>
          </>
        );
      case 'angle':
        return (
          <>
            <FormRow label="Parent plane (W3 pick)">
              <input value={refSummary(parentPlane)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Axis of rotation (W3 pick)">
              <input value={refSummary(pickedAxis)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Angle (deg)">
              <input
                type="number"
                value={angleDeg}
                onChange={(e) => setAngleDeg(Number(e.target.value))}
                style={fieldStyle}
                data-testid="plane-angle-deg"
              />
            </FormRow>
            <FormRow label="Flip">
              <input
                type="checkbox"
                checked={angleFlip}
                onChange={(e) => setAngleFlip(e.target.checked)}
              />
            </FormRow>
          </>
        );
      case 'through3Points':
        return (
          <>
            <FormRow label="Point 1 (W3 pick)">
              <input value={refSummary(pickedPoints[0])} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Point 2 (W3 pick)">
              <input value={refSummary(pickedPoints[1])} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Point 3 (W3 pick)">
              <input value={refSummary(pickedPoints[2])} disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'parallelThroughPoint':
        return (
          <>
            <FormRow label="Parent plane (W3 pick)">
              <input value={refSummary(parentPlane)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Through point (W3 pick)">
              <input value={refSummary(pickedPoint)} disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'midBetween':
        return (
          <>
            <FormRow label="Plane A (W3 pick)">
              <input value={refSummary(parentPlane)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane B (W3 pick)">
              <input value={refSummary(secondaryPlane)} disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'throughLineAndPoint':
        return (
          <>
            <FormRow label="Line / axis (W3 pick)">
              <input value={refSummary(pickedAxis)} disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Point (W3 pick)">
              <input value={refSummary(pickedPoint)} disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'tangentToCylinder':
        return (
          <>
            <FormRow label="Cylindrical face (W3 pick)">
              <input value="<face pending viewport pick>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Reference plane (W3 pick)">
              <input value={refSummary(parentPlane)} disabled style={fieldStyle} />
            </FormRow>
          </>
        );
    }
  }

  return (
    <DialogShell<PlaneMethod>
      title={dict.dialogTitlePlane}
      methods={localizedMethods}
      activeMethod={method}
      onMethodChange={setMethod}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmDisabled={!isValid()}
      testId="plane-method-picker"
      confirmLabel={dict.insert}
      cancelLabel={dict.cancel}
      closeLabel={dict.close}
    >
      {renderParams()}
    </DialogShell>
  );
}

/** Small label for a PlaneRef/AxisRef/PointRef placeholder field. */
function refSummary(r: PlaneRef | AxisRef | PointRef): string {
  switch (r.kind) {
    case 'standard':
      return `Standard: ${r.id}`;
    case 'reference':
      return `Ref node: ${r.nodeId}`;
    case 'face':
      return `Face: ${r.bodyId}/${r.faceId}`;
    case 'edge':
      return `Edge: ${r.bodyId}/${r.edgeId}`;
    case 'vertex':
      return `Vertex: ${r.bodyId}/${r.vertexId}`;
    case 'inline':
      return 'Inline frame';
  }
}
