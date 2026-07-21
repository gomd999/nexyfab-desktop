/**
 * particleSystem.ts — Emitter-based particle system.
 *
 * For renders that need smoke, sparks, dust, falling leaves — or
 * for engineering simulations where many small entities follow
 * the same rules (sand flow, debris, paint spray). Builds on a
 * familiar Houdini-style "emitter + force field + integrator" stack:
 *
 *   - **Emitter** spawns particles at a defined rate with initial
 *     velocity / lifetime / size.
 *   - **Force fields** (gravity, drag, vortex, attractors) modify
 *     velocities every step.
 *   - **Integrator** advances positions (semi-implicit Euler).
 *   - **Collider** clamps particles to a plane / sphere / bbox.
 *
 * Output is the per-step particle list (alive only). Renderer
 * draws each as a sprite / billboard / streak.
 */

export type Vec3 = [number, number, number];

export interface Particle {
  id: number;
  position: Vec3;
  velocity: Vec3;
  /** Seconds since spawn. */
  age: number;
  /** Total lifetime in seconds. */
  lifetime: number;
  /** Initial size (mm). */
  size: number;
  /** Per-particle scalar (color/alpha lookup driver). */
  scalar: number;
}

export interface ParticleEmitter {
  /** Position of emission (mm). */
  origin: Vec3;
  /** Particles per second. */
  rate: number;
  /** Mean lifetime (s). */
  lifetimeSec: number;
  /** Spawn lifetime jitter (s). */
  lifetimeJitter: number;
  /** Mean speed (mm/s). */
  speedMmPerSec: number;
  /** Cone half-angle (rad). 0 = perfectly directed; π = isotropic. */
  coneHalfAngle: number;
  /** Direction (unit). */
  direction: Vec3;
  /** Spawn size (mm). */
  sizeMm: number;
}

export type ForceField =
  | { kind: 'gravity'; vector: Vec3 }
  | { kind: 'drag'; coefficient: number }
  | { kind: 'point-attractor'; position: Vec3; strength: number; falloff: number }
  | { kind: 'vortex'; center: Vec3; axis: Vec3; strength: number };

export type Collider =
  | { kind: 'plane'; pointMm: Vec3; normal: Vec3; restitution: number }
  | { kind: 'sphere'; center: Vec3; radius: number; restitution: number }
  | { kind: 'aabb'; min: Vec3; max: Vec3 };

export interface ParticleSystem {
  particles: Particle[];
  emitter: ParticleEmitter;
  forces: ForceField[];
  colliders: Collider[];
  /** Internal RNG state. */
  rngSeed: number;
  /** Time accumulated between spawn cycles. */
  spawnAccumulatorSec: number;
  /** Next particle id. */
  nextId: number;
}

// ── Construction ────────────────────────────────────────────────

export function createSystem(emitter: ParticleEmitter, forces: ForceField[] = [], colliders: Collider[] = []): ParticleSystem {
  return {
    particles: [],
    emitter,
    forces,
    colliders,
    rngSeed: 42,
    spawnAccumulatorSec: 0,
    nextId: 0,
  };
}

// ── Step ────────────────────────────────────────────────────────

export function stepSystem(system: ParticleSystem, dtSec: number): void {
  emit(system, dtSec);
  applyForces(system, dtSec);
  integrate(system, dtSec);
  collide(system);
  reapDead(system);
}

function emit(system: ParticleSystem, dtSec: number): void {
  system.spawnAccumulatorSec += dtSec;
  const spawnCount = Math.floor(system.spawnAccumulatorSec * system.emitter.rate);
  system.spawnAccumulatorSec -= spawnCount / system.emitter.rate;
  for (let i = 0; i < spawnCount; i++) {
    system.particles.push(spawnOne(system));
  }
}

function spawnOne(system: ParticleSystem): Particle {
  const e = system.emitter;
  const dir = sampleCone(e.direction, e.coneHalfAngle, () => nextRandom(system));
  const speed = e.speedMmPerSec * (0.8 + 0.4 * nextRandom(system));
  const lifetime = e.lifetimeSec + (nextRandom(system) - 0.5) * 2 * e.lifetimeJitter;
  return {
    id: system.nextId++,
    position: [...e.origin],
    velocity: [dir[0] * speed, dir[1] * speed, dir[2] * speed],
    age: 0,
    lifetime: Math.max(0.01, lifetime),
    size: e.sizeMm,
    scalar: nextRandom(system),
  };
}

function applyForces(system: ParticleSystem, dtSec: number): void {
  for (const p of system.particles) {
    for (const f of system.forces) {
      applyForce(f, p, dtSec);
    }
  }
}

function applyForce(force: ForceField, p: Particle, dt: number): void {
  switch (force.kind) {
    case 'gravity':
      p.velocity[0] += force.vector[0] * dt;
      p.velocity[1] += force.vector[1] * dt;
      p.velocity[2] += force.vector[2] * dt;
      break;
    case 'drag': {
      const f = Math.max(0, 1 - force.coefficient * dt);
      p.velocity[0] *= f;
      p.velocity[1] *= f;
      p.velocity[2] *= f;
      break;
    }
    case 'point-attractor': {
      const dx = force.position[0] - p.position[0];
      const dy = force.position[1] - p.position[1];
      const dz = force.position[2] - p.position[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 1e-6) return;
      const fmag = force.strength / Math.pow(dist, force.falloff);
      p.velocity[0] += (dx / dist) * fmag * dt;
      p.velocity[1] += (dy / dist) * fmag * dt;
      p.velocity[2] += (dz / dist) * fmag * dt;
      break;
    }
    case 'vortex': {
      const dx = p.position[0] - force.center[0];
      const dy = p.position[1] - force.center[1];
      const dz = p.position[2] - force.center[2];
      // v_tangent = axis × (p - center)
      const tx = force.axis[1] * dz - force.axis[2] * dy;
      const ty = force.axis[2] * dx - force.axis[0] * dz;
      const tz = force.axis[0] * dy - force.axis[1] * dx;
      p.velocity[0] += tx * force.strength * dt;
      p.velocity[1] += ty * force.strength * dt;
      p.velocity[2] += tz * force.strength * dt;
      break;
    }
  }
}

function integrate(system: ParticleSystem, dt: number): void {
  for (const p of system.particles) {
    p.position[0] += p.velocity[0] * dt;
    p.position[1] += p.velocity[1] * dt;
    p.position[2] += p.velocity[2] * dt;
    p.age += dt;
  }
}

function collide(system: ParticleSystem): void {
  for (const p of system.particles) {
    for (const c of system.colliders) {
      resolveCollision(c, p);
    }
  }
}

function resolveCollision(collider: Collider, p: Particle): void {
  switch (collider.kind) {
    case 'plane': {
      const dx = p.position[0] - collider.pointMm[0];
      const dy = p.position[1] - collider.pointMm[1];
      const dz = p.position[2] - collider.pointMm[2];
      const signed = dx * collider.normal[0] + dy * collider.normal[1] + dz * collider.normal[2];
      if (signed < 0) {
        // Move back to surface.
        p.position[0] -= signed * collider.normal[0];
        p.position[1] -= signed * collider.normal[1];
        p.position[2] -= signed * collider.normal[2];
        // Reflect velocity.
        const dotV = p.velocity[0] * collider.normal[0] + p.velocity[1] * collider.normal[1] + p.velocity[2] * collider.normal[2];
        if (dotV < 0) {
          p.velocity[0] -= (1 + collider.restitution) * dotV * collider.normal[0];
          p.velocity[1] -= (1 + collider.restitution) * dotV * collider.normal[1];
          p.velocity[2] -= (1 + collider.restitution) * dotV * collider.normal[2];
        }
      }
      break;
    }
    case 'sphere': {
      const dx = p.position[0] - collider.center[0];
      const dy = p.position[1] - collider.center[1];
      const dz = p.position[2] - collider.center[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < collider.radius && dist > 0) {
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        p.position[0] = collider.center[0] + nx * collider.radius;
        p.position[1] = collider.center[1] + ny * collider.radius;
        p.position[2] = collider.center[2] + nz * collider.radius;
        const dotV = p.velocity[0] * nx + p.velocity[1] * ny + p.velocity[2] * nz;
        if (dotV < 0) {
          p.velocity[0] -= (1 + collider.restitution) * dotV * nx;
          p.velocity[1] -= (1 + collider.restitution) * dotV * ny;
          p.velocity[2] -= (1 + collider.restitution) * dotV * nz;
        }
      }
      break;
    }
    case 'aabb': {
      // Clamp to bbox; kill velocity along clamped axis.
      for (let axis = 0; axis < 3; axis++) {
        if (p.position[axis]! < collider.min[axis]!) {
          p.position[axis] = collider.min[axis]!;
          p.velocity[axis] = 0;
        } else if (p.position[axis]! > collider.max[axis]!) {
          p.position[axis] = collider.max[axis]!;
          p.velocity[axis] = 0;
        }
      }
      break;
    }
  }
}

function reapDead(system: ParticleSystem): void {
  system.particles = system.particles.filter(p => p.age < p.lifetime);
}

// ── RNG ─────────────────────────────────────────────────────────

function nextRandom(system: ParticleSystem): number {
  // Math.imul keeps the multiply exact in 32-bit space. The float form
  // (rngSeed * 1103515245) overflows 2^53 and collapses the LCG into a
  // ~10k cycle with heavy bin bias (see meshCompare.ts sampleIndices).
  system.rngSeed = (Math.imul(system.rngSeed, 1103515245) + 12345) & 0x7fffffff;
  return system.rngSeed / 0x7fffffff;
}

function sampleCone(direction: Vec3, halfAngle: number, rng: () => number): Vec3 {
  // Sample within cone.
  const cosTheta = 1 - rng() * (1 - Math.cos(halfAngle));
  const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
  const phi = 2 * Math.PI * rng();
  // Build orthonormal basis around direction.
  const z = normalize(direction);
  const seed: Vec3 = Math.abs(z[2]) < 0.95 ? [0, 0, 1] : [1, 0, 0];
  const xAxis = normalize(cross(seed, z));
  const yAxis = cross(z, xAxis);
  return [
    sinTheta * Math.cos(phi) * xAxis[0] + sinTheta * Math.sin(phi) * yAxis[0] + cosTheta * z[0],
    sinTheta * Math.cos(phi) * xAxis[1] + sinTheta * Math.sin(phi) * yAxis[1] + cosTheta * z[1],
    sinTheta * Math.cos(phi) * xAxis[2] + sinTheta * Math.sin(phi) * yAxis[2] + cosTheta * z[2],
  ];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ── Stats ───────────────────────────────────────────────────────

export interface SystemStats {
  particleCount: number;
  meanAge: number;
  oldestAge: number;
  averageSpeed: number;
}

export function summarizeSystem(system: ParticleSystem): SystemStats {
  if (system.particles.length === 0) return { particleCount: 0, meanAge: 0, oldestAge: 0, averageSpeed: 0 };
  let totalAge = 0;
  let oldest = 0;
  let totalSpeed = 0;
  for (const p of system.particles) {
    totalAge += p.age;
    if (p.age > oldest) oldest = p.age;
    totalSpeed += Math.hypot(p.velocity[0], p.velocity[1], p.velocity[2]);
  }
  return {
    particleCount: system.particles.length,
    meanAge: totalAge / system.particles.length,
    oldestAge: oldest,
    averageSpeed: totalSpeed / system.particles.length,
  };
}
