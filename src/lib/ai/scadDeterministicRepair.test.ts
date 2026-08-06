import { describe, expect, it } from 'vitest';
import { repairScadScenario } from './scadDeterministicRepair';

describe('repairScadScenario', () => {
  it('repairs only the wheel definition and duplicate window occurrence', () => {
    const source = '// module: wheel\nmodule wheel(){rotate([0,90,0]) cylinder(d=14,h=6);}\n// composition\nbody();\ntranslate([0,0,6]) window();\ntranslate([0,0,6]) window();';
    const result = repairScadScenario('sc9_simple_car', source, ['CAR_WHEEL_AXIS_MISMATCH', 'CAR_DUPLICATE_WINDOW_OCCURRENCE']);
    expect(result.status).toBe('repaired');
    expect(result.source).toContain('rotate([90,0,0]) cylinder');
    expect(result.source.match(/window\(\);/g)).toHaveLength(1);
    expect(result.mutations.map(item => item.boundary)).toEqual(['definition:wheel', 'occurrence:window']);
  });

  it('adds independently named base and shaft definitions to the gear assembly', () => {
    const source = '// module: gear20\nmodule gear20(){cylinder(d=20,h=8);}\n// module: gear30\nmodule gear30(){cylinder(d=30,h=8);}\n// composition\ngear20();\ntranslate([50,0,0]) gear30();';
    const result = repairScadScenario('sc7_gear_train', source, ['GEAR_SUPPORT_JOINTS_NOT_MODELED']);
    expect(result.status).toBe('repaired');
    expect(result.source).toContain('module gear_base()');
    expect(result.source).toContain('module shaft20()');
    expect(result.source).toContain('translate([50,0,0]) shaft30();');
  });

  it('fails closed when the expected mutation target is ambiguous', () => {
    const result = repairScadScenario('sc9_simple_car', 'module wheel(){cylinder(d=14,h=6);}', ['CAR_WHEEL_AXIS_MISMATCH']);
    expect(result.status).toBe('not_run');
    expect(result.unresolvedCodes[0]).toContain('EXPECTED_ONE_MATCH');
  });

  it('opens a fitting-sized center section without changing the 100mm envelope', () => {
    const source = 'module main_pipe_left(){difference(){cylinder(h=50,d=30);cylinder(h=50,d=20);}}\nmodule main_pipe_right(){difference(){cylinder(h=50,d=30);cylinder(h=50,d=20);}}\ntranslate([-50, 0, 0]) rotate([0, 90, 0]) main_pipe_left();\nrotate([0, 90, 0]) main_pipe_right();';
    const result = repairScadScenario('sc8_pipe_joint', source, ['PIPE_FLOW_PATH_BLOCKED']);
    expect(result.status).toBe('repaired');
    expect(result.source.match(/h=45/g)).toHaveLength(4);
    expect(result.source).toContain('translate([5, 0, 0]) rotate([0, 90, 0]) main_pipe_right();');
  });
});
