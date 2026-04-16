import * as THREE from 'three';
import type { FeatureDefinition } from './types';

export const loftFeature: FeatureDefinition = {
  type: 'loft',
  icon: '◈',
  params: [
    { key: 'sections', labelKey: 'paramLoftSections', default: 4, min: 2, max: 8, step: 1, unit: '' },
    { key: 'height', labelKey: 'paramLoftHeight', default: 100, min: 10, max: 500, step: 5, unit: 'mm' },
    {
      key: 'startShape', labelKey: 'paramLoftStartShape', default: 0, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'shapeCircle' },
        { value: 1, labelKey: 'shapeSquare' },
        { value: 2, labelKey: 'shapeTriangle' },
      ],
    },
    {
      key: 'endShape', labelKey: 'paramLoftEndShape', default: 1, min: 0, max: 2, step: 1, unit: '',
      options: [
        { value: 0, labelKey: 'shapeCircle' },
        { value: 1, labelKey: 'shapeSquare' },
        { value: 2, labelKey: 'shapeTriangle' },
      ],
    },
    { key: 'startSize', labelKey: 'paramLoftStartSize', default: 40, min: 5, max: 200, step: 5, unit: 'mm' },
    { key: 'endSize', labelKey: 'paramLoftEndSize', default: 20, min: 5, max: 200, step: 5, unit: 'mm' },
    { key: 'twist', labelKey: 'paramLoftTwist', default: 0, min: 0, max: 360, step: 5, unit: '°' },
  ],
  apply(_geometry, params) {
    const sections = Math.round(params.sections);
    const height = params.height;
    const startShape = Math.round(params.startShape);
    const endShape = Math.round(params.endShape);
    const startSize = params.startSize;
    const endSize = params.endSize;
    const twistTotal = (params.twist / 360) * Math.PI * 2;
    const SEGS = 32;

    function getRingPoints(shapeType: number, size: number, rot: number): [number, number][] {
      const pts: [number, number][] = [];
      if (shapeType === 0) {
        for (let i = 0; i < SEGS; i++) {
          const a = (i / SEGS) * Math.PI * 2 + rot;
          pts.push([Math.cos(a) * size, Math.sin(a) * size]);
        }
      } else if (shapeType === 1) {
        const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let i = 0; i < SEGS; i++) {
          const t = (i / SEGS) * 4;
          const seg = Math.floor(t) % 4;
          const f = t - Math.floor(t);
          const [ax, ay] = corners[seg];
          const [bx, by] = corners[(seg + 1) % 4];
          const px = (ax + (bx - ax) * f) * size;
          const py = (ay + (by - ay) * f) * size;
          pts.push([px * Math.cos(rot) - py * Math.sin(rot), px * Math.sin(rot) + py * Math.cos(rot)]);
        }
      } else {
        for (let i = 0; i < SEGS; i++) {
          const t = (i / SEGS) * 3;
          const seg = Math.floor(t);
          const f = t - seg;
          const a0 = (seg / 3) * Math.PI * 2 + rot;
          const a1 = ((seg + 1) / 3) * Math.PI * 2 + rot;
          pts.push([
            (Math.cos(a0) * (1 - f) + Math.cos(a1) * f) * size,
            (Math.sin(a0) * (1 - f) + Math.sin(a1) * f) * size,
          ]);
        }
      }
      return pts;
    }

    const verts: number[] = [];
    const idx: number[] = [];

    for (let s = 0; s <= sections; s++) {
      const t = s / sections;
      const y = t * height - height / 2;
      const size = startSize + (endSize - startSize) * t;
      const shapeType = t <= 0.5 ? startShape : endShape;
      const rot = twistTotal * t;
      for (const [px, pz] of getRingPoints(shapeType, size, rot)) {
        verts.push(px, y, pz);
      }
    }

    for (let s = 0; s < sections; s++) {
      for (let i = 0; i < SEGS; i++) {
        const a = s * SEGS + i;
        const b = s * SEGS + (i + 1) % SEGS;
        const c = (s + 1) * SEGS + i;
        const d = (s + 1) * SEGS + (i + 1) % SEGS;
        idx.push(a, c, b, b, c, d);
      }
    }

    // Bottom cap
    const botC = verts.length / 3;
    verts.push(0, -height / 2, 0);
    for (let i = 0; i < SEGS; i++) idx.push(botC, (i + 1) % SEGS, i);

    // Top cap
    const topC = verts.length / 3;
    verts.push(0, height / 2, 0);
    const topBase = sections * SEGS;
    for (let i = 0; i < SEGS; i++) idx.push(topC, topBase + i, topBase + (i + 1) % SEGS);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  },
};
