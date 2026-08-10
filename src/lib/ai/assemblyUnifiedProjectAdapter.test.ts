import { describe, expect, it } from 'vitest';
import { buildAssemblyTemplate, listAssemblyTemplates } from '../../../scripts/drawing-to-3d/domain-assemblies.mjs';
import { assemblyUnifiedProject } from './assemblyUnifiedProjectAdapter';

describe('assembly to unified project adapter', () => {
  it.each([
    ['mech', 'mechanical'],
    ['building', 'architecture'],
    ['civil', 'civil'],
    ['landscape', 'landscape'],
    ['interior', 'interior'],
  ] as const)('creates a valid %s canonical document', (domain, documentDomain) => {
    const result = assemblyUnifiedProject(`p-${domain}`, domain, { name: domain, parts: [{ id: `${domain}-1`, type: 'box' }] });
    expect(result.issues).toEqual([]);
    expect(result.project.documents[0]?.domain).toBe(documentDomain);
    expect(result.project.documents[0]?.profileId).toBe(domain === 'mech' ? 'mechanical' : domain);
    expect(result.project.documents[0]?.semanticState).toMatchObject({
      status: 'not_run',
      reasonCode: 'DEEP_DOCUMENT_ADAPTER_NOT_RUN',
    });
  });

  it('fails closed on missing or duplicate object identity', () => {
    const missing = assemblyUnifiedProject('p1', 'building', { parts: [{ type: 'box' }] });
    expect(missing.issues.join(' ')).toContain('empty global object id');
    const duplicate = assemblyUnifiedProject('p2', 'civil', { parts: [{ id: 'wall' }, { id: 'wall' }] });
    expect(duplicate.issues.join(' ')).toContain('duplicate or empty global object id');
  });

  it('records alignment and terrain representations only when present', () => {
    expect(assemblyUnifiedProject('c', 'civil', { parts: [{ id: 'road' }], alignment: {} }).project.documents[0]?.representations).toContain('alignment');
    expect(assemblyUnifiedProject('l', 'landscape', { parts: [{ id: 'site' }], terrainMeta: {} }).project.documents[0]?.representations).toContain('tin');
  });

  it('gives all 59 templates an explicit deep-document not_run boundary', () => {
    const templates = listAssemblyTemplates() as Array<{ domain: string; id: string }>;
    expect(templates).toHaveLength(59);

    for (const template of templates) {
      const domain = template.domain === 'bridge' ? 'civil' : template.domain === 'mech' ? 'mech' : template.domain;
      const result = assemblyUnifiedProject(`template-${template.id}`, domain as 'mech' | 'building' | 'civil' | 'landscape' | 'interior', {
        templateId: template.id,
        templateDomain: template.domain,
        parts: [{ id: `${template.domain}-${template.id}` }],
      });
      expect(result.issues, `${template.domain}/${template.id}`).toEqual([]);
      expect(result.project.documents[0]?.semanticState).toMatchObject({
        status: 'not_run',
        sourceTemplateId: template.id,
        reasonCode: 'DEEP_DOCUMENT_ADAPTER_NOT_RUN',
      });
    }
  });

  it('preserves template identity on a real deterministic build', () => {
    const assembly = buildAssemblyTemplate('building', 'water_tank', {}) as { templateId?: string; templateDomain?: string };
    expect(assembly).toMatchObject({ templateId: 'water_tank', templateDomain: 'building' });
  });
});
