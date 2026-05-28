'use client';

/**
 * CsysMethodPickerDialog.tsx — modal for creating a new ReferenceCsysNode.
 *
 * Wave 2 Phase 2 Track D Week 2. Mirrors PlaneMethodPickerDialog.
 */

import React, { useState } from 'react';
import {
  computeDependsOn,
  type AxisRef,
  type CsysMethod,
  type CsysParams,
  type EdgeRef,
  type FaceRef,
  type PlaneRef,
  type PointRef,
  type ReferenceCsysNode,
  type VertexRef,
} from '../types';
import { REF_GEOM_METHOD_CATALOGUE } from './ReferenceGeometryDropdown';
import { DialogShell, FormRow, fieldStyle, newReferenceId } from './dialogShell';

export interface CsysMethodPickerDialogProps {
  readonly initialMethod?: CsysMethod;
  readonly onConfirm: (node: ReferenceCsysNode) => void;
  readonly onClose: () => void;
}

const DEFAULT_POINT_REF: PointRef = { kind: 'inline', position: [0, 0, 0] };
const DEFAULT_AXIS_X: AxisRef = { kind: 'standard', id: 'x' };
const DEFAULT_AXIS_Y: AxisRef = { kind: 'standard', id: 'y' };
const DEFAULT_PLANE_REF: PlaneRef = { kind: 'standard', id: 'front' };
const DEFAULT_FACE_REF: FaceRef = { kind: 'face', bodyId: '_pending_', faceId: '_pending_' };
const DEFAULT_VERTEX_REF: VertexRef = {
  kind: 'vertex',
  bodyId: '_pending_',
  vertexId: '_pending_',
};
const DEFAULT_EDGE_REF: EdgeRef = { kind: 'edge', bodyId: '_pending_', edgeId: '_pending_' };

export default function CsysMethodPickerDialog(
  props: CsysMethodPickerDialogProps,
): React.ReactElement {
  const { initialMethod = 'world', onConfirm, onClose } = props;
  const [method, setMethod] = useState<CsysMethod>(initialMethod);

  // Pick placeholders (W3 picker bus replaces).
  const [origin] = useState<PointRef>(DEFAULT_POINT_REF);
  const [xDir] = useState<AxisRef>(DEFAULT_AXIS_X);
  const [yDir] = useState<AxisRef>(DEFAULT_AXIS_Y);
  const [plane] = useState<PlaneRef>(DEFAULT_PLANE_REF);
  const [inPlaneRef] = useState<AxisRef>(DEFAULT_AXIS_X);
  const [face] = useState<FaceRef>(DEFAULT_FACE_REF);
  const [vertex] = useState<VertexRef>(DEFAULT_VERTEX_REF);
  const [edge] = useState<EdgeRef>(DEFAULT_EDGE_REF);

  function buildParams(): CsysParams {
    switch (method) {
      case 'world':
        return { method: 'world' };
      case 'originAndTwoAxes':
        return { method: 'originAndTwoAxes', origin, xDir, yDir };
      case 'originAndPlane':
        return { method: 'originAndPlane', origin, plane, inPlaneRef };
      case 'byFaceVertex':
        return { method: 'byFaceVertex', face, vertex, edge };
    }
  }

  function handleConfirm(): void {
    const params = buildParams();
    const draft = {
      id: newReferenceId(),
      kind: 'csys' as const,
      method,
      label: `CSys ${method}`,
      hidden: false,
      params,
      evaluatedAt: 0,
      dependsOn: [] as readonly string[],
    } as ReferenceCsysNode;
    onConfirm({ ...draft, dependsOn: computeDependsOn(draft) } as ReferenceCsysNode);
  }

  function renderParams(): React.ReactElement {
    switch (method) {
      case 'world':
        return (
          <FormRow label="World coordinate system">
            <input value="World (identity)" disabled style={fieldStyle} />
          </FormRow>
        );
      case 'originAndTwoAxes':
        return (
          <>
            <FormRow label="Origin point (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="X direction axis (W3 pick)">
              <input value="Standard: x" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Y direction axis (W3 pick)">
              <input value="Standard: y" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'originAndPlane':
        return (
          <>
            <FormRow label="Origin point (W3 pick)">
              <input value="<inline 0,0,0>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Plane (W3 pick)">
              <input value="Standard: front" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="In-plane axis (W3 pick)">
              <input value="Standard: x" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
      case 'byFaceVertex':
        return (
          <>
            <FormRow label="Face (W3 pick)">
              <input value="<face pending>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Vertex (W3 pick)">
              <input value="<vertex pending>" disabled style={fieldStyle} />
            </FormRow>
            <FormRow label="Edge (W3 pick)">
              <input value="<edge pending>" disabled style={fieldStyle} />
            </FormRow>
          </>
        );
    }
  }

  return (
    <DialogShell<CsysMethod>
      title="New Coordinate System"
      methods={REF_GEOM_METHOD_CATALOGUE.csys}
      activeMethod={method}
      onMethodChange={setMethod}
      onClose={onClose}
      onConfirm={handleConfirm}
      testId="csys-method-picker"
    >
      {renderParams()}
    </DialogShell>
  );
}
