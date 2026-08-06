import { describe, expect, it } from 'vitest';
import { bridgeScadAssembly } from './scadAssemblyBridge';
import { convertScadDefinitionToCanonical } from './scadCanonicalFeatureProgram';
import { buildScadInterfaceEvidence } from './scadInterfaceEvidence';

const evaluate = (scenarioId: string, modules: Record<string, string>, composition: string) => {
  const bridge = bridgeScadAssembly({ modules, composition });
  const programs = Object.entries(modules).map(([name, moduleSource]) => convertScadDefinitionToCanonical({ definitionId: `scad:def:${name}`, moduleSource, sourceRef: 'test' }));
  return buildScadInterfaceEvidence({ scenarioId, architecture: bridge.architecture!, transforms: bridge.transforms, programs });
};

describe('buildScadInterfaceEvidence', () => {
  it('measures gear pitch-center mesh but does not invent missing shaft supports', () => {
    const result = evaluate('sc7_gear_train', {
      gear20: 'module gear20(){spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20);}',
      gear30: 'module gear30(){spur_gear(mod=2,teeth=30,thickness=8,pressure_angle=20);}',
    }, 'gear20();\ntranslate([50,0,0]) gear30();');
    expect(result.checks.find(item => item.id === 'gear-mesh')?.status).toBe('pass');
    expect(result.status).toBe('not_run');
    expect(result.codes).toContain('GEAR_SUPPORT_JOINTS_NOT_MODELED');
  });

  it('passes measured gear contact with independently modeled base and shaft supports', () => {
    const result = evaluate('sc7_gear_train', {
      gear20: 'module gear20(){spur_gear(mod=2,teeth=20,thickness=8,pressure_angle=20);}', gear30: 'module gear30(){spur_gear(mod=2,teeth=30,thickness=8,pressure_angle=20);}',
      gear_base: 'module gear_base(){cube([90,50,4],center=true);}', shaft20: 'module shaft20(){cylinder(d=7.8,h=16,center=true);}', shaft30: 'module shaft30(){cylinder(d=7.8,h=16,center=true);}',
    }, 'gear20();\ntranslate([50,0,0]) gear30();\ntranslate([25,0,-10]) gear_base();\nshaft20();\ntranslate([50,0,0]) shaft30();');
    expect(result.status).toBe('pass');
    expect(result.joints).toHaveLength(5);
  });

  it('creates fixed T-junction seams and leaves native flow openness unclaimed', () => {
    const pipe = 'difference(){cylinder(h=60,d=30);cylinder(h=60,d=20);}';
    const result = evaluate('sc8_pipe_joint', { main_pipe_left: `module main_pipe_left(){${pipe}}`, main_pipe_right: `module main_pipe_right(){${pipe}}`, branch_pipe: `module branch_pipe(){${pipe}}` }, 'translate([-60,0,0]) rotate([0,90,0]) main_pipe_left();\nrotate([0,90,0]) main_pipe_right();\nbranch_pipe();');
    expect(result.architecture.interfaces).toHaveLength(2);
    expect(result.status).toBe('not_run');
    expect(result.codes).toContain('PIPE_FLOW_OPENNESS_NATIVE_BOOLEAN_REQUIRED');
  });

  it('fails a wheel cylinder whose generated axis is X rather than required Y', () => {
    const result = evaluate('sc9_simple_car', {
      body: 'module body(){cube([60,30,20],center=true);}',
      wheel: 'module wheel(){rotate([0,90,0]) cylinder(h=6,d=14,center=true);}',
      window: 'module window(){cube([20,10,5],center=true);}',
    }, 'body();\ntranslate([-20,-18,7]) wheel();\ntranslate([-20,18,7]) wheel();\ntranslate([20,-18,7]) wheel();\ntranslate([20,18,7]) wheel();\ntranslate([0,0,12]) window();\ntranslate([0,0,12]) window();');
    expect(result.status).toBe('fail');
    expect(result.codes).toEqual(expect.arrayContaining(['CAR_WHEEL_AXIS_MISMATCH', 'CAR_DUPLICATE_WINDOW_OCCURRENCE']));
    expect(result.joints).toHaveLength(4);
  });

  it('accepts an explicitly joint-free static bracket array', () => {
    const result = evaluate('sc10_brackets_grid', { bracket: 'module bracket(){cube([40,40,5]);}' }, 'bracket();\ntranslate([50,0,0]) bracket();');
    expect(result.status).toBe('pass');
    expect(result.architecture.interfaceExpectation).toBe('none');
  });
});
