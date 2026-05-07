import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { exportToStep } from '@/app/[lang]/shape-generator/io/stepExporter';
import { formatCadImportError } from '@/app/[lang]/shape-generator/io/formatCadImportError';
import { importPayload } from '@/app/[lang]/shape-generator/io/importers';

describe('M1 exchange', () => {
  it('exportToStep(BoxGeometry) emits AP214 MANIFOLD_SOLID_BREP (occt-import round-trip path)', () => {
    const g = new THREE.BoxGeometry(10, 20, 30);
    const text = exportToStep(g, 'TestPart');
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(text).toContain('AUTOMOTIVE_DESIGN');
    expect(text).toContain('MANIFOLD_SOLID_BREP');
    expect(text).toContain('PRODUCT(\'TestPart\',\'TestPart\'');
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(text).not.toContain('TRIANGULATED_FACE');
  });

  it('exportToStep(non-box) emits AP242 tessellation and millimetre units', () => {
    const g = new THREE.SphereGeometry(5, 16, 12);
    const text = exportToStep(g, 'TestSphere');
    expect(text).toMatch(/^ISO-10303-21;/);
    expect(text).toContain('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING');
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
    expect(text).toContain('TRIANGULATED_FACE');
    expect(text).toContain('COORDINATES_LIST');
    expect(text).toContain('TESSELLATED_SHELL');
    expect(text).not.toContain('(.OPEN.)');
  });

  it('importPayload rejects unknown extension', async () => {
    await expect(importPayload('model.xyz', new ArrayBuffer(0))).rejects.toThrow(/Unsupported format/);
  });

  it('formatCadImportError maps STEP and OCCT messages', () => {
    expect(formatCadImportError(new Error('STEP parsing failed: bad'), { filename: 'a.step' })).toContain('a.step');
    expect(formatCadImportError(new Error('No geometry found in STEP file'))).toMatch(/No tessellated geometry/i);
    expect(formatCadImportError(new Error('OCCT import failed: no meshes produced'))).toMatch(/IGES\/BREP/i);
    expect(formatCadImportError(new Error('STEP produced no renderable meshes'))).toMatch(/triangle mesh/i);
    expect(formatCadImportError(new Error('Failed to load OCCT WASM'))).toMatch(/WASM/i);
    expect(formatCadImportError(new Error('DXF file contains no supported entities'))).toMatch(/DXF/i);
  });
});
