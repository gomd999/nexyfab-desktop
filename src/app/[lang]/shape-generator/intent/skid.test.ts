// Pilot #2 tests — desalination skid GA concept (complex multi-body assembly).

import { describe, expect, it } from 'vitest';

import { emitAssembly } from './emitOpenScad';
import { SKID, buildDesalSkid } from './pilotSkidDesal';

describe('pilot: desalination skid concept', () => {
  const build = buildDesalSkid();

  it('passes all layout gates (envelope, machine disjointness, door, fit)', () => {
    // buildDesalSkid throws on any gate failure — reaching here means G1–G4 pass.
    expect(build.derived.envelope).toEqual({ L: 1400, W: 750, H: 1600 });
    expect(build.derived.stubCount).toBeGreaterThan(100);   // v2 compound stubs + piping
    expect(build.derived.machineCount).toBe(17);            // 4 casters + 13 schedule machines (4 housings separate)
    expect(build.derived.pipeStubCount).toBeGreaterThan(35); // routes + joints + valves + gauges
    expect(SKID.membrane.len + 2 * SKID.membrane.capLen).toBeLessThanOrEqual(build.derived.railClearSpanMm);
  });

  it('emits a deterministic multi-component SCAD with rotated placements', () => {
    const scad = emitAssembly(build.assembly, { headerComments: ['GA concept Rev.A'] });
    expect(scad).toContain('module comp_frame()');
    expect(scad).toContain('module comp_equipment()');
    expect(scad).toContain('module comp_piping()');
    expect(scad).toContain('rotate([0, 90, 0])');  // horizontal rails/vessels
    expect(scad).toContain('rotate([-90, 0, 0])'); // cross rails
    expect(scad).toContain('d=135');               // 4040 membrane housings
    const opens = (scad.match(/\{/g) ?? []).length;
    expect(opens).toBe((scad.match(/\}/g) ?? []).length);
    expect(scad).not.toMatch(/NaN|undefined|Infinity/);
    expect(emitAssembly(build.assembly, { headerComments: ['GA concept Rev.A'] })).toBe(scad);
  });

  it('layout keeps clear air between the ERD and the lowest RO housing', () => {
    const erdTop = 350 + 95;              // ERD z max incl. flanges (Ø190)
    const housing1Bottom = SKID.membrane.zLevels[0] - SKID.membrane.capDia / 2;
    expect(housing1Bottom).toBeGreaterThan(erdTop);
  });

  it('emits compound-stub and piping geometry (visual upgrade markers)', () => {
    const scad = emitAssembly(build.assembly, { headerComments: [] });
    expect(scad).toContain('sphere(d=');            // dished heads + pipe joints
    expect(scad).toContain('d=32');                 // membrane manifolds
    expect((scad.match(/sphere\(/g) ?? []).length).toBeGreaterThan(10);
  });
});
