'use client';

/**
 * PointMethodPickerDialog.tsx — modal for creating a new ReferencePointNode.
 *
 * Wave 2 Phase 2 Track D Week 2. Mirrors PlaneMethodPickerDialog.
 */

import React, { useState } from 'react';
import {
  computeDependsOn,
  type AxisRef,
  type EdgeRef,
  type FaceRef,
  type PlaneRef,
  type PointMethod,
  type PointParams,
  type PointRef,
  type ReferencePointNode,
  type Vec3,
  type VertexRef,
} from '../types';
import { REF_GEOM_METHOD_CATALOGUE } from './ReferenceGeometryDropdown';
import { DialogShell, FormRow, fieldStyle, newReferenceId } from './dialogShell';
import { pickRefGeomDict, pointMethodLabel, type RefGeomLang } from '../i18n';

export interface PointMethodPickerDialogProps {
  readonly initialMethod?: PointMethod;
  readonly onConfirm: (node: ReferencePointNode) => void;
  readonly onClose: () => void;
  /** Display language. Defaults to English. W4 — spec §13.4. */
  readonly lang?: RefGeomLang | string;
}

const DEFAULT_PLANE_REF: PlaneRef = { kind: 'standard', id: 'front' };
const DEFAULT_AXIS_REF: AxisRef = { kind: 'standard', id: 'x' };
const DEFAULT_POINT_REF: PointRef = { kind: 'inline', position: [0, 0, 0] };
const DEFAULT_EDGE_REF: EdgeRef = { kind: 'edge', bodyId: '_pending_', edgeId: '_pending_' };
const DEFAULT_FACE_REF: FaceRef = { kind: 'face', bodyId: '_pending_', faceId: '_pending_' };
const DEFAULT_VERTEX_REF: VertexRef = {
  kind: 'vertex',
  bodyId: '_pending_',
  vertexId: '_pending_',
};

export default function PointMethodPickerDialog(
  props: PointMethodPickerDialogProps,
): React.ReactElement {
  const { initialMethod = 'byCoordinates', onConfirm, onClose, lang } = props;
  const [method, setMethod] = useState<PointMethod>(initialMethod);
  const dict = React.useMemo(() => pickRefGeomDict(lang), [lang]);
  const localizedMethods = React.useMemo(
    () =>
      REF_GEOM_METHOD_CATALOGUE.point.map((m) => ({
        method: m.method,
        label: pointMethodLabel(dict, m.method),
      })),
    [dict],
  );

  // byCoordinates fields.
  const [px, setPx] = useState<number>(0);
  const [py, setPy] = useState<number>(0);
  const [pz, setPz] = useState<number>(0);
  // Pick placeholders.
  const [pickedVertex] = useState<VertexRef>(DEFAULT_VERTEX_REF);
  const [pickedEdge] = useState<EdgeRef>(DEFAULT_EDGE_REF);
  const [pickedFace] = useState<FaceRef>(DEFAULT_FACE_REF);
  const [pickedLine] = useState<AxisRef>(DEFAULT_AXIS_REF);
  const [pickedPlane] = useState<PlaneRef>(DEFAULT_PLANE_REF);
  const [pickedPlanes] = useState<readonly [PlaneRef, PlaneRef, PlaneRef]>([
    DEFAULT_PLANE_REF,
    DEFAULT_PLANE_REF,
    DEFAULT_PLANE_REF,
  ]);
  const [projectedPoint] = useState<PointRef>(DEFAULT_POINT_REF);

  function buildParams(): PointParams {
    switch (method) {
      case 'vertex':
        return { method: 'vertex', vertex: pickedVertex };
      case 'midOfEdge':
        return { method: 'midOfEdge', edge: pickedEdge };
      case 'centerOfFace':
        return { method: 'centerOfFace', face: pickedFace };
      case 'intersectLineAndPlane':
        return {
          method: 'intersectLineAndPlane',
          line: pickedLine,
          plane: pickedPlane,
        };
      case 'intersectThreePlanes':
        return { method: 'intersectThreePlanes', planes: pickedPlanes };
      case 'projectPointOntoPlane':
        return {
          method: 'projectPointOntoPlane',
          point: projectedPoint,
          plane: pickedPlane,
        };
      case 'byCoordinates': {
        const pos: Vec3 = [px, py, pz];
        return { method: 'byCoordinates', position: pos };
      }
    }
  }

  function isValid(): boolean {
    if (method === 'byCoordinates') {
      return [px, py, pz].every(Number.isFinite);
    }
    return true;
  }

  function handleConfirm(): void {
    if (!isValid()) return;
    const params = buildParams();
    const draft = {
      id: newReferenceId(),
      kind: 'point' as const,
      method,
      label: `Point ${method}`,
      hidden: false,
      params,
      evaluatedAt: 0,
      dependsOn: [] as readonly string[],
    } as ReferencePointNode;
    onConfirm({ ...draft, dependsOn: computeDependsOn(draft) } as ReferencePointNode);
  }

  function renderParams(): React.ReactElement {
    switch (method) {
      case 'byCoordinates':
        return (
          <>
            <FormRow label="X (mm)">
              <input
                type="number"
                value={px}
                onChange={(e) => setPx(Number(e.target.value))}
                style={fieldStyle}
                data-testid="point-coord-x"
              />
            </FormRow>
            <FormRow label="Y (mm)">
              <input
                type="number"
                value={py}
                onChange={(e) => setPy(Number(e.target.value))}
                style={fieldStyle}
                data-testid="point-coord-y"
              />
            </FormRow>
            <FormRow label="Z (mm)">
              <input
                type="number"
                value={pz}
                onChange={(e) => setPz(Number(e.target.value))}
                style={fieldStyle}
                data-testid="point-coord-z"
              />
            </FormRow>
          </>
        );
      case 'vertex':
        return (
          <FormRow label="Vertex (W3 pick)">
            <input value="<vertex pending>" disabled style={fieldStyle} />
          </FormRow>
        );
      case 'midOfEdge':
        return (
          <FormRow label="Edge (W3 pick)">
            <input value="<edge pending>" disabled style={fieldStyle} />
          </FormRow>
        );
      case 'centerOfFace':
        return (
          <FormRow label="Face (W3 pick)">
            <input value="<face pending>" disabled style={fieldStyle} />
          </FormRow>
        );
      case 'intersectLineAndPlane':
        return (
          <>
            <FormRow label="Line (W3 pick)">
              <input value="Standard: x" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'intersectThreePlanes':
        return (
          <>
            <FormRow label="Plane 1 (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane 2 (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane 3 (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'projectPointOntoPlane':
        return (
          <>
            <FormRow label="Point (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
    }
  }

  return (
    <DialogShell<PointMethod>
      title={dict.dialogTitlePoint}
      methods={localizedMethods}
      activeMethod={method}
      onMethodChange={setMethod}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmDisabled={!isValid()}
      testId="point-method-picker"
      confirmLabel={dict.insert}
      cancelLabel={dict.cancel}
      closeLabel={dict.close}
    >
      {renderParams()}
    </DialogShell>
  );
}
