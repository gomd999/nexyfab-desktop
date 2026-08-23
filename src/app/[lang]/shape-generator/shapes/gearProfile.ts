import * as THREE from 'three';

export interface SpurGearProfileParams {
  teeth: number;
  module: number;
  boreDiameter: number;
  pressureAngle: number;
}

export interface SpurGearDimensions {
  pitchRadius: number;
  addendumRadius: number;
  dedendumRadius: number;
  baseRadius: number;
}

function involute(baseRadius: number, t: number): [number, number] {
  return [
    baseRadius * (Math.cos(t) + t * Math.sin(t)),
    baseRadius * (Math.sin(t) - t * Math.cos(t)),
  ];
}

export function spurGearDimensions(params: SpurGearProfileParams): SpurGearDimensions {
  const teeth = Math.max(8, Math.round(params.teeth));
  const gearModule = Math.max(Number.EPSILON, params.module);
  const pressureAngle = (params.pressureAngle * Math.PI) / 180;
  const pitchRadius = (gearModule * teeth) / 2;
  return {
    pitchRadius,
    addendumRadius: pitchRadius + gearModule,
    dedendumRadius: pitchRadius - 1.25 * gearModule,
    baseRadius: pitchRadius * Math.cos(pressureAngle),
  };
}

/** Canonical profile shared by the interactive mesh and FeatureTree path. */
export function buildSpurGearProfile(params: SpurGearProfileParams): THREE.Shape {
  const teeth = Math.max(8, Math.round(params.teeth));
  const { pitchRadius, addendumRadius, dedendumRadius, baseRadius } = spurGearDimensions(params);
  const tMax = Math.sqrt((addendumRadius / baseRadius) ** 2 - 1);
  const toothAngle = (2 * Math.PI) / teeth;
  const pitchT = Math.sqrt((pitchRadius / baseRadius) ** 2 - 1);
  const invAlpha = pitchT - Math.atan(pitchT);
  const offsetAngle = toothAngle / 4 - invAlpha;
  const shape = new THREE.Shape();
  const involuteSteps = 12;

  for (let tooth = 0; tooth < teeth; tooth++) {
    const baseAngle = tooth * toothAngle;
    const rightPoints: Array<{ x: number; y: number }> = [];
    const leftPoints: Array<{ x: number; y: number }> = [];

    for (let i = 0; i <= involuteSteps; i++) {
      const t = (i / involuteSteps) * tMax;
      const [ix, iy] = involute(baseRadius, t);
      const rightAngle = baseAngle + offsetAngle;
      const rightX = ix * Math.cos(rightAngle) - iy * Math.sin(rightAngle);
      const rightY = ix * Math.sin(rightAngle) + iy * Math.cos(rightAngle);
      if (Math.hypot(rightX, rightY) >= dedendumRadius) rightPoints.push({ x: rightX, y: rightY });

      const leftAngle = baseAngle - offsetAngle;
      const leftX = ix * Math.cos(leftAngle) + iy * Math.sin(leftAngle);
      const leftY = ix * Math.sin(leftAngle) - iy * Math.cos(leftAngle);
      if (Math.hypot(leftX, leftY) >= dedendumRadius) leftPoints.push({ x: leftX, y: leftY });
    }
    leftPoints.reverse();

    if (tooth === 0) {
      const startAngle = -toothAngle / 2 + offsetAngle;
      shape.moveTo(dedendumRadius * Math.cos(startAngle), dedendumRadius * Math.sin(startAngle));
    }
    if (rightPoints.length > 0) {
      const first = rightPoints[0]!;
      shape.absarc(0, 0, dedendumRadius, baseAngle - offsetAngle, Math.atan2(first.y, first.x), false);
      for (const point of rightPoints) shape.lineTo(point.x, point.y);
    }
    if (rightPoints.length > 0 && leftPoints.length > 0) {
      const rightTip = rightPoints.at(-1)!;
      const leftTip = leftPoints[0]!;
      shape.absarc(0, 0, addendumRadius, Math.atan2(rightTip.y, rightTip.x), Math.atan2(leftTip.y, leftTip.x), false);
    }
    for (const point of leftPoints) shape.lineTo(point.x, point.y);
    if (leftPoints.length > 0) {
      const last = leftPoints.at(-1)!;
      const endAngle = tooth < teeth - 1
        ? (tooth + 1) * toothAngle - offsetAngle
        : -toothAngle / 2 + offsetAngle + 2 * Math.PI;
      shape.absarc(0, 0, dedendumRadius, Math.atan2(last.y, last.x), endAngle, false);
    }
  }

  if (params.boreDiameter > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, params.boreDiameter / 2, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return shape;
}

/** Same curve sampling consumed by ExtrudeGeometry's default curveSegments. */
export function spurGearOuterLoop(params: SpurGearProfileParams): Array<{ x: number; y: number }> {
  return buildSpurGearProfile(params).extractPoints(12).shape.map(point => ({ x: point.x, y: point.y }));
}
