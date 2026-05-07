import * as THREE from 'three';
import type { FeatureDefinition } from './types';
import { isOcctReady, isOcctGlobalMode, occtBoxBooleanWithPrimitive, hostBoxFromGeometry } from './occtEngine';

export const moldToolsFeature: FeatureDefinition = {
  type: 'moldTools',
  icon: '🏭',
  params: [
    {
      key: 'operation', labelKey: 'paramMoldOperation', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'moldDraftAnalysis' },
        { value: 1, labelKey: 'moldCavity' },
        { value: 2, labelKey: 'moldCore' },
      ],
    },
    {
      key: 'pullAxis', labelKey: 'paramMoldPullAxis', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'axisX' },
        { value: 1, labelKey: 'axisY' },
        { value: 2, labelKey: 'axisZ' },
      ],
    },
    { key: 'draftAngle', labelKey: 'paramMoldDraftAngle', default: 2, min: 0.5, max: 15, step: 0.5, unit: '°' },
    { key: 'splitOffset', labelKey: 'paramMoldSplitOffset', default: 0, min: -100, max: 100, step: 1, unit: 'mm' },
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  apply(geometry, params) {
    const operation = Math.round(params.operation);
    const pullAxis = Math.round(params.pullAxis);
    const draftAngle = (params.draftAngle / 180) * Math.PI;
    const splitOffset = params.splitOffset;
    const engine = Math.round(params.engine ?? 0);

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const pullDir = new THREE.Vector3(
      pullAxis === 0 ? 1 : 0,
      pullAxis === 1 ? 1 : 0,
      pullAxis === 2 ? 1 : 0,
    );

    if (operation === 0) {
      // Draft analysis: color-code faces by draft angle
      const result = geometry.clone();
      result.computeVertexNormals();
      const normals = result.attributes.normal;
      const positions = result.attributes.position;

      const colors = new Float32Array(positions.count * 3);
      for (let i = 0; i < positions.count; i++) {
        const nx = normals.getX(i);
        const ny = normals.getY(i);
        const nz = normals.getZ(i);
        const normal = new THREE.Vector3(nx, ny, nz).normalize();
        const dot = normal.dot(pullDir);
        const faceDraftAngle = Math.asin(Math.abs(dot));

        // Green = sufficient draft, Yellow = marginal, Red = insufficient
        if (faceDraftAngle >= draftAngle) {
          colors[i * 3] = 0.24; colors[i * 3 + 1] = 0.73; colors[i * 3 + 2] = 0.37; // green
        } else if (faceDraftAngle >= draftAngle * 0.5) {
          colors[i * 3] = 1.0; colors[i * 3 + 1] = 0.8; colors[i * 3 + 2] = 0.0; // yellow
        } else {
          colors[i * 3] = 0.96; colors[i * 3 + 1] = 0.32; colors[i * 3 + 2] = 0.27; // red
        }
      }
      result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      return result;
    }

    // Cavity (operation=1): keep upper half; Core (operation=2): keep lower half
    const splitVal = pullAxis === 1
      ? bb.min.y + (bb.max.y - bb.min.y) / 2 + splitOffset
      : pullAxis === 0
        ? bb.min.x + (bb.max.x - bb.min.x) / 2 + splitOffset
        : bb.min.z + (bb.max.z - bb.min.z) / 2 + splitOffset;

    const boxSize = Math.max(
      bb.max.x - bb.min.x,
      bb.max.y - bb.min.y,
      bb.max.z - bb.min.z,
    ) * 2;
    const half = boxSize / 2;

    let cx = 0, cy = 0, cz = 0;
    if (pullAxis === 1) {
      cy = operation === 1 ? splitVal + half : splitVal - half;
    } else if (pullAxis === 0) {
      cx = operation === 1 ? splitVal + half : splitVal - half;
    } else {
      cz = operation === 1 ? splitVal + half : splitVal - half;
    }

    if ((engine === 1 || isOcctGlobalMode()) && isOcctReady()) {
      try {
        const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
        const host = hostBoxFromGeometry(geometry);
        const result = occtBoxBooleanWithPrimitive(
          'subtract',
          host,
          { shape: 'box', w: boxSize, h: boxSize, d: boxSize, cx, cy, cz, rx: 0, ry: 0, rz: 0 },
          undefined,
          upstreamHandle
        );
        if (result.handle) result.geometry.userData.occtHandle = result.handle;
        return result.geometry;
      } catch (err) {
        console.warn('[moldTools] OCCT path failed, falling back to three-bvh-csg:', err);
      }
    }

    // Attempt CSG-based halving via three-bvh-csg (optional dependency)
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Evaluator, Brush, SUBTRACTION } = require('three-bvh-csg') as {
        Evaluator: new () => { evaluate: (a: InstanceType<typeof Brush>, b: InstanceType<typeof Brush>, op: number) => THREE.Mesh };
        Brush: new (geo: THREE.BufferGeometry, mat: THREE.Material) => THREE.Mesh & { geometry: THREE.BufferGeometry };
        SUBTRACTION: number;
      };

      const cutBox = new THREE.BoxGeometry(boxSize, boxSize, boxSize);
      cutBox.translate(cx, cy, cz);

      const evaluator = new Evaluator();
      const geoBrush = new Brush(geometry, new THREE.MeshStandardMaterial());
      const cutBrush = new Brush(cutBox, new THREE.MeshStandardMaterial());

      const result = evaluator.evaluate(geoBrush, cutBrush, SUBTRACTION);
      result.geometry.computeVertexNormals();
      return result.geometry;
    } catch {
      // If CSG unavailable, fall back to returning original geometry
      return geometry;
    }
  },
};
