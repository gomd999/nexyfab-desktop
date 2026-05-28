'use client';

/**
 * AxisMethodPickerDialog.tsx — modal for creating a new ReferenceAxisNode.
 *
 * Wave 2 Phase 2 Track D Week 2. Mirrors PlaneMethodPickerDialog (see its
 * top-comment for the design rationale).
 */

import React, { useState } from 'react';
import {
  computeDependsOn,
  type AxisMethod,
  type AxisParams,
  type EdgeRef,
  type FaceRef,
  type PlaneRef,
  type PointRef,
  type ReferenceAxisNode,
  type StandardAxisId,
} from '../types';
import { REF_GEOM_METHOD_CATALOGUE } from './ReferenceGeometryDropdown';
import { DialogShell, FormRow, fieldStyle, newReferenceId } from './dialogShell';
import { pickRefGeomDict, axisMethodLabel, type RefGeomLang } from '../i18n';

export interface AxisMethodPickerDialogProps {
  readonly initialMethod?: AxisMethod;
  readonly onConfirm: (node: ReferenceAxisNode) => void;
  readonly onClose: () => void;
  /** Display language. Defaults to English. W4 — spec §13.4. */
  readonly lang?: RefGeomLang | string;
}

const STANDARD_AXIS_OPTIONS: ReadonlyArray<{ value: StandardAxisId; label: string }> = [
  { value: 'x', label: 'X axis' },
  { value: 'y', label: 'Y axis' },
  { value: 'z', label: 'Z axis' },
];

const DEFAULT_POINT_REF: PointRef = { kind: 'inline', position: [0, 0, 0] };
const DEFAULT_EDGE_REF: EdgeRef = { kind: 'edge', bodyId: '_pending_', edgeId: '_pending_' };
const DEFAULT_FACE_REF: FaceRef = { kind: 'face', bodyId: '_pending_', faceId: '_pending_' };
const DEFAULT_PLANE_REF: PlaneRef = { kind: 'standard', id: 'front' };

export default function AxisMethodPickerDialog(
  props: AxisMethodPickerDialogProps,
): React.ReactElement {
  const { initialMethod = 'standard', onConfirm, onClose, lang } = props;
  const [method, setMethod] = useState<AxisMethod>(initialMethod);
  const [standardId, setStandardId] = useState<StandardAxisId>('x');
  const dict = React.useMemo(() => pickRefGeomDict(lang), [lang]);
  const localizedMethods = React.useMemo(
    () =>
      REF_GEOM_METHOD_CATALOGUE.axis.map((m) => ({
        method: m.method,
        label: axisMethodLabel(dict, m.method),
      })),
    [dict],
  );
  // Pick placeholders (W3 picker bus replaces).
  const [points] = useState<readonly [PointRef, PointRef]>([
    DEFAULT_POINT_REF,
    DEFAULT_POINT_REF,
  ]);
  const [pickedEdge] = useState<EdgeRef>(DEFAULT_EDGE_REF);
  const [planeA] = useState<PlaneRef>(DEFAULT_PLANE_REF);
  const [planeB] = useState<PlaneRef>(DEFAULT_PLANE_REF);
  const [normalPlane] = useState<PlaneRef>(DEFAULT_PLANE_REF);
  const [normalAtPoint] = useState<PointRef>(DEFAULT_POINT_REF);
  const [cylinderFace] = useState<FaceRef>(DEFAULT_FACE_REF);

  function buildParams(): AxisParams {
    switch (method) {
      case 'standard':
        return { method: 'standard', id: standardId };
      case 'through2Points':
        return { method: 'through2Points', points };
      case 'alongEdge':
        return { method: 'alongEdge', edge: pickedEdge };
      case 'twoPlaneIntersect':
        return { method: 'twoPlaneIntersect', a: planeA, b: planeB };
      case 'normalToPlaneAtPoint':
        return {
          method: 'normalToPlaneAtPoint',
          plane: normalPlane,
          point: normalAtPoint,
        };
      case 'cylinderConeAxis':
        return { method: 'cylinderConeAxis', face: cylinderFace };
    }
  }

  function handleConfirm(): void {
    const params = buildParams();
    const draft = {
      id: newReferenceId(),
      kind: 'axis' as const,
      method,
      label: `Axis ${method}`,
      hidden: false,
      params,
      evaluatedAt: 0,
      dependsOn: [] as readonly string[],
    } as ReferenceAxisNode;
    onConfirm({ ...draft, dependsOn: computeDependsOn(draft) } as ReferenceAxisNode);
  }

  function renderParams(): React.ReactElement {
    switch (method) {
      case 'standard':
        return (
          <FormRow label="Standard axis">
            <select
              value={standardId}
              onChange={(e) => setStandardId(e.target.value as StandardAxisId)}
              style={fieldStyle}
              data-testid="axis-standard-select"
            >
              {STANDARD_AXIS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </FormRow>
        );
      case 'through2Points':
        return (
          <>
            <FormRow label="Point 1 (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Point 2 (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'alongEdge':
        return (
          <FormRow label="Edge (W3 pick)">
            <input value="<edge pending>" disabled style={fieldStyle} />
          </FormRow>
        );
      case 'twoPlaneIntersect':
        return (
          <>
            <FormRow label="Plane A (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane B (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'normalToPlaneAtPoint':
        return (
          <>
            <FormRow label="Plane (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="At point (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'cylinderConeAxis':
        return (
          <FormRow label="Cylinder / cone face (W3 pick)">
            <input value="<face pending>" disabled style={fieldStyle} />
          </FormRow>
        );
    }
  }

  return (
    <DialogShell<AxisMethod>
      title={dict.dialogTitleAxis}
      methods={localizedMethods}
      activeMethod={method}
      onMethodChange={setMethod}
      onClose={onClose}
      onConfirm={handleConfirm}
      testId="axis-method-picker"
      confirmLabel={dict.insert}
      cancelLabel={dict.cancel}
      closeLabel={dict.close}
    >
      {renderParams()}
    </DialogShell>
  );
}
