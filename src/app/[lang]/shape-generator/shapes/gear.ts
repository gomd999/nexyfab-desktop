import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

/**
 * Involute spur gear generator.
 * Creates a 2D involute tooth profile, extrudes it, and optionally cuts a bore hole.
 */

function involute(baseR: number, t: number): [number, number] {
  return [
    baseR * (Math.cos(t) + t * Math.sin(t)),
    baseR * (Math.sin(t) - t * Math.cos(t)),
  ];
}

export const gearShape: ShapeConfig = {
  id: 'gear',
  tier: 2,
  icon: '⚙️',
  params: [
    { key: 'teeth',         labelKey: 'paramTeeth',         default: 24,   min: 8,    max: 120,  step: 1,   unit: '개' },
    { key: 'module',        labelKey: 'paramModule',        default: 2.0,  min: 0.5,  max: 10,   step: 0.5, unit: 'mm' },
    { key: 'width',         labelKey: 'paramWidth',         default: 15,   min: 3,    max: 100,  step: 1,   unit: 'mm' },
    { key: 'boreDiameter',  labelKey: 'paramBoreDiameter',  default: 10,   min: 0,    max: 80,   step: 1,   unit: 'mm' },
    { key: 'pressureAngle', labelKey: 'paramPressureAngle', default: 20,   min: 14.5, max: 25,   step: 0.5, unit: '°' },
  ],
  generate(p: Record<string, number>): ShapeResult {
    const teeth = Math.round(p.teeth);
    const mod = p.module;
    const width = p.width;
    const bore = p.boreDiameter;
    const pressureAngleDeg = p.pressureAngle;
    const pressureAngle = (pressureAngleDeg * Math.PI) / 180;

    const pitchR = (mod * teeth) / 2;
    const addendum = mod;
    const dedendum = 1.25 * mod;
    const addendumR = pitchR + addendum;
    const dedendumR = pitchR - dedendum;
    const baseR = pitchR * Math.cos(pressureAngle);

    // Maximum involute parameter where involute radius = addendumR
    // r(t) = baseR * sqrt(1 + t²)  =>  t_max = sqrt((addendumR/baseR)² - 1)
    const tMax = Math.sqrt((addendumR / baseR) ** 2 - 1);

    const toothAngle = (2 * Math.PI) / teeth;
    // Tooth thickness angle at pitch circle ≈ half the tooth pitch
    const pitchT = Math.sqrt((pitchR / baseR) ** 2 - 1);
    const halfToothAngle = toothAngle / 4 + Math.tan(pressureAngle) - pressureAngle;
    // Angular offset so that involute starts centered on tooth
    const invAlpha = pitchT - Math.atan(pitchT);
    const offsetAngle = toothAngle / 4 - invAlpha;

    const shape = new THREE.Shape();
    const involuteSteps = 12;

    for (let tooth = 0; tooth < teeth; tooth++) {
      const baseAngle = tooth * toothAngle;

      // ── Right-side involute (from dedendum up to addendum) ──
      const rightPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= involuteSteps; i++) {
        const t = (i / involuteSteps) * tMax;
        const [ix, iy] = involute(baseR, t);
        // Rotate by baseAngle + offsetAngle
        const angle = baseAngle + offsetAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = ix * cos - iy * sin;
        const ry = ix * sin + iy * cos;
        const r = Math.sqrt(rx * rx + ry * ry);
        if (r >= dedendumR) {
          rightPoints.push({ x: rx, y: ry });
        }
      }

      // ── Left-side involute (mirrored) ──
      const leftPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= involuteSteps; i++) {
        const t = (i / involuteSteps) * tMax;
        const [ix, iy] = involute(baseR, t);
        // Mirror: negate y before rotating
        const angle = baseAngle - offsetAngle;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = ix * cos - (-iy) * sin;
        const ry = ix * sin + (-iy) * cos;
        const r = Math.sqrt(rx * rx + ry * ry);
        if (r >= dedendumR) {
          leftPoints.push({ x: rx, y: ry });
        }
      }
      leftPoints.reverse();

      // ── Start at dedendum circle between previous tooth and this one ──
      const gapStartAngle = baseAngle - toothAngle / 2 + offsetAngle;
      // Dedendum arc from previous gap to right involute start
      if (tooth === 0) {
        const startR = dedendumR;
        const startA = -toothAngle / 2 + offsetAngle;
        shape.moveTo(
          startR * Math.cos(startA),
          startR * Math.sin(startA),
        );
      }

      // Arc along dedendum to right involute start
      if (rightPoints.length > 0) {
        const rp = rightPoints[0];
        const rpAngle = Math.atan2(rp.y, rp.x);
        // Arc from current angle at dedendum to right involute start
        shape.absarc(0, 0, dedendumR, baseAngle - offsetAngle, rpAngle, false);

        // Right involute up
        for (const pt of rightPoints) {
          shape.lineTo(pt.x, pt.y);
        }
      }

      // Addendum arc (tooth tip)
      if (rightPoints.length > 0 && leftPoints.length > 0) {
        const rpLast = rightPoints[rightPoints.length - 1];
        const lpFirst = leftPoints[0];
        const aStart = Math.atan2(rpLast.y, rpLast.x);
        const aEnd = Math.atan2(lpFirst.y, lpFirst.x);
        shape.absarc(0, 0, addendumR, aStart, aEnd, false);
      }

      // Left involute down
      if (leftPoints.length > 0) {
        for (const pt of leftPoints) {
          shape.lineTo(pt.x, pt.y);
        }
      }

      // Arc along dedendum to next tooth
      if (leftPoints.length > 0) {
        const lpLast = leftPoints[leftPoints.length - 1];
        const lpAngle = Math.atan2(lpLast.y, lpLast.x);
        const nextRootAngle = (tooth + 1) * toothAngle - offsetAngle;
        if (tooth < teeth - 1) {
          shape.absarc(0, 0, dedendumR, lpAngle, nextRootAngle, false);
        } else {
          // Close back to start
          const startA = -toothAngle / 2 + offsetAngle;
          shape.absarc(0, 0, dedendumR, lpAngle, startA + 2 * Math.PI, false);
        }
      }
    }

    // Bore hole
    if (bore > 0) {
      const boreR = bore / 2;
      const holePath = new THREE.Path();
      holePath.absarc(0, 0, boreR, 0, Math.PI * 2, true);
      shape.holes.push(holePath);
    }

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: width,
      bevelEnabled: false,
      steps: 1,
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    geometry.computeVertexNormals();

    const edgeGeometry = makeEdges(geometry);

    // Volume approximation: full annular area * tooth fill factor
    const boreR = bore > 0 ? bore / 2 : 0;
    const volume_mm3 = Math.PI * (addendumR ** 2 - boreR ** 2) * width * 0.85;
    const volume_cm3 = volume_mm3 / 1000;

    // Surface area from mesh
    const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

    const bboxDia = Math.round(addendumR * 2);
    const bbox = { w: bboxDia, h: Math.round(width), d: bboxDia };

    return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
  },
};
