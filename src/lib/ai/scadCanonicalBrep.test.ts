import { describe, expect, it } from 'vitest';
import { convertScadDefinitionToCanonical } from './scadCanonicalFeatureProgram';
import { compareCanonicalBrepToMesh, executeScadCanonicalBrep, involuteSpurGearProfile, measureCanonicalGoverningDimensions, scadMeshDiscretizationTolerance, type AnalyticShape, type ScadAnalyticKernel } from './scadCanonicalBrep';

class Shape implements AnalyticShape {
  faces = [{}, {}, {}, {}, {}, {}];
  constructor(public boundingBox = { width: 10, height: 20, depth: 30 }, public volume = 6000, public solids = 1) {}
  translate() { return this; } rotate() { return this; } fuse() { return this; } cut() { return this; } intersect() { return this; }
  blobSTEP() { return new Blob(['ISO-10303-21;']); } _listTopo() { return Array.from({ length: this.solids }); } asShape3D() { return this; }
}
const kernel: ScadAnalyticKernel = { makeBaseBox: (w, d, h) => new Shape({ width: w, height: d, depth: h }, w * d * h), makeCylinder: (r, h) => new Shape({ width: 2 * r, height: 2 * r, depth: h }, Math.PI * r * r * h), measureVolume: shape => (shape as Shape).volume };
const convert = (source: string) => convertScadDefinitionToCanonical({ definitionId: 'scad:def:test', moduleSource: source, sourceRef: 'fixture:test' });

describe('SCAD canonical analytic B-rep', () => {
  it('builds an analytic primitive and measures its body', () => expect(executeScadCanonicalBrep(convert('module x(){ cube([10,20,30]); }'), kernel)).toMatchObject({ status: 'pass', artifactClass: 'analytic_brep', measurement: { bboxSize: [10, 20, 30], volumeMm3: 6000, solidCount: 1 } }));
  it('keeps gear construction as not_run when the kernel lacks polygon extrusion', () => expect(executeScadCanonicalBrep(convert('module x(){ spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20); }'), kernel)).toMatchObject({ status: 'not_run', artifactClass: null, codes: ['SCAD_BREP_SPUR_GEAR_KERNEL_UNSUPPORTED'] }));
  it('builds a deterministic involute gear when polygon extrusion is available', () => {
    const gearKernel = { ...kernel, makePolygonExtrude: (points: Array<[number, number]>, height: number) => new Shape({ width: 44, height: 44, depth: height }, 9000 + points.length) };
    expect(involuteSpurGearProfile(2, 20, 20)).toHaveLength(20 * 29);
    expect(executeScadCanonicalBrep(convert('module x(){ spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20); }'), gearKernel)).toMatchObject({ status: 'pass', artifactClass: 'analytic_brep' });
  });
  it('fails a mesh cross-check outside bbox or volume tolerance', () => expect(compareCanonicalBrepToMesh({ bboxSize: [10, 20, 30], volumeMm3: 6000, solidCount: 1, faceCount: 6 }, { bbox: { min: [0, 0, 0], max: [10, 20, 31] }, volumeMm3: 5000 })).toMatchObject({ status: 'fail', codes: ['SCAD_BREP_MESH_BBOX_MISMATCH', 'SCAD_BREP_MESH_VOLUME_MISMATCH'] }));
  it('derives the preview tolerance from OpenSCAD circle fragmentation', () => {
    const value = scadMeshDiscretizationTolerance(convert('module x(){ cylinder(d=30,h=50); }'));
    expect(value.bboxMm).toBeCloseTo(0.16444, 4);
    expect(value.volumeRelative).toBeCloseTo(0.007394, 4);
  });
  it('measures only independently recoverable primitive dimensions', () => {
    const box = convert('module x(){ cube([10,20,30]); }');
    expect(measureCanonicalGoverningDimensions(box, { bboxSize: [10, 20, 30], volumeMm3: 6000, solidCount: 1, faceCount: 6 })).toHaveLength(3);
    const pipe = convert('module x(){ difference(){ cylinder(d=30,h=50); cylinder(d=20,h=50); } }');
    const measured = measureCanonicalGoverningDimensions(pipe, { bboxSize: [30, 30, 50], volumeMm3: Math.PI * (15 ** 2 - 10 ** 2) * 50, solidCount: 1, faceCount: 4 });
    expect(measured).toEqual(expect.arrayContaining([{ id: 'root.children[1].diameter', actual: 20, source: 'native_measurement' }]));
    const wheel = convert('module x(){ rotate([0,90,0]) cylinder(d=14,h=6,center=true); }');
    expect(measureCanonicalGoverningDimensions(wheel, { bboxSize: [6, 14, 14], volumeMm3: Math.PI * 7 ** 2 * 6, solidCount: 1, faceCount: 3 })).toEqual(expect.arrayContaining([{ id: 'root.rotate[1]', actual: 90, source: 'native_measurement' }]));
    const bracket = convert('module x(){ union(){ cube([5,40,40]); cube([40,5,40]); } }');
    expect(measureCanonicalGoverningDimensions(bracket, { bboxSize: [40, 40, 40], volumeMm3: 15000, solidCount: 1, faceCount: 8 })).toEqual(expect.arrayContaining([{ id: 'root.children[0].size[0]', actual: 5, source: 'native_measurement' }]));
    expect(measureCanonicalGoverningDimensions(convert('module x(){ spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20); }'), { bboxSize: [44, 44, 8], volumeMm3: 9000, solidCount: 1, faceCount: 100 })).toEqual([]);
  });
  it('inverts native gear periodicity, bore, bbox and volume without echoing source dimensions', () => {
    const program = convert('module x(){ difference(){ spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20); cylinder(d=8,h=20,center=true); } }');
    const points = involuteSpurGearProfile(2, 20, 20);
    const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
    const area = Math.abs(points.reduce((sum, point, index) => { const next = points[(index + 1) % points.length]!; return sum + point[0] * next[1] - next[0] * point[1]; }, 0)) / 2;
    const result = measureCanonicalGoverningDimensions(program, { bboxSize: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 8], volumeMm3: (area - Math.PI * 4 ** 2) * 8, solidCount: 1, faceCount: 583 }, { faceCount: 583, cylindricalRadii: [4] });
    expect(result).toEqual(expect.arrayContaining([{ id: 'root.children[0].teeth', actual: 20, source: 'native_measurement' }, { id: 'root.children[1].diameter', actual: 8, source: 'native_measurement' }]));
    expect(result.find(item => item.id.endsWith('pressureAngle'))?.actual).toBeCloseTo(20, 2);
  });
});
