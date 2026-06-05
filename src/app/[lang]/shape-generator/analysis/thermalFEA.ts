// Thermal Finite Element Analysis
// Solves steady-state heat conduction: ∇·(k∇T) = -Q
// Uses simplified FD/lumped-node approach for web performance

import * as THREE from 'three';
import { pointInsideSurface } from './femSolver';

export interface ThermalBoundary {
  type: 'heat_source' | 'fixed_temp' | 'convection';
  faceIndex: number;
  value: number; // W for heat_source, °C for fixed_temp, h*A for convection
  ambientTemp?: number; // for convection
}

export interface ThermalResult {
  temperatures: Float32Array; // per-vertex temperature in °C
  maxTemp: number;
  minTemp: number;
  heatFlux: THREE.Vector3[]; // heat flux vectors per face
  hotspots: Array<{ position: THREE.Vector3; temperature: number }>;
}

export interface ThermalMaterial {
  conductivity: number; // W/(m·K)
  density: number; // kg/m³
  specificHeat: number; // J/(kg·K)
}

export const THERMAL_MATERIALS: Record<string, ThermalMaterial & { name: string; nameKo: string }> = {
  steel: { name: 'Steel', nameKo: '강철', conductivity: 50, density: 7850, specificHeat: 490 },
  aluminum: { name: 'Aluminum', nameKo: '알루미늄', conductivity: 205, density: 2700, specificHeat: 900 },
  copper: { name: 'Copper', nameKo: '구리', conductivity: 385, density: 8960, specificHeat: 385 },
  titanium: { name: 'Titanium', nameKo: '티타늄', conductivity: 22, density: 4500, specificHeat: 520 },
  abs: { name: 'ABS Plastic', nameKo: 'ABS 플라스틱', conductivity: 0.17, density: 1050, specificHeat: 1400 },
  pla: { name: 'PLA Plastic', nameKo: 'PLA 플라스틱', conductivity: 0.13, density: 1240, specificHeat: 1800 },
};

/**
 * Run steady-state thermal analysis using lumped capacitance node network.
 * Simplified but physically meaningful for design guidance.
 */
export function runThermalFEA(
  geometry: THREE.BufferGeometry,
  boundaries: ThermalBoundary[],
  material: ThermalMaterial,
  ambientTemp = 25,
): ThermalResult {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;

  // Create a regular grid of nodes inside the bounding box
  const gridSize = 8; // 8x8x8 grid = 512 nodes (web-friendly)
  const nodes = gridSize * gridSize * gridSize;
  const temps = new Float32Array(nodes).fill(ambientTemp);
  const k = material.conductivity;

  const sx = (bb.max.x - bb.min.x) / (gridSize - 1);
  const sy = (bb.max.y - bb.min.y) / (gridSize - 1);
  const sz = (bb.max.z - bb.min.z) / (gridSize - 1);

  function idx(ix: number, iy: number, iz: number) {
    return ix * gridSize * gridSize + iy * gridSize + iz;
  }

  // ── Point-in-solid mask ──
  // The grid spans the bounding box; only nodes INSIDE the actual solid should conduct.
  // Without this, a non-convex part (L-bracket, two separated bodies, a notch) would
  // diffuse heat across the empty bounding-box volume — heat flowing through air. We mark
  // each grid node inside/outside via ray-parity (the same test femSolver uses) and treat
  // outside nodes as inactive: they don't conduct and are excluded from neighbour averages
  // and from the grid→vertex interpolation.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const fp = flat.attributes.position as THREE.BufferAttribute;
  const triCountSolid = Math.floor(fp.count / 3);
  const tri = new Float32Array(fp.count * 3);
  for (let i = 0; i < fp.count; i++) { tri[i*3] = fp.getX(i); tri[i*3+1] = fp.getY(i); tri[i*3+2] = fp.getZ(i); }
  // Mark by CELL CENTRE (jittered), not by node: a node is active if any of the up-to-8
  // cells touching it has its centre inside the solid. Testing nodes directly is
  // degenerate on the bounding-box boundary planes — with +X-ish rays the −X faces test
  // "inside" but the +X faces test "outside", which would silently drop the Dirichlet BC
  // on a max face. Cell-centre sampling (femSolver's approach) avoids that entirely and a
  // solid box keeps every node active.
  const active = new Uint8Array(nodes);
  let activeCount = 0;
  const mark = (ix: number, iy: number, iz: number) => {
    const n = idx(ix, iy, iz); if (!active[n]) { active[n] = 1; activeCount++; }
  };
  for (let cx = 0; cx < gridSize - 1; cx++) {
    for (let cy = 0; cy < gridSize - 1; cy++) {
      for (let cz = 0; cz < gridSize - 1; cz++) {
        const px = bb.min.x + (cx + 0.5 + 0.0137) * sx;
        const py = bb.min.y + (cy + 0.5 + 0.0237) * sy;
        const pz = bb.min.z + (cz + 0.5 + 0.0111) * sz;
        if (pointInsideSurface(px, py, pz, tri, triCountSolid)) {
          for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) for (let dk = 0; dk < 2; dk++)
            mark(cx + di, cy + dj, cz + dk);
        }
      }
    }
  }
  // Fallback: if the sampling found nothing inside (tiny/thin part vs coarse grid), treat
  // every node as active so the solver still returns a field rather than all-ambient.
  if (activeCount === 0) active.fill(1);

  // Apply boundary conditions
  const fixedNodes = new Set<number>();
  const heatSources = new Float32Array(nodes);
  // convection nodes: maps node index → { h coefficient, ambient temperature }
  const convectionNodes = new Map<number, { h: number; amb: number }>();

  // Map faceIndex to grid face slices:
  //   0 = -Y (bottom), 1 = +Y (top),
  //   2 = -X (left),   3 = +X (right),
  //   4 = -Z (front),  5 = +Z (back)
  function getFaceNodes(faceIndex: number): number[] {
    const result: number[] = [];
    switch (faceIndex) {
      case 0: // -Y bottom
        for (let ix = 0; ix < gridSize; ix++)
          for (let iz = 0; iz < gridSize; iz++)
            result.push(idx(ix, 0, iz));
        break;
      case 1: // +Y top
        for (let ix = 0; ix < gridSize; ix++)
          for (let iz = 0; iz < gridSize; iz++)
            result.push(idx(ix, gridSize - 1, iz));
        break;
      case 2: // -X left
        for (let iy = 0; iy < gridSize; iy++)
          for (let iz = 0; iz < gridSize; iz++)
            result.push(idx(0, iy, iz));
        break;
      case 3: // +X right
        for (let iy = 0; iy < gridSize; iy++)
          for (let iz = 0; iz < gridSize; iz++)
            result.push(idx(gridSize - 1, iy, iz));
        break;
      case 4: // -Z front
        for (let ix = 0; ix < gridSize; ix++)
          for (let iy = 0; iy < gridSize; iy++)
            result.push(idx(ix, iy, 0));
        break;
      case 5: // +Z back
        for (let ix = 0; ix < gridSize; ix++)
          for (let iy = 0; iy < gridSize; iy++)
            result.push(idx(ix, iy, gridSize - 1));
        break;
      default: // fallback: all faces (e.g. volumetric source)
        for (let ix = 0; ix < gridSize; ix++)
          for (let iy = 0; iy < gridSize; iy++)
            for (let iz = 0; iz < gridSize; iz++)
              result.push(idx(ix, iy, iz));
    }
    return result;
  }

  for (const bc of boundaries) {
    const faceNodes = getFaceNodes(bc.faceIndex);
    for (const n of faceNodes) {
      if (bc.type === 'fixed_temp') {
        temps[n] = bc.value;
        fixedNodes.add(n);
      } else if (bc.type === 'heat_source') {
        heatSources[n] += bc.value / faceNodes.length;
      } else if (bc.type === 'convection') {
        const amb = bc.ambientTemp ?? ambientTemp;
        // Accumulate convection contributions (multiple BCs on same node sum up)
        const existing = convectionNodes.get(n);
        if (existing) {
          existing.h += bc.value;
          // weighted average of ambient temps proportional to h
          existing.amb = (existing.amb * (existing.h - bc.value) + amb * bc.value) / existing.h;
        } else {
          convectionNodes.set(n, { h: bc.value, amb });
        }
      }
    }
  }

  // Jacobi iteration (steady-state heat conduction)
  // Governing equation per interior node (finite difference):
  //   k * (sum of 6 neighbour temps - 6*T) / h² = -Q   (Q = volumetric source)
  // With convection BC on boundary/surface node:
  //   adds h_conv*(T_amb - T) to the RHS, modifies effective diagonal
  const MAX_ITER = 500;
  const tolerance = 0.01;
  const conductance = k; // simplified: uniform conductance

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const newTemps = new Float32Array(temps);
    let maxDelta = 0;

    for (let ix = 0; ix < gridSize; ix++) {
      for (let iy = 0; iy < gridSize; iy++) {
        for (let iz = 0; iz < gridSize; iz++) {
          const n = idx(ix, iy, iz);
          if (fixedNodes.has(n)) continue;
          if (!active[n]) continue; // outside the solid — does not conduct

          // Collect available SOLID neighbours (boundary/void nodes excluded). A node with
          // only inactive (void) neighbours on one side gets an insulated boundary there.
          const neighbourTemps: number[] = [];
          if (ix > 0            && active[idx(ix-1,iy,iz)]) neighbourTemps.push(temps[idx(ix-1,iy,iz)]);
          if (ix < gridSize - 1 && active[idx(ix+1,iy,iz)]) neighbourTemps.push(temps[idx(ix+1,iy,iz)]);
          if (iy > 0            && active[idx(ix,iy-1,iz)]) neighbourTemps.push(temps[idx(ix,iy-1,iz)]);
          if (iy < gridSize - 1 && active[idx(ix,iy+1,iz)]) neighbourTemps.push(temps[idx(ix,iy+1,iz)]);
          if (iz > 0            && active[idx(ix,iy,iz-1)]) neighbourTemps.push(temps[idx(ix,iy,iz-1)]);
          if (iz < gridSize - 1 && active[idx(ix,iy,iz+1)]) neighbourTemps.push(temps[idx(ix,iy,iz+1)]);

          const numNeighbours = neighbourTemps.length;
          if (numNeighbours === 0) continue; // isolated node — nothing to average
          const sumNeighbours = neighbourTemps.reduce((s, v) => s + v, 0);
          const source = heatSources[n] / (conductance * (sx + sy + sz) / 3);

          // Apply convection BC (Newton's law of cooling):
          //   q_conv = h * (T_amb - T)  →  modify diagonal and RHS
          //   newT = (sumNeighbours + source + h*T_amb) / (numNeighbours + h)
          const conv = convectionNodes.get(n);
          if (conv) {
            newTemps[n] = (sumNeighbours + source + conv.h * conv.amb) / (numNeighbours + conv.h);
          } else {
            newTemps[n] = (sumNeighbours + source) / numNeighbours;
          }

          maxDelta = Math.max(maxDelta, Math.abs(newTemps[n] - temps[n]));
        }
      }
    }

    temps.set(newTemps);
    if (maxDelta < tolerance) break;
  }

  // Map grid temperatures to mesh vertices
  const positions = geometry.attributes.position;
  const vertexTemps = new Float32Array(positions.count);

  for (let i = 0; i < positions.count; i++) {
    const vx = positions.getX(i);
    const vy = positions.getY(i);
    const vz = positions.getZ(i);

    // Trilinear interpolation from grid to vertex
    // Clamp the fractional coordinate to [0, gridSize-1] (so a vertex on the high-side
    // face can reach the last grid plane and pick up a fixed-temperature BC there), but
    // keep the stencil base index ≤ gridSize-2 so ix+1 stays in range. The previous
    // clamp capped fx at gridSize-2, leaving tx=0 on the max faces — surface vertices
    // never sampled the boundary plane, so a fixed cold face read one step in (~14% off).
    const fx = Math.max(0, Math.min(gridSize - 1, (vx - bb.min.x) / sx));
    const fy = Math.max(0, Math.min(gridSize - 1, (vy - bb.min.y) / sy));
    const fz = Math.max(0, Math.min(gridSize - 1, (vz - bb.min.z) / sz));

    const ix = Math.min(gridSize - 2, Math.floor(fx)), tx = fx - ix;
    const iy = Math.min(gridSize - 2, Math.floor(fy)), ty = fy - iy;
    const iz = Math.min(gridSize - 2, Math.floor(fz)), tz = fz - iz;

    // Trilinear blend over the 8 cell corners, but weight only ACTIVE (in-solid) corners
    // and renormalise — a surface vertex next to the void must not blend in an inactive
    // node still sitting at the ambient seed value.
    const corners: Array<[number, number, number, number]> = [
      [idx(ix,iy,iz),       (1-tx)*(1-ty)*(1-tz), 0, 0],
      [idx(ix+1,iy,iz),     tx*(1-ty)*(1-tz),     0, 0],
      [idx(ix,iy+1,iz),     (1-tx)*ty*(1-tz),     0, 0],
      [idx(ix+1,iy+1,iz),   tx*ty*(1-tz),         0, 0],
      [idx(ix,iy,iz+1),     (1-tx)*(1-ty)*tz,     0, 0],
      [idx(ix+1,iy,iz+1),   tx*(1-ty)*tz,         0, 0],
      [idx(ix,iy+1,iz+1),   (1-tx)*ty*tz,         0, 0],
      [idx(ix+1,iy+1,iz+1), tx*ty*tz,             0, 0],
    ];
    let wSum = 0, tSum = 0;
    for (const [ci, w] of corners) { if (active[ci]) { wSum += w; tSum += w * temps[ci]; } }
    if (wSum > 1e-9) {
      vertexTemps[i] = tSum / wSum;
    } else {
      // all corners inactive (vertex sits between cells) — use the nearest grid node
      let best = idx(ix,iy,iz), bestW = -1;
      for (const [ci, w] of corners) { if (w > bestW) { bestW = w; best = ci; } }
      vertexTemps[i] = temps[best];
    }
  }

  const maxTemp = Math.max(...vertexTemps);
  const minTemp = Math.min(...vertexTemps);

  // -----------------------------------------------------------------------
  // Compute heat flux vectors on the interior grid nodes via central differences
  // q = -k * ∇T    (Fourier's law)
  // -----------------------------------------------------------------------
  const gridFlux = new Array<THREE.Vector3>(nodes);
  for (let i = 0; i < nodes; i++) gridFlux[i] = new THREE.Vector3(0, 0, 0);

  // Compute flux at EVERY grid node (central difference in the interior, one-sided at the
  // faces). Boundary nodes used to be left at zero flux, which — together with the fixed
  // trilinear clamp that now reaches the last plane — would make surface flux read zero.
  // The (hi−lo) step is 2 cells in the interior and 1 at a face, so the difference is
  // correctly scaled either way.
  for (let ix = 0; ix < gridSize; ix++) {
    for (let iy = 0; iy < gridSize; iy++) {
      for (let iz = 0; iz < gridSize; iz++) {
        const n = idx(ix, iy, iz);
        const xp = Math.min(gridSize - 1, ix + 1), xm = Math.max(0, ix - 1);
        const yp = Math.min(gridSize - 1, iy + 1), ym = Math.max(0, iy - 1);
        const zp = Math.min(gridSize - 1, iz + 1), zm = Math.max(0, iz - 1);
        const dTdx = (temps[idx(xp,iy,iz)] - temps[idx(xm,iy,iz)]) / ((xp - xm) * sx);
        const dTdy = (temps[idx(ix,yp,iz)] - temps[idx(ix,ym,iz)]) / ((yp - ym) * sy);
        const dTdz = (temps[idx(ix,iy,zp)] - temps[idx(ix,iy,zm)]) / ((zp - zm) * sz);
        gridFlux[n].set(-k * dTdx, -k * dTdy, -k * dTdz);
      }
    }
  }

  // Trilinearly interpolate flux vectors to mesh vertices
  const heatFlux: THREE.Vector3[] = new Array(positions.count);
  for (let i = 0; i < positions.count; i++) {
    const vx = positions.getX(i);
    const vy = positions.getY(i);
    const vz = positions.getZ(i);

    // Clamp the fractional coordinate to [0, gridSize-1] (so a vertex on the high-side
    // face can reach the last grid plane and pick up a fixed-temperature BC there), but
    // keep the stencil base index ≤ gridSize-2 so ix+1 stays in range. The previous
    // clamp capped fx at gridSize-2, leaving tx=0 on the max faces — surface vertices
    // never sampled the boundary plane, so a fixed cold face read one step in (~14% off).
    const fx = Math.max(0, Math.min(gridSize - 1, (vx - bb.min.x) / sx));
    const fy = Math.max(0, Math.min(gridSize - 1, (vy - bb.min.y) / sy));
    const fz = Math.max(0, Math.min(gridSize - 1, (vz - bb.min.z) / sz));

    const ix = Math.min(gridSize - 2, Math.floor(fx)), tx = fx - ix;
    const iy = Math.min(gridSize - 2, Math.floor(fy)), ty = fy - iy;
    const iz = Math.min(gridSize - 2, Math.floor(fz)), tz = fz - iz;

    // Trilinear interpolation weights
    const w000 = (1-tx)*(1-ty)*(1-tz);
    const w100 = tx*(1-ty)*(1-tz);
    const w010 = (1-tx)*ty*(1-tz);
    const w110 = tx*ty*(1-tz);
    const w001 = (1-tx)*(1-ty)*tz;
    const w101 = tx*(1-ty)*tz;
    const w011 = (1-tx)*ty*tz;
    const w111 = tx*ty*tz;

    const f000 = gridFlux[idx(ix,iy,iz)];
    const f100 = gridFlux[idx(ix+1,iy,iz)];
    const f010 = gridFlux[idx(ix,iy+1,iz)];
    const f110 = gridFlux[idx(ix+1,iy+1,iz)];
    const f001 = gridFlux[idx(ix,iy,iz+1)];
    const f101 = gridFlux[idx(ix+1,iy,iz+1)];
    const f011 = gridFlux[idx(ix,iy+1,iz+1)];
    const f111 = gridFlux[idx(ix+1,iy+1,iz+1)];

    heatFlux[i] = new THREE.Vector3(
      f000.x*w000 + f100.x*w100 + f010.x*w010 + f110.x*w110 +
      f001.x*w001 + f101.x*w101 + f011.x*w011 + f111.x*w111,
      f000.y*w000 + f100.y*w100 + f010.y*w010 + f110.y*w110 +
      f001.y*w001 + f101.y*w101 + f011.y*w011 + f111.y*w111,
      f000.z*w000 + f100.z*w100 + f010.z*w010 + f110.z*w110 +
      f001.z*w001 + f101.z*w101 + f011.z*w011 + f111.z*w111,
    );
  }

  // -----------------------------------------------------------------------
  // Hotspot detection with spatial deduplication (min 10 mm apart, up to 8)
  // -----------------------------------------------------------------------
  const MIN_HOTSPOT_DIST = 10; // mm
  const MAX_HOTSPOTS = 8;
  const hotspots: Array<{ position: THREE.Vector3; temperature: number }> = [];

  // Sort vertex indices by temperature descending
  const sortedIndices = Array.from({ length: positions.count }, (_, i) => i)
    .sort((a, b) => vertexTemps[b] - vertexTemps[a]);

  const threshold = minTemp + (maxTemp - minTemp) * 0.9;

  for (const i of sortedIndices) {
    if (vertexTemps[i] < threshold) break; // sorted desc, no more candidates
    const pos = new THREE.Vector3(positions.getX(i), positions.getY(i), positions.getZ(i));

    // Check minimum distance from already accepted hotspots
    let tooClose = false;
    for (const hs of hotspots) {
      if (hs.position.distanceTo(pos) < MIN_HOTSPOT_DIST) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    hotspots.push({ position: pos, temperature: vertexTemps[i] });
    if (hotspots.length >= MAX_HOTSPOTS) break;
  }

  return {
    temperatures: vertexTemps,
    maxTemp,
    minTemp,
    heatFlux,
    hotspots,
  };
}

export function applyThermalColormap(geometry: THREE.BufferGeometry, result: ThermalResult): THREE.BufferGeometry {
  const geo = geometry.clone();
  const temps = result.temperatures;
  const range = result.maxTemp - result.minTemp || 1;
  const colors = new Float32Array(temps.length * 3);

  for (let i = 0; i < temps.length; i++) {
    const t = (temps[i] - result.minTemp) / range;
    // Blue (cold) → Cyan → Green → Yellow → Red (hot)
    let r: number, g: number, b: number;
    if (t < 0.25) { r = 0; g = t * 4; b = 1; }
    else if (t < 0.5) { r = 0; g = 1; b = 1 - (t - 0.25) * 4; }
    else if (t < 0.75) { r = (t - 0.5) * 4; g = 1; b = 0; }
    else { r = 1; g = 1 - (t - 0.75) * 4; b = 0; }
    colors[i*3] = r; colors[i*3+1] = g; colors[i*3+2] = b;
  }

  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}
