/**
 * Visual Shape Program
 *
 * A scene-level contract for concept models whose primary goal is a coherent,
 * high-quality 3D presentation.  It is deliberately separate from the
 * manufacturing feature program: a visually convincing scene is not evidence
 * that a part is manufacturable.
 */

export type VisualPartRole =
  | 'outer_shell'
  | 'structure'
  | 'mechanism'
  | 'propulsion'
  | 'interior'
  | 'detail';

export type VisualMaterial = {
  color: `#${string}`;
  metalness: number;
  roughness: number;
  opacity?: number;
};

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export type VisualGeometry =
  | { kind: 'loft'; sections: Array<{ z: number; profile: Vec2[] }> }
  | { kind: 'revolve'; profile: Vec2[]; segments?: number }
  | { kind: 'sweep'; profile: Vec2[]; path: Vec3[] }
  | { kind: 'box'; size: Vec3; radius?: number }
  | { kind: 'cylinder'; radius: number; length: number; segments?: number };

export type VisualPart = {
  id: string;
  name: string;
  role: VisualPartRole;
  geometry: VisualGeometry;
  material: VisualMaterial;
  position?: Vec3;
  rotation?: Vec3;
  mirrorOf?: string;
  cutaway?: boolean;
};

export type VisualShapeProgram = {
  version: 1;
  classification: 'concept_only';
  name: string;
  units: 'mm';
  parts: VisualPart[];
  view?: { preset: 'isometric' | 'top' | 'side' | 'cutaway'; exploded: number };
};

export type VisualProgramIssue = { path: string; message: string };

const finite = (n: number) => Number.isFinite(n);
const validVec = (v: readonly number[], length: number) =>
  v.length === length && v.every(finite);

export function validateVisualShapeProgram(program: VisualShapeProgram): VisualProgramIssue[] {
  const issues: VisualProgramIssue[] = [];
  if (program.version !== 1) issues.push({ path: 'version', message: 'version must be 1' });
  if (program.classification !== 'concept_only') {
    issues.push({ path: 'classification', message: 'visual scenes must remain concept_only' });
  }
  if (program.units !== 'mm') issues.push({ path: 'units', message: 'units must be mm' });
  if (!program.name.trim()) issues.push({ path: 'name', message: 'name is required' });
  if (program.parts.length < 1 || program.parts.length > 80) {
    issues.push({ path: 'parts', message: 'scene must contain 1–80 parts' });
  }

  const ids = new Set<string>();
  program.parts.forEach((part, index) => {
    const path = `parts[${index}]`;
    if (!/^[a-z][a-z0-9_-]{1,47}$/i.test(part.id)) {
      issues.push({ path: `${path}.id`, message: 'id must be 2–48 safe characters' });
    } else if (ids.has(part.id)) {
      issues.push({ path: `${path}.id`, message: 'id must be unique' });
    }
    ids.add(part.id);
    if (!/^#[0-9a-f]{6}$/i.test(part.material.color)) {
      issues.push({ path: `${path}.material.color`, message: 'color must be #RRGGBB' });
    }
    for (const key of ['metalness', 'roughness', 'opacity'] as const) {
      const value = part.material[key];
      if (value !== undefined && (!finite(value) || value < 0 || value > 1)) {
        issues.push({ path: `${path}.material.${key}`, message: `${key} must be between 0 and 1` });
      }
    }
    if (part.position && !validVec(part.position, 3)) issues.push({ path: `${path}.position`, message: 'position must be a finite Vec3' });
    if (part.rotation && !validVec(part.rotation, 3)) issues.push({ path: `${path}.rotation`, message: 'rotation must be a finite Vec3' });

    const geometry = part.geometry;
    if (geometry.kind === 'loft') {
      if (geometry.sections.length < 2 || geometry.sections.length > 32) issues.push({ path: `${path}.geometry.sections`, message: 'loft needs 2–32 sections' });
      const pointCount = geometry.sections[0]?.profile.length;
      if (!pointCount || pointCount < 3 || pointCount > 128 || geometry.sections.some(s => s.profile.length !== pointCount || !finite(s.z) || s.profile.some(v => !validVec(v, 2)))) {
        issues.push({ path: `${path}.geometry.sections`, message: 'loft sections need matching finite profiles of 3–128 points' });
      }
    } else if (geometry.kind === 'sweep') {
      if (geometry.profile.length < 3 || geometry.profile.length > 128 || geometry.profile.some(v => !validVec(v, 2))) issues.push({ path: `${path}.geometry.profile`, message: 'sweep profile needs 3–128 finite points' });
      if (geometry.path.length < 2 || geometry.path.length > 128 || geometry.path.some(v => !validVec(v, 3))) issues.push({ path: `${path}.geometry.path`, message: 'sweep path needs 2–128 finite points' });
    } else if (geometry.kind === 'revolve') {
      if (geometry.profile.length < 2 || geometry.profile.length > 128 || geometry.profile.some(v => !validVec(v, 2))) issues.push({ path: `${path}.geometry.profile`, message: 'revolve profile needs 2–128 finite points' });
    } else if (geometry.kind === 'box') {
      if (!validVec(geometry.size, 3) || geometry.size.some(n => n <= 0)) issues.push({ path: `${path}.geometry.size`, message: 'box size must be positive' });
    } else if (!finite(geometry.radius) || !finite(geometry.length) || geometry.radius <= 0 || geometry.length <= 0) {
      issues.push({ path: `${path}.geometry`, message: 'cylinder radius and length must be positive' });
    }
  });

  program.parts.forEach((part, index) => {
    if (part.mirrorOf && (!ids.has(part.mirrorOf) || part.mirrorOf === part.id)) {
      issues.push({ path: `parts[${index}].mirrorOf`, message: 'mirrorOf must reference another part' });
    }
  });
  return issues;
}

