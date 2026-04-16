import * as THREE from 'three';

export interface ArrayPattern {
  type: 'linear' | 'radial' | 'grid';
  // Linear
  countX: number;
  countY: number;
  countZ: number;
  spacingX: number;
  spacingY: number;
  spacingZ: number;
  // Radial
  radialCount: number;
  radialRadius: number;
  radialAxis: 'x' | 'y' | 'z';
  // Grid (2D in XZ plane)
  // uses countX / countZ / spacingX / spacingZ
}

export function buildInstanceMatrices(pattern: ArrayPattern): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = [];

  if (pattern.type === 'linear') {
    for (let z = 0; z < pattern.countZ; z++) {
      for (let y = 0; y < pattern.countY; y++) {
        for (let x = 0; x < pattern.countX; x++) {
          const m = new THREE.Matrix4();
          m.makeTranslation(
            x * pattern.spacingX,
            y * pattern.spacingY,
            z * pattern.spacingZ,
          );
          matrices.push(m);
        }
      }
    }
  } else if (pattern.type === 'radial') {
    const count = Math.max(1, pattern.radialCount);
    const angleStep = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const angle = i * angleStep;
      let x = 0, y = 0, z = 0;
      if (pattern.radialAxis === 'y') {
        x = Math.cos(angle) * pattern.radialRadius;
        z = Math.sin(angle) * pattern.radialRadius;
      } else if (pattern.radialAxis === 'x') {
        y = Math.cos(angle) * pattern.radialRadius;
        z = Math.sin(angle) * pattern.radialRadius;
      } else {
        // z axis
        x = Math.cos(angle) * pattern.radialRadius;
        y = Math.sin(angle) * pattern.radialRadius;
      }

      const rot = new THREE.Matrix4();
      if (pattern.radialAxis === 'y') {
        rot.makeRotationY(angle);
      } else if (pattern.radialAxis === 'x') {
        rot.makeRotationX(angle);
      } else {
        rot.makeRotationZ(angle);
      }

      const trans = new THREE.Matrix4().makeTranslation(x, y, z);
      const m = new THREE.Matrix4().multiplyMatrices(trans, rot);
      matrices.push(m);
    }
  } else if (pattern.type === 'grid') {
    // 2D grid in XZ plane
    for (let z = 0; z < pattern.countZ; z++) {
      for (let x = 0; x < pattern.countX; x++) {
        const m = new THREE.Matrix4();
        m.makeTranslation(x * pattern.spacingX, 0, z * pattern.spacingZ);
        matrices.push(m);
      }
    }
  }

  return matrices;
}

export function instanceCount(pattern: ArrayPattern): number {
  if (pattern.type === 'linear') return pattern.countX * pattern.countY * pattern.countZ;
  if (pattern.type === 'radial') return pattern.radialCount;
  // grid
  return pattern.countX * pattern.countZ;
}
