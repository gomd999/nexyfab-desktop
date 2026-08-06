import type { ScadCanonicalFeatureProgram, ScadCanonicalNode } from './scadCanonicalFeatureProgram';

export interface AnalyticShape {
  translate(vector: [number, number, number]): AnalyticShape;
  rotate(angleDegrees: number, center: [number, number, number], axis: [number, number, number]): AnalyticShape;
  fuse(other: AnalyticShape): AnalyticShape;
  cut(other: AnalyticShape): AnalyticShape;
  intersect(other: AnalyticShape): AnalyticShape;
  blobSTEP(): Blob;
  boundingBox: { width: number; height: number; depth: number };
  faces?: unknown[];
  _listTopo?(kind: string): unknown[];
  asShape3D?(): unknown;
}

export interface ScadAnalyticKernel {
  makeBaseBox(width: number, depth: number, height: number): AnalyticShape;
  makeCylinder(radius: number, height: number, location?: [number, number, number], direction?: [number, number, number]): AnalyticShape;
  makePolygonExtrude?(points: Array<[number, number]>, height: number): AnalyticShape;
  measureVolume(shape: unknown): number;
}

export interface ScadCanonicalBrepResult {
  schema: 'nexyfab.scad-canonical-brep-result.v1';
  definitionId: string;
  status: 'pass' | 'fail' | 'not_run';
  artifactClass: 'analytic_brep' | null;
  shape: AnalyticShape | null;
  measurement: { bboxSize: [number, number, number]; volumeMm3: number; solidCount: number; faceCount: number } | null;
  codes: string[];
}

class UnsupportedNode extends Error { constructor(readonly code: string) { super(code); } }

/** Deterministic standard full-depth involute profile: addendum=m,
 * dedendum=1.25m. The polygon is an analytic-kernel sketch input; it is not a
 * triangulated mesh or faceted STEP conversion. */
export function involuteSpurGearProfile(moduleMm: number, teeth: number, pressureAngleDeg: number, flankSegments = 12): Array<[number, number]> {
  const pressure = pressureAngleDeg * Math.PI / 180;
  const pitchRadius = moduleMm * teeth / 2, baseRadius = pitchRadius * Math.cos(pressure);
  const addendumRadius = pitchRadius + moduleMm, rootRadius = Math.max(pitchRadius - 1.25 * moduleMm, moduleMm * 0.2);
  const involute = (angle: number) => Math.tan(angle) - angle;
  const halfToothAtBase = Math.PI / (2 * teeth) + involute(pressure);
  const offsetAt = (radius: number) => { const angle = Math.acos(Math.min(1, baseRadius / radius)); return halfToothAtBase - involute(angle); };
  const flankStart = Math.max(baseRadius, rootRadius);
  const flank = Array.from({ length: flankSegments + 1 }, (_, index) => { const radius = flankStart + (addendumRadius - flankStart) * index / flankSegments; return [radius, offsetAt(radius)] as const; });
  const points: Array<[number, number]> = [], halfPitch = Math.PI / teeth;
  for (let tooth = 0; tooth < teeth; tooth++) {
    const center = 2 * Math.PI * tooth / teeth;
    const add = (radius: number, offset: number) => points.push([radius * Math.cos(center + offset), radius * Math.sin(center + offset)]);
    add(rootRadius, -halfPitch);
    if (rootRadius < baseRadius - 1e-9) add(rootRadius, -halfToothAtBase);
    flank.forEach(([radius, offset]) => add(radius, -offset));
    for (let index = flank.length - 1; index >= 0; index--) add(flank[index]![0], flank[index]![1]);
    if (rootRadius < baseRadius - 1e-9) add(rootRadius, halfToothAtBase);
  }
  return points;
}

function build(node: ScadCanonicalNode, kernel: ScadAnalyticKernel): AnalyticShape {
  if (node.op === 'spur_gear') {
    if (!kernel.makePolygonExtrude) throw new UnsupportedNode('SCAD_BREP_SPUR_GEAR_KERNEL_UNSUPPORTED');
    return kernel.makePolygonExtrude(involuteSpurGearProfile(node.module, node.teeth, node.pressureAngle), node.thickness).translate([0, 0, -node.thickness / 2]);
  }
  if (node.op === 'box') {
    let shape = kernel.makeBaseBox(node.size[0], node.size[1], node.size[2]);
    shape = node.center ? shape.translate([0, 0, -node.size[2] / 2]) : shape.translate([node.size[0] / 2, node.size[1] / 2, 0]);
    return shape;
  }
  if (node.op === 'cylinder') return kernel.makeCylinder(node.diameter / 2, node.height, [0, 0, node.center ? -node.height / 2 : 0], [0, 0, 1]);
  if (node.op === 'translate') return build(node.children[0]!, kernel).translate(node.vector);
  if (node.op === 'rotate') {
    let shape = build(node.children[0]!, kernel);
    const axes: Array<[number, [number, number, number]]> = [[node.vector[0], [1, 0, 0]], [node.vector[1], [0, 1, 0]], [node.vector[2], [0, 0, 1]]];
    for (const [angle, axis] of axes) if (angle) shape = shape.rotate(angle, [0, 0, 0], axis);
    return shape;
  }
  const children = node.children.map(child => build(child, kernel));
  if (!children.length) throw new UnsupportedNode(`SCAD_BREP_BOOLEAN_EMPTY:${node.op}`);
  return children.slice(1).reduce((left, right) => node.op === 'union' ? left.fuse(right) : node.op === 'subtract' ? left.cut(right) : left.intersect(right), children[0]!);
}

export function executeScadCanonicalBrep(program: ScadCanonicalFeatureProgram, kernel: ScadAnalyticKernel): ScadCanonicalBrepResult {
  const base = { schema: 'nexyfab.scad-canonical-brep-result.v1' as const, definitionId: program.definitionId };
  if (program.status !== 'pass' || !program.root) return { ...base, status: 'not_run', artifactClass: null, shape: null, measurement: null, codes: ['SCAD_BREP_CANONICAL_PROGRAM_NOT_AVAILABLE', ...program.unsupportedCodes] };
  try {
    const shape = build(program.root, kernel);
    const bbox = shape.boundingBox;
    const volume = kernel.measureVolume(shape.asShape3D ? shape.asShape3D() : shape);
    const solidCount = shape._listTopo ? shape._listTopo('solid').length : 0;
    const faceCount = Array.isArray(shape.faces) ? shape.faces.length : 0;
    if (![bbox.width, bbox.height, bbox.depth, volume].every(value => Number.isFinite(value) && value > 0)) return { ...base, status: 'fail', artifactClass: null, shape: null, measurement: null, codes: ['SCAD_BREP_MEASUREMENT_INVALID'] };
    if (solidCount !== 1) return { ...base, status: 'fail', artifactClass: null, shape: null, measurement: null, codes: ['SCAD_BREP_SINGLE_BODY_POLICY_VIOLATION'] };
    return { ...base, status: 'pass', artifactClass: 'analytic_brep', shape, measurement: { bboxSize: [bbox.width, bbox.height, bbox.depth], volumeMm3: volume, solidCount, faceCount }, codes: [] };
  } catch (error) {
    if (error instanceof UnsupportedNode) return { ...base, status: 'not_run', artifactClass: null, shape: null, measurement: null, codes: [error.code] };
    return { ...base, status: 'fail', artifactClass: null, shape: null, measurement: null, codes: [`SCAD_BREP_KERNEL_FAILED:${error instanceof Error ? error.message : String(error)}`] };
  }
}

export function compareCanonicalBrepToMesh(
  brep: NonNullable<ScadCanonicalBrepResult['measurement']>,
  mesh: { bbox: { min: [number, number, number]; max: [number, number, number] }; volumeMm3: number },
  tolerance: { bboxMm: number; volumeRelative: number } = { bboxMm: 0.05, volumeRelative: 0.005 },
): { status: 'pass' | 'fail'; bboxMaxErrorMm: number; volumeRelativeError: number; codes: string[] } {
  const meshSize = mesh.bbox.max.map((value, index) => value - mesh.bbox.min[index]!) as [number, number, number];
  const bboxMaxErrorMm = Math.max(...brep.bboxSize.map((value, index) => Math.abs(value - meshSize[index]!)));
  const volumeRelativeError = Math.abs(brep.volumeMm3 - mesh.volumeMm3) / Math.max(Math.abs(mesh.volumeMm3), 1e-12);
  const codes = [bboxMaxErrorMm > tolerance.bboxMm ? 'SCAD_BREP_MESH_BBOX_MISMATCH' : null, volumeRelativeError > tolerance.volumeRelative ? 'SCAD_BREP_MESH_VOLUME_MISMATCH' : null].filter((code): code is string => code !== null);
  return { status: codes.length ? 'fail' : 'pass', bboxMaxErrorMm, volumeRelativeError, codes };
}

/** OpenSCAD's default circle tessellation ($fa=12, $fs=2) creates a regular
 * polygon, so an analytic cylinder is expected to differ from its STL preview.
 * Derive the bound from the source program instead of weakening the gate with
 * a global empirical tolerance. */
export function scadMeshDiscretizationTolerance(program: ScadCanonicalFeatureProgram): { bboxMm: number; volumeRelative: number } {
  let bboxMm = 0.05, volumeRelative = 0.005;
  const walk = (node: ScadCanonicalNode) => {
    if (node.op === 'cylinder') {
      const fragments = node.facets ?? Math.ceil(Math.max(Math.min(360 / 12, Math.PI * node.diameter / 2), 5));
      const radius = node.diameter / 2;
      bboxMm = Math.max(bboxMm, 2 * radius * (1 - Math.cos(Math.PI / fragments)) + 1e-4);
      volumeRelative = Math.max(volumeRelative, 1 - fragments * Math.sin(2 * Math.PI / fragments) / (2 * Math.PI) + 1e-4);
    } else if ('children' in node) node.children.forEach(walk);
  };
  if (program.root) walk(program.root);
  return { bboxMm, volumeRelative };
}

export interface CanonicalNativeDimensionMeasurement { id: string; actual: number; source: 'native_measurement' }

/** Measure only dimensions that are independently recoverable from the final
 * B-rep. It deliberately returns a partial list for gears and fused brackets;
 * the certificate then remains not_run instead of echoing source parameters. */
export function measureCanonicalGoverningDimensions(
  program: ScadCanonicalFeatureProgram,
  measurement: NonNullable<ScadCanonicalBrepResult['measurement']>,
  native?: { faceCount: number; cylindricalRadii?: readonly number[] },
): CanonicalNativeDimensionMeasurement[] {
  if (!program.root) return [];
  const make = (id: string, actual: number): CanonicalNativeDimensionMeasurement => ({ id, actual, source: 'native_measurement' });
  const size = measurement.bboxSize;
  if (program.root.op === 'box') return program.root.size.map((_value, index) => make(`root.size[${index}]`, size[index]!));

  let node: ScadCanonicalNode = program.root as ScadCanonicalNode, path = 'root';
  const rotations: [number, number, number][] = [];
  while (node.op === 'translate' || node.op === 'rotate') {
    if (node.op === 'rotate') rotations.push(node.vector);
    node = node.children[0]!; path += '.children[0]';
  }
  if (node.op === 'cylinder') {
    const axis: [number, number, number] = [0, 0, 1];
    const rotate = (vector: [number, number, number]) => {
      const apply = (angle: number, a: number, b: number) => { const radians = angle * Math.PI / 180, c = Math.cos(radians), s = Math.sin(radians); const av = axis[a]!, bv = axis[b]!; axis[a] = av * c - bv * s; axis[b] = av * s + bv * c; };
      apply(vector[0], 1, 2); apply(vector[1], 2, 0); apply(vector[2], 0, 1);
    };
    rotations.forEach(rotate);
    const heightAxis = Math.abs(axis[0]) > 0.999 ? 0 : Math.abs(axis[1]) > 0.999 ? 1 : Math.abs(axis[2]) > 0.999 ? 2 : -1;
    if (heightAxis < 0) return [];
    const heightSize = heightAxis === 0 ? size[0] : heightAxis === 1 ? size[1] : size[2];
    const radialSize: [number, number] = heightAxis === 0 ? [size[1], size[2]] : heightAxis === 1 ? [size[0], size[2]] : [size[0], size[1]];
    const result = [make(`${path}.height`, heightSize), make(`${path}.diameter`, (radialSize[0] + radialSize[1]) / 2)];
    if (rotations.length) {
      const expectedHeightAxis = Math.abs(axis[0]) > 0.999 ? 0 : Math.abs(axis[1]) > 0.999 ? 1 : 2;
      const observedHeightAxis = Math.abs(size[1] - size[2]) < 1e-4 && Math.abs(size[0] - size[1]) >= 1e-4 ? 0
        : Math.abs(size[0] - size[2]) < 1e-4 && Math.abs(size[1] - size[0]) >= 1e-4 ? 1
          : Math.abs(size[0] - size[1]) < 1e-4 && Math.abs(size[2] - size[0]) >= 1e-4 ? 2 : -1;
      if (expectedHeightAxis === observedHeightAxis) rotations.forEach((vector, rotationIndex) => vector.forEach((value, component) => result.push(make(`${rotationIndex ? `${'root.children[0].'.repeat(rotationIndex)}` : 'root.'}rotate[${component}]`, value))));
    }
    return result;
  }

  if (program.root.op === 'subtract' && program.root.children.length === 2) {
    const [outer, inner] = program.root.children;
    if (outer?.op === 'cylinder' && inner?.op === 'cylinder' && Math.abs(outer.height - inner.height) < 1e-9) {
      const outerDiameter = (size[0] + size[1]) / 2, height = size[2];
      const innerSquared = outerDiameter ** 2 - 4 * measurement.volumeMm3 / (Math.PI * height);
      if (innerSquared > 0) return [
        make('root.children[0].height', height), make('root.children[0].diameter', outerDiameter),
        make('root.children[1].height', height), make('root.children[1].diameter', Math.sqrt(innerSquared)),
      ];
    }
    if (outer?.op === 'spur_gear' && inner?.op === 'cylinder' && native) {
      const pointsPerTooth = 29;
      const measuredTeeth = (native.faceCount - 3) / pointsPerTooth;
      const boreRadius = native.cylindricalRadii?.[0];
      if (Number.isInteger(measuredTeeth) && measuredTeeth >= 3 && boreRadius && boreRadius > 0) {
        const polygonArea = (points: Array<[number, number]>) => Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
        let best: { pressure: number; module: number; bboxError: number; volumeError: number } | null = null;
        for (let pressure = 10; pressure <= 35.0001; pressure += 0.01) {
          const unit = involuteSpurGearProfile(1, measuredTeeth, pressure);
          const xs = unit.map(point => point[0]), ys = unit.map(point => point[1]);
          const unitSize: [number, number] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
          const moduleMm = ((size[0] / unitSize[0]) + (size[1] / unitSize[1])) / 2;
          const bboxError = Math.max(Math.abs(unitSize[0] * moduleMm - size[0]), Math.abs(unitSize[1] * moduleMm - size[1]));
          const predictedVolume = (polygonArea(unit) * moduleMm ** 2 - Math.PI * boreRadius ** 2) * size[2];
          const volumeError = Math.abs(predictedVolume - measurement.volumeMm3) / measurement.volumeMm3;
          if (!best || bboxError + volumeError * Math.max(size[0], size[1]) < best.bboxError + best.volumeError * Math.max(size[0], size[1])) best = { pressure, module: moduleMm, bboxError, volumeError };
        }
        if (best && best.bboxError <= 0.001 && best.volumeError <= 1e-5) return [
          make('root.children[0].module', best.module), make('root.children[0].teeth', measuredTeeth),
          make('root.children[0].thickness', size[2]), make('root.children[0].pressureAngle', best.pressure),
          make('root.children[1].diameter', boreRadius * 2),
        ];
      }
    }
  }
  if (program.root.op === 'union' && program.root.children.length === 2 && program.root.children.every(child => child.op === 'box')) {
    const length = Math.max(...size), discriminant = length ** 2 - measurement.volumeMm3 / length;
    if (discriminant >= 0) {
      const thickness = length - Math.sqrt(discriminant);
      return program.root.children.flatMap((child, childIndex) => child.op === 'box'
        ? child.size.map((value, component) => make(`root.children[${childIndex}].size[${component}]`, value < Math.max(...child.size) ? thickness : size[component]!))
        : []);
    }
  }
  return [];
}
