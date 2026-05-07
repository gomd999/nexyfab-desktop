import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { type ShapeConfig, type ShapeResult, makeEdges } from './index';

export const lBracketShape: ShapeConfig = {
  id: 'lBracket',
  tier: 1,
  icon: '🔨',
  params: [
    { key: 'width',     labelKey: 'paramWidth',     default: 80, min: 2,  max: 500, step: 1, unit: 'mm' },
    { key: 'height',    labelKey: 'paramHeight',    default: 60, min: 2,  max: 500, step: 1, unit: 'mm' },
    { key: 'thickness', labelKey: 'paramThickness', default: 8,  min: 1,  max: 100, step: 1, unit: 'mm' },
    { key: 'depth',     labelKey: 'paramDepth',     default: 40, min: 1,  max: 500, step: 1, unit: 'mm' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const w = p.width;
    const h = p.height;
    const t = p.thickness;
    const d = p.depth;

    // Horizontal part (base): width x thickness x depth
    const horzGeo = new THREE.BoxGeometry(w, t, d);
    // Position: bottom edge at y=0, so center at y = t/2
    horzGeo.translate(0, t / 2, 0);

    // Vertical part (left leg): thickness x (height - thickness) x depth
    const vertH = h - t;
    const vertGeo = new THREE.BoxGeometry(t, vertH, d);
    // Position: on the left side, bottom at y = t
    vertGeo.translate(-w / 2 + t / 2, t + vertH / 2, 0);

    const geometry = mergeGeometries([horzGeo, vertGeo]);
    if (!geometry) throw new Error('Failed to merge L-bracket geometries');

    geometry.computeVertexNormals();
    const edgeGeometry = makeEdges(geometry);

    // Volume: horizontal + vertical
    const volume_mm3 = w * t * d + vertH * t * d;
    const volume_cm3 = volume_mm3 / 1000;

    // Surface area analytically
    // The L-shape cross-section perimeter * depth + 2 * cross-section area
    // Cross-section is an L: width x thickness horizontal + thickness x (height - thickness) vertical
    // Cross-section area = w*t + (h-t)*t
    const crossArea = w * t + vertH * t;

    // Perimeter of the L cross-section (outer perimeter)
    // Going around: bottom-left -> bottom-right (w) -> up right side (t) ->
    // left along top of horizontal (w - t) -> up inner corner (h - t) ->
    // left along top of vertical (t) -> down left side (h)
    const perimeter = w + t + (w - t) + vertH + t + h;

    const surface_area_mm2 = perimeter * d + 2 * crossArea;
    const surface_area_cm2 = surface_area_mm2 / 100;

    const bbox = { w: Math.round(w), h: Math.round(h), d: Math.round(d) };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
