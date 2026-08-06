import { describe, expect, it } from 'vitest';
import { bridgeScadAssembly } from './scadAssemblyBridge';
import { buildScadDefinitionGeometryEvidence } from './scadDefinitionGeometryEvidence';
import { buildPartGenerationCertificate } from './partGenerationCertificate';
import { buildProductAssemblyCertificate } from './productAssemblyCertificate';

const tetra = new TextEncoder().encode(`solid tetra
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endloop endfacet
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 0 0 1 vertex 1 0 0 endloop endfacet
facet normal 0 0 0 outer loop vertex 0 0 0 vertex 0 1 0 vertex 0 0 1 endloop endfacet
facet normal 0 0 0 outer loop vertex 1 0 0 vertex 0 0 1 vertex 0 1 0 endloop endfacet
endsolid tetra`);

describe('SCAD definition geometry evidence', () => {
  it('renders each definition once and reuses its hash across occurrences', async () => {
    const modules = { body: 'module body(){cube(10);}', wheel: 'module wheel(){cylinder(d=4,h=2);}' };
    const bridge = bridgeScadAssembly({ modules, composition: 'body();\ntranslate([-10,0,0]) wheel();\ntranslate([10,0,0]) wheel();' });
    const calls: string[] = [];
    const result = await buildScadDefinitionGeometryEvidence({ modules, bridge, render: async (_source, name) => { calls.push(name); return { ok: true, bytes: tetra }; } });
    expect(result.status).toBe('pass');
    expect(calls).toEqual(['body', 'wheel']);
    expect(result.occurrences).toHaveLength(3);
    const wheelHashes = result.occurrences.filter(item => item.definitionId === 'scad:def:wheel').map(item => item.definitionSha256);
    expect(new Set(wheelHashes).size).toBe(1);
    expect(result.releaseReady).toBe(false);
  });

  it('fails closed when a definition cannot render', async () => {
    const modules = { a: 'module a(){}', b: 'module b(){}' };
    const bridge = bridgeScadAssembly({ modules, composition: 'a();\nb();' });
    const result = await buildScadDefinitionGeometryEvidence({ modules, bridge, render: async (_source, name) => name === 'a' ? { ok: true, bytes: tetra } : { ok: false, error: 'compile failed' } });
    expect(result.status).toBe('fail');
    expect(result.codes).toContain('SCAD_DEFINITION_RENDER_FAILED:scad:def:b');
  });

  it('keeps a watertight multi-part SCAD mesh out of manufacturing release', async () => {
    const modules = { body: 'module body(){cube(10);}', wheel: 'module wheel(){cylinder(d=4,h=2);}' };
    const bridge = bridgeScadAssembly({ modules, composition: 'body();\ntranslate([-10,0,0]) wheel();\ntranslate([10,0,0]) wheel();' });
    const geometry = await buildScadDefinitionGeometryEvidence({ modules, bridge, render: async () => ({ ok: true, bytes: tetra }) });
    const parts = geometry.definitions.map(definition => buildPartGenerationCertificate(
      { partId: definition.definitionId, intent: 'general', bodyPolicy: 'single_body', expectedBodies: 1, dimensions: [], features: [] },
      { kernel: { available: true, valid: true, source: 'native_mesh', artifactClass: 'mesh_manufacturing', artifactHash: definition.sha256! }, topology: { solidCount: 1, watertight: definition.watertight!, nonManifoldEdges: 0, degenerateFaces: 0 } },
    ));
    const certificate = buildProductAssemblyCertificate(bridge.architecture!, { partCertificates: parts, transforms: bridge.transforms });
    expect(parts.every(part => part.status === 'not_run' && !part.releaseReady)).toBe(true);
    expect(certificate).toMatchObject({ status: 'not_run', releaseReady: false });
    expect(certificate.gates.find(item => item.gate === 'joints')?.codes).toContain('ASSEMBLY_EXPECTED_INTERFACES_MISSING:unknown');
  });
});
