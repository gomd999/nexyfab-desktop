import { describe, expect, it } from 'vitest';
import { validateComplexProductArchitecture } from './complexProductArchitecture';
import { bridgeEffectiveScadSource, bridgeScadAssembly } from './scadAssemblyBridge';

describe('bridgeScadAssembly', () => {
  it('preserves reusable definitions, occurrences, quantity indices, and transforms', () => {
    const result = bridgeScadAssembly({
      modules: { body: 'module body(){cube(10);}', wheel: 'module wheel(){cylinder(d=4,h=2);}' },
      composition: ['body();', 'translate([-20, -18, 7]) rotate([90, 0, 0]) wheel();', 'translate([20, -18, 7]) wheel();', 'translate([-20, 18, 7]) wheel();', 'translate([20, 18, 7]) wheel();'].join('\n'),
    }, 'Toy car');
    expect(result.status).toBe('pass');
    expect(result.architecture?.definitions).toHaveLength(3);
    expect(result.architecture?.occurrences).toHaveLength(6);
    expect(result.architecture?.occurrences.filter(item => item.definitionId === 'scad:def:wheel').map(item => item.quantityIndex)).toEqual([1, 2, 3, 4]);
    expect(result.transforms).toHaveLength(6);
    expect(result.architecture?.interfaceExpectation).toBe('unknown');
    expect(result.transforms[1]?.matrix).toHaveLength(16);
    expect(validateComplexProductArchitecture(result.architecture!)).toMatchObject({ status: 'pass' });
  });

  it('fails closed without a real multi-module composition', () => {
    expect(bridgeScadAssembly({ modules: { a: 'module a(){}', b: 'module b(){}' }, composition: null }).codes)
      .toContain('SCAD_ASSEMBLY_COMPOSITION_MISSING');
    expect(bridgeScadAssembly({ modules: { a: 'module a(){}' }, composition: 'a();' }).codes)
      .toContain('SCAD_ASSEMBLY_MULTIPLE_OCCURRENCES_REQUIRED');
  });

  it('rejects unknown definitions and unparsed procedural placements', () => {
    const unknown = bridgeScadAssembly({ modules: { a: 'module a(){}', b: 'module b(){}' }, composition: 'a();\nmissing();' });
    expect(unknown.codes).toContain('SCAD_ASSEMBLY_DEFINITION_MISSING:missing');
    const loop = bridgeScadAssembly({ modules: { a: 'module a(){}', b: 'module b(){}' }, composition: 'for(i=[0:3]) translate([i,0,0]) a();' });
    expect(loop.codes.some(code => code.startsWith('SCAD_ASSEMBLY_PLACEMENT_UNPARSED:'))).toBe(true);
  });

  it('bridges the persisted effective SCAD source format', () => {
    const result = bridgeEffectiveScadSource([
      '// ── module: body ──',
      'module body(){cube(10);}',
      '',
      '// ── module: wheel ──',
      'module wheel(){cylinder(d=4,h=2);}',
      '',
      '// ── composition ──',
      'body();',
      'translate([10, 0, 0]) wheel();',
    ].join('\n'));
    expect(result.status).toBe('pass');
    expect(result.architecture?.definitions.map(item => item.name)).toEqual(['SCAD Assembly', 'body', 'wheel']);
  });
});
