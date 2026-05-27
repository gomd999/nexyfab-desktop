/**
 * clothDrape.ts — Mass-spring cloth drape simulation.
 *
 * Drape simulation answers: "If I lay a piece of leather / fabric /
 * thin-flexible plate over this part, what does it look like?" Used
 * for soft-good design (upholstery, sleeves, covers) and for sheet-
 * metal pre-visualization where springback matters.
 *
 * The classical mass-spring approach (Provot 1995):
 *
 *   - Mesh vertices are point masses.
 *   - Structural springs along mesh edges (resist stretch).
 *   - Shear springs along diagonals (resist shearing).
 *   - Bend springs across opposite vertices (resist folding).
 *   - Forces: gravity, spring restoration, damping, collision.
 *
 * Integration: explicit Verlet with iterative position projection
 * for constraint satisfaction (constant-length springs). Stable for
 * moderate stiffness; for very stiff fabric prefer implicit Euler.
 *
 * Output: deformed positions per timestep. Caller can keep the last
 * frame or animate through history.
 */

export type Vec3 = [number, number, number];

export interface ClothParticle {
  /** Initial / current position (mm). */
  position: Vec3;
  /** Previous position (Verlet). */
  previousPosition: Vec3;
  /** True if the particle is anchored (no motion). */
  pinned: boolean;
  /** Mass (kg). */
  mass: number;
}

export interface ClothSpring {
  particleA: number;
  particleB: number;
  /** Resting distance (mm). */
  restLengthMm: number;
  /** Stiffness scale (0..1, 1 = fully rigid). */
  stiffness: number;
  /** Kind: structural / shear / bend. */
  kind: 'structural' | 'shear' | 'bend';
}

export interface ClothMesh {
  particles: ClothParticle[];
  springs: ClothSpring[];
  /** Triangle indices (for collision and rendering). */
  triangles: number[];
}

export interface SimulationOptions {
  /** Gravity vector (mm/s²). */
  gravity: Vec3;
  /** Time step (s). */
  dtSec: number;
  /** Drag coefficient 0..1 per step. */
  drag: number;
  /** Spring constraint relaxation iterations per step. */
  springIterations: number;
  /** Optional collision plane (Y = floor). */
  floorY?: number;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  gravity: [0, -9810, 0], // mm/s²
  dtSec: 1 / 60,
  drag: 0.01,
  springIterations: 4,
};

// ── Build a grid cloth ──────────────────────────────────────────

export function buildGridCloth(
  width: number,
  height: number,
  resolution: number,
  particleMass: number = 0.01,
): ClothMesh {
  const particles: ClothParticle[] = [];
  const springs: ClothSpring[] = [];
  const triangles: number[] = [];
  const cellW = width / (resolution - 1);
  const cellH = height / (resolution - 1);
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const pos: Vec3 = [i * cellW - width / 2, 0, j * cellH - height / 2];
      particles.push({
        position: pos,
        previousPosition: [...pos] as Vec3,
        pinned: false,
        mass: particleMass,
      });
    }
  }
  const idx = (i: number, j: number) => j * resolution + i;
  // Structural springs (horizontal + vertical).
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      if (i < resolution - 1) springs.push({ particleA: idx(i, j), particleB: idx(i + 1, j), restLengthMm: cellW, stiffness: 1, kind: 'structural' });
      if (j < resolution - 1) springs.push({ particleA: idx(i, j), particleB: idx(i, j + 1), restLengthMm: cellH, stiffness: 1, kind: 'structural' });
    }
  }
  // Shear springs (diagonals).
  const diag = Math.hypot(cellW, cellH);
  for (let j = 0; j < resolution - 1; j++) {
    for (let i = 0; i < resolution - 1; i++) {
      springs.push({ particleA: idx(i, j), particleB: idx(i + 1, j + 1), restLengthMm: diag, stiffness: 0.5, kind: 'shear' });
      springs.push({ particleA: idx(i + 1, j), particleB: idx(i, j + 1), restLengthMm: diag, stiffness: 0.5, kind: 'shear' });
    }
  }
  // Bend springs (skip one vertex).
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution - 2; i++) {
      springs.push({ particleA: idx(i, j), particleB: idx(i + 2, j), restLengthMm: 2 * cellW, stiffness: 0.2, kind: 'bend' });
    }
  }
  for (let j = 0; j < resolution - 2; j++) {
    for (let i = 0; i < resolution; i++) {
      springs.push({ particleA: idx(i, j), particleB: idx(i, j + 2), restLengthMm: 2 * cellH, stiffness: 0.2, kind: 'bend' });
    }
  }
  // Triangles (2 per quad).
  for (let j = 0; j < resolution - 1; j++) {
    for (let i = 0; i < resolution - 1; i++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { particles, springs, triangles };
}

// ── Integration step ────────────────────────────────────────────

export function stepCloth(mesh: ClothMesh, opts: SimulationOptions): void {
  const dt = opts.dtSec;
  const dt2 = dt * dt;

  // Verlet integration with gravity + drag.
  for (const p of mesh.particles) {
    if (p.pinned) continue;
    const ax = opts.gravity[0];
    const ay = opts.gravity[1];
    const az = opts.gravity[2];
    const vx = (p.position[0] - p.previousPosition[0]) * (1 - opts.drag);
    const vy = (p.position[1] - p.previousPosition[1]) * (1 - opts.drag);
    const vz = (p.position[2] - p.previousPosition[2]) * (1 - opts.drag);
    const newX = p.position[0] + vx + ax * dt2;
    const newY = p.position[1] + vy + ay * dt2;
    const newZ = p.position[2] + vz + az * dt2;
    p.previousPosition = [...p.position] as Vec3;
    p.position = [newX, newY, newZ];
  }

  // Spring constraint relaxation.
  for (let iter = 0; iter < opts.springIterations; iter++) {
    for (const s of mesh.springs) {
      satisfySpring(mesh.particles, s);
    }
  }

  // Floor collision.
  if (opts.floorY !== undefined) {
    for (const p of mesh.particles) {
      if (p.position[1] < opts.floorY) {
        p.position = [p.position[0], opts.floorY, p.position[2]];
      }
    }
  }
}

function satisfySpring(particles: ClothParticle[], spring: ClothSpring): void {
  const a = particles[spring.particleA]!;
  const b = particles[spring.particleB]!;
  const dx = b.position[0] - a.position[0];
  const dy = b.position[1] - a.position[1];
  const dz = b.position[2] - a.position[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-9) return;
  const diff = (dist - spring.restLengthMm) / dist;
  const correction = spring.stiffness * 0.5 * diff;
  const w = (!a.pinned && !b.pinned) ? 1 : (a.pinned && b.pinned) ? 0 : 2;
  if (w === 0) return;
  if (!a.pinned) {
    a.position[0] += dx * correction * (w === 2 ? 1 : 1);
    a.position[1] += dy * correction * (w === 2 ? 1 : 1);
    a.position[2] += dz * correction * (w === 2 ? 1 : 1);
  }
  if (!b.pinned) {
    b.position[0] -= dx * correction * (w === 2 ? 1 : 1);
    b.position[1] -= dy * correction * (w === 2 ? 1 : 1);
    b.position[2] -= dz * correction * (w === 2 ? 1 : 1);
  }
}

// ── Anchor helpers ─────────────────────────────────────────────

export function pinByPredicate(mesh: ClothMesh, predicate: (p: ClothParticle, i: number) => boolean): number {
  let count = 0;
  for (let i = 0; i < mesh.particles.length; i++) {
    if (predicate(mesh.particles[i]!, i)) {
      mesh.particles[i]!.pinned = true;
      count++;
    }
  }
  return count;
}

export function unpinAll(mesh: ClothMesh): void {
  for (const p of mesh.particles) p.pinned = false;
}

// ── Diagnostics ─────────────────────────────────────────────────

export interface DrapeStats {
  particleCount: number;
  springCount: number;
  pinnedCount: number;
  averageStretch: number;
  maxStretch: number;
}

export function computeStats(mesh: ClothMesh): DrapeStats {
  let pinned = 0;
  for (const p of mesh.particles) if (p.pinned) pinned++;
  let sum = 0, max = 0;
  for (const s of mesh.springs) {
    const a = mesh.particles[s.particleA]!;
    const b = mesh.particles[s.particleB]!;
    const dist = Math.hypot(
      b.position[0] - a.position[0],
      b.position[1] - a.position[1],
      b.position[2] - a.position[2],
    );
    const stretch = dist / s.restLengthMm;
    sum += stretch;
    if (stretch > max) max = stretch;
  }
  const avg = mesh.springs.length > 0 ? sum / mesh.springs.length : 0;
  return {
    particleCount: mesh.particles.length,
    springCount: mesh.springs.length,
    pinnedCount: pinned,
    averageStretch: avg,
    maxStretch: max,
  };
}

// ── Pre-built scenarios ─────────────────────────────────────────

export function hangFromCornersScenario(width: number, height: number, resolution: number): ClothMesh {
  const mesh = buildGridCloth(width, height, resolution);
  pinByPredicate(mesh, (_p, i) => {
    const r = resolution;
    return i === 0 || i === r - 1 || i === r * r - 1 || i === r * r - r;
  });
  return mesh;
}

export function hangFromTopEdgeScenario(width: number, height: number, resolution: number): ClothMesh {
  const mesh = buildGridCloth(width, height, resolution);
  pinByPredicate(mesh, (_p, i) => i < resolution);
  return mesh;
}
