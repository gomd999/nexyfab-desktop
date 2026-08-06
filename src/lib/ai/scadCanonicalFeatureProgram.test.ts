import { describe, expect, it } from 'vitest';
import { convertScadDefinitionToCanonical } from './scadCanonicalFeatureProgram';

const convert = (moduleSource: string) => convertScadDefinitionToCanonical({ definitionId: 'scad:def:test', moduleSource, sourceRef: 'fixture:test' });

describe('SCAD canonical feature program', () => {
  it('converts numeric primitives, transforms, booleans and gears with provenance', () => {
    const result = convert('module gear(){ difference(){ spur_gear(mod=2, teeth=20, thickness=8, pressure_angle=20, $fn=64); cylinder(d=8,h=20,center=true); } }');
    expect(result).toMatchObject({ status: 'pass', bodyPolicy: 'single_body', material: null, process: null, manufacturingReady: false });
    expect(result.root).toMatchObject({ op: 'subtract', children: [{ op: 'spur_gear', module: 2, teeth: 20 }, { op: 'cylinder', diameter: 8, height: 20 }] });
    expect(result.governingDimensions).toEqual(expect.arrayContaining([{ path: 'root.children[0].teeth', value: 20, unit: 'count', provenance: 'generated_scad' }]));
  });
  it('preserves a translated union as an ordered feature tree', () => {
    const result = convert('module bracket(){ difference(){ union(){ translate([0,0,0]) cube([5,40,40]); translate([0,0,0]) cube([40,5,40]); } } }');
    expect(result.status).toBe('pass');
    expect(result.root).toMatchObject({ op: 'union', children: [{ op: 'box' }, { op: 'box' }] });
  });
  it('fails closed for expressions and unsupported operations', () => {
    expect(convert('module x(){ cylinder(d=2*r,h=10); }')).toMatchObject({ status: 'not_run', root: null });
    expect(convert('module x(){ sphere(r=10); }').unsupportedCodes).toContain('SCAD_FEATURE_OPERATION_UNSUPPORTED:sphere');
  });
});
