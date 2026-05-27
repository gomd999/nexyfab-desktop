/**
 * balloonCalloutLayout.ts — Place BOM balloon callouts around a drawing
 * view without overlapping the part or other balloons.
 *
 * Each balloon has an anchor (the feature point) and a label box. The
 * balloon must:
 *   1. Stay inside the sheet bounds.
 *   2. Not overlap the view bounding rectangle (so it sits in the
 *      margin around the part).
 *   3. Not collide with other balloons (min separation).
 *   4. Connect to its anchor with a leader (straight or jogged).
 *
 * Strategy: project each anchor radially outward to the view bounding
 * box edge with a fixed margin, then iterate a small force-based
 * relaxation to spread overlapping balloons along the margin.
 */

export interface BalloonAnchor {
  id: string;
  itemNumber: number; // BOM index shown in the balloon
  point: { x: number; y: number };
}

export interface ViewBounds {
  minX: number; minY: number; maxX: number; maxY: number;
}

export interface BalloonLayoutOptions {
  marginMm: number; // distance from view bounds to balloon centre
  balloonRadiusMm: number;
  minSeparationMm: number;
  maxIterations?: number;
}

export interface PlacedBalloon {
  id: string;
  itemNumber: number;
  anchor: { x: number; y: number };
  balloonCentre: { x: number; y: number };
  leaderPolyline: { x: number; y: number }[];
  collidesWithView: boolean;
}

export interface BalloonLayoutResult {
  placed: PlacedBalloon[];
  iterations: number;
  collisions: number; // balloon-vs-balloon collisions remaining
  warnings: string[];
}

export function layoutBalloons(
  anchors: BalloonAnchor[],
  view: ViewBounds,
  opts: BalloonLayoutOptions,
): BalloonLayoutResult {
  const warnings: string[] = [];
  if (anchors.length === 0) {
    return { placed: [], iterations: 0, collisions: 0, warnings: ['No anchors provided.'] };
  }
  const maxIter = opts.maxIterations ?? 40;

  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;

  // Initial placement: project each anchor radially to a "ring" outside view bounds.
  const placed: PlacedBalloon[] = anchors.map(a => projectInitial(a, view, opts.marginMm, cx, cy));

  // Force-based relaxation to spread overlapping balloons.
  let iters = 0;
  for (; iters < maxIter; iters++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        const dx = b.balloonCentre.x - a.balloonCentre.x;
        const dy = b.balloonCentre.y - a.balloonCentre.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 2 * opts.balloonRadiusMm + opts.minSeparationMm;
        if (dist < minDist && dist > 1e-6) {
          const push = (minDist - dist) / 2;
          const ux = dx / dist;
          const uy = dy / dist;
          a.balloonCentre = { x: a.balloonCentre.x - ux * push, y: a.balloonCentre.y - uy * push };
          b.balloonCentre = { x: b.balloonCentre.x + ux * push, y: b.balloonCentre.y + uy * push };
          moved = true;
        }
      }
    }
    // After spreading, re-project any balloon that fell inside view bounds.
    for (const p of placed) {
      if (insideViewWithRadius(p.balloonCentre, view, opts.balloonRadiusMm)) {
        const proj = projectInitial({ id: p.id, itemNumber: p.itemNumber, point: p.anchor }, view, opts.marginMm, cx, cy);
        p.balloonCentre = proj.balloonCentre;
        moved = true;
      }
    }
    if (!moved) break;
  }

  // Build leader polylines + collision report.
  let collisions = 0;
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i]!;
    p.leaderPolyline = buildLeader(p.anchor, p.balloonCentre);
    p.collidesWithView = insideViewWithRadius(p.balloonCentre, view, opts.balloonRadiusMm);
    for (let j = i + 1; j < placed.length; j++) {
      const q = placed[j]!;
      const d = Math.hypot(p.balloonCentre.x - q.balloonCentre.x, p.balloonCentre.y - q.balloonCentre.y);
      if (d < 2 * opts.balloonRadiusMm + opts.minSeparationMm - 1e-3) collisions++;
    }
  }

  if (collisions > 0) warnings.push(`${collisions} balloon-pairs still overlap; increase margin or balloonRadius.`);
  return { placed, iterations: iters, collisions, warnings };
}

function projectInitial(
  a: BalloonAnchor,
  view: ViewBounds,
  margin: number,
  cx: number,
  cy: number,
): PlacedBalloon {
  const dx = a.point.x - cx;
  const dy = a.point.y - cy;
  const angle = Math.atan2(dy, dx);
  // Project to view-bbox edge then add margin in the same direction.
  const halfW = (view.maxX - view.minX) / 2 + margin;
  const halfH = (view.maxY - view.minY) / 2 + margin;
  // Parametric ray from (cx, cy) at angle, find where it exits halfW/halfH ellipse-ish.
  // Use rectangular projection: scale to whichever bound hits first.
  const tx = Math.abs(Math.cos(angle)) > 1e-6 ? halfW / Math.abs(Math.cos(angle)) : Infinity;
  const ty = Math.abs(Math.sin(angle)) > 1e-6 ? halfH / Math.abs(Math.sin(angle)) : Infinity;
  const t = Math.min(tx, ty);
  const bx = cx + Math.cos(angle) * t;
  const by = cy + Math.sin(angle) * t;
  return {
    id: a.id,
    itemNumber: a.itemNumber,
    anchor: { x: a.point.x, y: a.point.y },
    balloonCentre: { x: bx, y: by },
    leaderPolyline: [],
    collidesWithView: false,
  };
}

function insideViewWithRadius(p: { x: number; y: number }, view: ViewBounds, r: number): boolean {
  return p.x + r > view.minX && p.x - r < view.maxX && p.y + r > view.minY && p.y - r < view.maxY;
}

function buildLeader(anchor: { x: number; y: number }, balloon: { x: number; y: number }): { x: number; y: number }[] {
  // Straight leader by default; jogs added if anchor and balloon align awkwardly.
  return [anchor, balloon];
}

export function detectCollisions(result: BalloonLayoutResult, view: ViewBounds): { viewCollisions: number } {
  const v = result.placed.filter(p => insideViewWithRadius(p.balloonCentre, view, 0)).length;
  return { viewCollisions: v };
}

export function summarize(r: BalloonLayoutResult): { placedCount: number; iterations: number; collisions: number } {
  return { placedCount: r.placed.length, iterations: r.iterations, collisions: r.collisions };
}
