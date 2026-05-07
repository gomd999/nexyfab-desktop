// ─── Hole Wizard Plugin — Adds a drill-template plate with a grid of holes ───

import * as THREE from 'three';
import type { PluginManifest, PluginInitFn } from '../PluginAPI';

export const holeWizardManifest: PluginManifest = {
  id: 'nexyfab-hole-wizard',
  name: 'Hole Wizard',
  version: '1.0.0',
  author: 'NexyFab',
  description: 'Creates a flat plate with a parametric grid of through-holes, counterbores, or countersinks',
};

/* ─── Geometry helpers ────────────────────────────────────────────────────── */

/**
 * Merge an array of (non-indexed) BufferGeometries into one by concatenating
 * their position and normal arrays. All input geometries should already have
 * vertex normals computed. Returns a new non-indexed BufferGeometry.
 */
function mergeNonIndexed(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Convert any indexed geometry to non-indexed first
  const niGeos = geos.map((g) => {
    const ni = g.index ? g.toNonIndexed() : g.clone();
    ni.computeVertexNormals();
    return ni;
  });

  let totalVerts = 0;
  for (const g of niGeos) totalVerts += (g.attributes.position.array as Float32Array).length;

  const mergedPos  = new Float32Array(totalVerts);
  const mergedNorm = new Float32Array(totalVerts);

  let offset = 0;
  for (const g of niGeos) {
    const p = g.attributes.position.array as Float32Array;
    const n = g.attributes.normal.array   as Float32Array;
    mergedPos.set(p,  offset);
    mergedNorm.set(n, offset);
    offset += p.length;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(mergedPos,  3));
  out.setAttribute('normal',   new THREE.BufferAttribute(mergedNorm, 3));
  out.computeBoundingBox();
  return out;
}

/**
 * Build a CylinderGeometry for a single hole column, positioned so its centre
 * is at (x, 0, z) and it fully pierces the plate (height = plateThickness + 2 mm).
 */
function makeHoleCylinder(
  radius: number,
  plateThickness: number,
  x: number,
  z: number,
  radialSegments: number,
): THREE.BufferGeometry {
  const h   = plateThickness + 2;                // slightly taller than plate
  const geo = new THREE.CylinderGeometry(radius, radius, h, radialSegments, 1, false);

  // Apply translation via the geometry (no Object3D needed)
  geo.translate(x, 0, z);
  return geo;
}

/**
 * Build counterbore geometry: a wider shallow cylinder on top, plus a narrower
 * through-hole cylinder below.
 *   cbRadius = holeDiameter * 0.75 (counterbore radius)
 *   cbDepth  = plateThickness * 0.4
 */
function makeCounterboreHole(
  holeRadius: number,
  plateThickness: number,
  x: number,
  z: number,
  radialSegments: number,
): THREE.BufferGeometry[] {
  const cbRadius = holeRadius * 1.5;
  const cbDepth  = plateThickness * 0.4;

  // Bore (through entire plate)
  const bore = new THREE.CylinderGeometry(
    holeRadius, holeRadius, plateThickness + 2, radialSegments, 1,
  );
  bore.translate(x, 0, z);

  // Counterbore pocket (top portion, offset upward)
  const pocketY = (plateThickness - cbDepth) / 2;
  const pocket  = new THREE.CylinderGeometry(
    cbRadius, cbRadius, cbDepth, radialSegments, 1,
  );
  pocket.translate(x, pocketY, z);

  return [bore, pocket];
}

/**
 * Build countersink geometry: a cone on top transitioning to the hole bore.
 *   csAngle = 90° included (45° half-angle) — standard machining countersink
 */
function makeCountersinkHole(
  holeRadius: number,
  plateThickness: number,
  x: number,
  z: number,
  radialSegments: number,
): THREE.BufferGeometry[] {
  // Cone sink: top radius = csRadius, bottom radius = holeRadius, height = csDepth
  const csDepth  = holeRadius;                    // 45° half-angle → depth = radius
  const csRadius = holeRadius + csDepth;          // widest point at surface

  // Bore (through entire plate)
  const bore = new THREE.CylinderGeometry(
    holeRadius, holeRadius, plateThickness + 2, radialSegments, 1,
  );
  bore.translate(x, 0, z);

  // Countersink cone (top of plate)
  const sinkY = (plateThickness - csDepth) / 2;
  const sink  = new THREE.CylinderGeometry(
    csRadius, holeRadius, csDepth, radialSegments, 1,
  );
  sink.translate(x, sinkY, z);

  return [bore, sink];
}

/* ─── Plugin Init ─────────────────────────────────────────────────────────── */

export const holeWizardInit: PluginInitFn = (ctx) => {
  ctx.registerShape({
    id: 'hole-wizard',
    name: 'Hole Wizard',
    icon: '🕳️',
    params: [
      { key: 'plateWidth',     label: 'Plate Width (mm)',      min: 20, max: 500, default: 100, step: 5   },
      { key: 'plateHeight',    label: 'Plate Height (mm)',     min: 20, max: 500, default: 80,  step: 5   },
      { key: 'plateThickness', label: 'Plate Thickness (mm)',  min: 2,  max: 50,  default: 10,  step: 1   },
      { key: 'holeType',       label: 'Hole Type (0/1/2)',     min: 0,  max: 2,   default: 0,   step: 1   },
      { key: 'holeDiameter',   label: 'Hole Diameter (mm)',    min: 1,  max: 50,  default: 8,   step: 0.5 },
      { key: 'holeRows',       label: 'Rows',                  min: 1,  max: 6,   default: 2,   step: 1   },
      { key: 'holeCols',       label: 'Columns',               min: 1,  max: 8,   default: 3,   step: 1   },
      { key: 'edgeMargin',     label: 'Edge Margin (mm)',      min: 5,  max: 100, default: 20,  step: 5   },
    ],
    generate: (p) => {
      const {
        plateWidth, plateHeight, plateThickness,
        holeType, holeDiameter,
        holeRows, holeCols, edgeMargin,
      } = p;

      const holeRadius    = holeDiameter / 2;
      const radialSegments = 24;

      // ── Plate ──────────────────────────────────────────────────────────────
      // THREE BoxGeometry(width, height, depth) → width=X, height=Y, depth=Z
      // We lay the plate flat: X = plateWidth, Y = plateThickness, Z = plateHeight
      const plateGeo = new THREE.BoxGeometry(plateWidth, plateThickness, plateHeight);

      // ── Hole grid layout ───────────────────────────────────────────────────
      // Available span between edge margins
      const spanX = plateWidth  - 2 * edgeMargin;
      const spanZ = plateHeight - 2 * edgeMargin;

      const rows = Math.max(1, Math.round(holeRows));
      const cols = Math.max(1, Math.round(holeCols));

      // Step between hole centres (avoid divide-by-zero for single row/col)
      const stepX = cols > 1 ? spanX / (cols - 1) : 0;
      const stepZ = rows > 1 ? spanZ / (rows - 1) : 0;

      // Offsets so the grid is centred on the plate
      const startX = -plateWidth  / 2 + edgeMargin;
      const startZ = -plateHeight / 2 + edgeMargin;

      const holeGeos: THREE.BufferGeometry[] = [];
      const type = Math.round(holeType);           // 0=through, 1=counterbore, 2=countersink

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = startX + c * stepX;
          const z = startZ + r * stepZ;

          if (type === 1) {
            holeGeos.push(...makeCounterboreHole(holeRadius, plateThickness, x, z, radialSegments));
          } else if (type === 2) {
            holeGeos.push(...makeCountersinkHole(holeRadius, plateThickness, x, z, radialSegments));
          } else {
            holeGeos.push(makeHoleCylinder(holeRadius, plateThickness, x, z, radialSegments));
          }
        }
      }

      // ── Merge plate + all hole geometries ─────────────────────────────────
      const merged = mergeNonIndexed([plateGeo, ...holeGeos]);
      return merged;
    },
  });

  ctx.showToast('info', 'Hole Wizard plugin loaded — hole cylinders show drill positions');
};
