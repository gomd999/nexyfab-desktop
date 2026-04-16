import * as THREE from 'three';
import { type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea } from './index';

// Same safe eval as functionSurface but for single variable
function evalFormula1D(formula: string, y: number): number {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'y', 't',
      'sin', 'cos', 'tan', 'sqrt', 'abs', 'pow', 'exp', 'log', 'sign',
      'PI', 'E', 'floor', 'ceil', 'round', 'max', 'min',
      '"use strict"; return Number(' + formula + ');',
    );
    const v = fn(
      y, y,
      Math.sin, Math.cos, Math.tan, Math.sqrt, Math.abs, Math.pow, Math.exp,
      Math.log, Math.sign,
      Math.PI, Math.E, Math.floor, Math.ceil, Math.round, Math.max, Math.min,
    ) as number;
    return isFinite(v) ? Math.max(0, v) : 0;
  } catch {
    return 0;
  }
}

export const latheProfileShape: ShapeConfig = {
  id: 'latheProfile',
  tier: 2,
  icon: '◍',
  params: [
    { key: 'maxRadius', labelKey: 'paramMaxRadius', default: 50, min: 5, max: 500, step: 1,  unit: 'mm' },
    { key: 'height',    labelKey: 'paramHeight',    default: 80, min: 5, max: 500, step: 1,  unit: 'mm' },
    { key: 'segments',  labelKey: 'paramSegments',  default: 48, min: 12, max: 128, step: 4, unit: '' },
    { key: 'steps',     labelKey: 'paramSteps',     default: 32, min: 8,  max: 128, step: 4, unit: '' },
  ],
  formulaFields: [
    {
      key: 'rFormula',
      labelKey: 'formulaR',
      default: '0.5 + 0.4 * sin(y * PI)',
      placeholder: 'r = f(y)   예) 0.5 + 0.4*sin(y*PI)',
      hint: 'y ∈ [0, 1] (아래→위)  r 출력 ∈ [0, 1] × maxRadius  사용 가능: sin cos sqrt abs pow PI',
    },
  ],
  generate(p, formulas): ShapeResult {
    const maxR = p.maxRadius, h = p.height;
    const segs = Math.round(p.segments);
    const steps = Math.round(p.steps);
    const formula = formulas?.rFormula ?? '0.5 + 0.4*sin(y*PI)';

    // Build profile points
    const points: THREE.Vector2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;           // y ∈ [0, 1]
      const rNorm = evalFormula1D(formula, t);  // expected 0–1
      const r = Math.max(0, rNorm) * maxR;
      const y = (t - 0.5) * h;       // center on origin
      points.push(new THREE.Vector2(r, y));
    }

    // Close the profile at top and bottom if r > 0 there
    // Ensure first/last point touches axis for closed solid
    if (points[0].x > 0) points.unshift(new THREE.Vector2(0, points[0].y));
    if (points[points.length - 1].x > 0) points.push(new THREE.Vector2(0, points[points.length - 1].y));

    const geo = new THREE.LatheGeometry(points, segs);
    geo.computeVertexNormals();

    const volume_cm3 = meshVolume(geo) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geo) / 100;

    geo.computeBoundingBox();
    const sz = new THREE.Vector3();
    geo.boundingBox!.getSize(sz);
    const bbox = { w: Math.round(sz.x), h: Math.round(sz.y), d: Math.round(sz.z) };

    return { geometry: geo, edgeGeometry: makeEdges(geo, 20), volume_cm3, surface_area_cm2, bbox };
  },
};
