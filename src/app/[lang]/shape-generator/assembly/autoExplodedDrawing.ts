/**
 * Auto exploded-view drawing layout (F8).
 *
 * Given an exploded assembly + a viewing camera basis, produce a 2D layout
 * with BOM-numbered balloons (numbered circles) and leader lines pointing to
 * each part. Output is plain numeric coordinates so the renderer (SVG/PDF)
 * stays decoupled.
 *
 * Algorithm:
 *  1. Project each part's centre to 2D using a simple orthographic basis.
 *  2. Sort balloons clockwise around the bounding box centre to get a
 *     readable numbering pattern.
 *  3. Place balloons on a circle radius = 1.3× bbox diagonal so they sit
 *     outside the part cluster — leader lines never cross the geometry.
 *  4. Repel overlapping balloons via short pair-wise iterative pushaway.
 */

import * as THREE from 'three';

export interface ExplodedPartInput {
  /** BOM line identifier — name shown in the balloon's tooltip if needed. */
  id: string;
  /** Display name (shown alongside number in legend). */
  name: string;
  /** World-space centre after explosion. */
  worldCenter: [number, number, number];
}

export interface BalloonLayout {
  /** 1-indexed BOM line number. */
  number: number;
  /** Original part id. */
  partId: string;
  /** Display name for the legend table. */
  name: string;
  /** Balloon centre in 2D drawing units (mm). */
  balloonX: number;
  balloonY: number;
  /** Leader line target — projected part centre. */
  partX: number;
  partY: number;
}

export interface AutoExplodedDrawingResult {
  balloons: BalloonLayout[];
  /** 2D bounding box of the projected scene + balloons. */
  drawingBounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Default basis: front view (X+Y in plane, Z out of screen). */
const DEFAULT_BASIS = {
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, 1, 0),
};

export interface AutoExplodedDrawingOptions {
  /** Camera right vector (defaults to +X). Up is computed perpendicular. */
  cameraRight?: [number, number, number];
  cameraUp?: [number, number, number];
  /** Balloon radius in drawing-mm. Default 6. */
  balloonRadius?: number;
  /** Min separation between balloon centres. Default 18mm. */
  balloonSpacing?: number;
}

export function autoExplodedDrawing(
  parts: ExplodedPartInput[],
  options: AutoExplodedDrawingOptions = {},
): AutoExplodedDrawingResult {
  const balloonR = options.balloonRadius ?? 6;
  const minSpacing = options.balloonSpacing ?? 18;

  if (parts.length === 0) {
    return {
      balloons: [],
      drawingBounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const right = options.cameraRight
    ? new THREE.Vector3(...options.cameraRight).normalize()
    : DEFAULT_BASIS.right;
  const up = options.cameraUp
    ? new THREE.Vector3(...options.cameraUp).normalize()
    : DEFAULT_BASIS.up;

  // 1) Project each part centre to 2D using right/up.
  const projected = parts.map(p => {
    const v = new THREE.Vector3(...p.worldCenter);
    return {
      part: p,
      x: v.dot(right),
      y: v.dot(up),
    };
  });

  // 2) Compute the centroid + radius for the balloon ring.
  const centroidX = projected.reduce((s, p) => s + p.x, 0) / projected.length;
  const centroidY = projected.reduce((s, p) => s + p.y, 0) / projected.length;
  let maxR = 0;
  for (const p of projected) {
    const dx = p.x - centroidX;
    const dy = p.y - centroidY;
    maxR = Math.max(maxR, Math.sqrt(dx * dx + dy * dy));
  }
  // Push balloons further out so leaders escape the part cluster.
  const ringR = Math.max(maxR * 1.3, minSpacing * 2);

  // 3) Sort by angle to get a clockwise numbering.
  const withAngle = projected.map(p => ({
    ...p,
    angle: Math.atan2(p.y - centroidY, p.x - centroidX),
  }));
  withAngle.sort((a, b) => a.angle - b.angle);

  // 4) Place balloons evenly around the ring at the natural angle of each
  //    part (so leaders stay close to radial — minimal crossings).
  const balloons: BalloonLayout[] = withAngle.map((p, idx) => ({
    number: idx + 1,
    partId: p.part.id,
    name: p.part.name,
    balloonX: centroidX + ringR * Math.cos(p.angle),
    balloonY: centroidY + ringR * Math.sin(p.angle),
    partX: p.x,
    partY: p.y,
  }));

  // 5) Repel overlapping balloons (lightweight relaxation — 4 iterations
  //    is enough for assemblies up to ~30 parts; beyond that some manual
  //    nudging may be needed but auto layout is a starting point, not
  //    the final).
  for (let iter = 0; iter < 4; iter++) {
    for (let i = 0; i < balloons.length; i++) {
      for (let j = i + 1; j < balloons.length; j++) {
        const dx = balloons[j].balloonX - balloons[i].balloonX;
        const dy = balloons[j].balloonY - balloons[i].balloonY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        if (dist < minSpacing) {
          const push = (minSpacing - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          balloons[i].balloonX -= ux * push;
          balloons[i].balloonY -= uy * push;
          balloons[j].balloonX += ux * push;
          balloons[j].balloonY += uy * push;
        }
      }
    }
  }

  // 6) Drawing bounds — union of part centres and balloon perimeter.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of balloons) {
    minX = Math.min(minX, b.balloonX - balloonR, b.partX);
    minY = Math.min(minY, b.balloonY - balloonR, b.partY);
    maxX = Math.max(maxX, b.balloonX + balloonR, b.partX);
    maxY = Math.max(maxY, b.balloonY + balloonR, b.partY);
  }

  return {
    balloons,
    drawingBounds: { minX, minY, maxX, maxY },
  };
}
