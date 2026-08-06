import { describe, expect, it } from 'vitest';
import { buildCadProductBundleManifest, cadProductLineageId, classifyCadProductBundleRole } from './cadCorpusProductBundle';

const bytes = (value: string) => new TextEncoder().encode(value);
describe('CAD corpus product bundle manifest', () => {
  it('binds same-snapshot sources by role, size, and content hash', () => {
    const manifest = buildCadProductBundleManifest([
      { relativePath: 'set/mearm.snapshot.10/Final Assembly.x_t', bytes: bytes('xt') },
      { relativePath: 'set/mearm.snapshot.10/SolidWorks/Final Assembly.SLDASM', bytes: bytes('asm') },
      { relativePath: 'set/mearm.snapshot.10/Images/Base Joint Rotation.gif', bytes: bytes('gif') },
    ]);
    expect(manifest).toMatchObject({ schema: 'nexyfab.cad-product-bundle.v1', lineageId: 'set/mearm.snapshot.10', roles: { authoritative_geometry: 1, native_assembly: 1, motion_reference: 1 }, warnings: [] });
    expect(manifest.members.every(member => /^[a-f0-9]{64}$/.test(member.sha256))).toBe(true);
  });
  it('forbids combining similarly named products from different snapshots', () => {
    expect(() => buildCadProductBundleManifest([
      { relativePath: 'set/mearm.snapshot.10/Final.x_t', bytes: bytes('xt') },
      { relativePath: 'set/robotic-arm.snapshot.3/Robot.step', bytes: bytes('step') },
    ])).toThrow('cross_lineage_product_bundle_forbidden');
  });
  it('normalizes lineage and classifies governed roles', () => {
    expect(cadProductLineageId('A\\MeArm.snapshot.10\\parts\\x.SLDPRT')).toBe('a/mearm.snapshot.10');
    expect(classifyCadProductBundleRole('x/assembly.SLDASM')).toBe('native_assembly');
    expect(classifyCadProductBundleRole('x/manual.pdf')).toBe('documentation');
  });
});
