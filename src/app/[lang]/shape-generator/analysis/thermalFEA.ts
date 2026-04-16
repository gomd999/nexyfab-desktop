// Thermal Finite Element Analysis
// Solves steady-state heat conduction: ∇·(k∇T) = -Q
// Uses simplified FD/lumped-node approach for web performance

import * as THREE from 'three';

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

          // Collect available neighbours (handles boundary nodes with fewer than 6)
          const neighbourTemps: number[] = [];
          if (ix > 0)            neighbourTemps.push(temps[idx(ix-1,iy,iz)]);
          if (ix < gridSize - 1) neighbourTemps.push(temps[idx(ix+1,iy,iz)]);
          if (iy > 0)            neighbourTemps.push(temps[idx(ix,iy-1,iz)]);
          if (iy < gridSize - 1) neighbourTemps.push(temps[idx(ix,iy+1,iz)]);
          if (iz > 0)            neighbourTemps.push(temps[idx(ix,iy,iz-1)]);
          if (iz < gridSize - 1) neighbourTemps.push(temps[idx(ix,iy,iz+1)]);

          const numNeighbours = neighbourTemps.length;
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
    const fx = Math.min(gridSize - 2, Math.max(0, (vx - bb.min.x) / sx));
    const fy = Math.min(gridSize - 2, Math.max(0, (vy - bb.min.y) / sy));
    const fz = Math.min(gridSize - 2, Math.max(0, (vz - bb.min.z) / sz));

    const ix = Math.floor(fx), tx = fx - ix;
    const iy = Math.floor(fy), ty = fy - iy;
    const iz = Math.floor(fz), tz = fz - iz;

    const t000 = temps[idx(ix,iy,iz)];
    const t100 = temps[idx(ix+1,iy,iz)];
    const t010 = temps[idx(ix,iy+1,iz)];
    const t110 = temps[idx(ix+1,iy+1,iz)];
    const t001 = temps[idx(ix,iy,iz+1)];
    const t101 = temps[idx(ix+1,iy,iz+1)];
    const t011 = temps[idx(ix,iy+1,iz+1)];
    const t111 = temps[idx(ix+1,iy+1,iz+1)];

    vertexTemps[i] =
      t000*(1-tx)*(1-ty)*(1-tz) + t100*tx*(1-ty)*(1-tz) +
      t010*(1-tx)*ty*(1-tz) + t110*tx*ty*(1-tz) +
      t001*(1-tx)*(1-ty)*tz + t101*tx*(1-ty)*tz +
      t011*(1-tx)*ty*tz + t111*tx*ty*tz;
  }

  const maxTemp = Math.max(...vertexTemps);
  const minTemp = Math.min(...vertexTemps);

  // -----------------------------------------------------------------------
  // Compute heat flux vectors on the interior grid nodes via central differences
  // q = -k * ∇T    (Fourier's law)
  // -----------------------------------------------------------------------
  const gridFlux = new Array<THREE.Vector3>(nodes);
  for (let i = 0; i < nodes; i++) gridFlux[i] = new THREE.Vector3(0, 0, 0);

  for (let ix = 1; ix < gridSize - 1; ix++) {
    for (let iy = 1; iy < gridSize - 1; iy++) {
      for (let iz = 1; iz < gridSize - 1; iz++) {
        const n = idx(ix, iy, iz);
        const dTdx = (temps[idx(ix+1,iy,iz)] - temps[idx(ix-1,iy,iz)]) / (2 * sx);
        const dTdy = (temps[idx(ix,iy+1,iz)] - temps[idx(ix,iy-1,iz)]) / (2 * sy);
        const dTdz = (temps[idx(ix,iy,iz+1)] - temps[idx(ix,iy,iz-1)]) / (2 * sz);
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

    const fx = Math.min(gridSize - 2, Math.max(0, (vx - bb.min.x) / sx));
    const fy = Math.min(gridSize - 2, Math.max(0, (vy - bb.min.y) / sy));
    const fz = Math.min(gridSize - 2, Math.max(0, (vz - bb.min.z) / sz));

    const ix = Math.floor(fx), tx = fx - ix;
    const iy = Math.floor(fy), ty = fy - iy;
    const iz = Math.floor(fz), tz = fz - iz;

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
