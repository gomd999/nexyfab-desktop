import { describe, expect, it } from 'vitest';
import {
  ARCHITECTURE_INTERIOR_CATALOG_VERSION,
  ARCHITECTURE_INTERIOR_TOOL_CATALOG,
  getArchitectureInteriorToolCatalog,
  validateArchitectureInteriorToolArguments,
  validateArchitectureInteriorToolCatalog,
} from './architectureInteriorToolCatalog';

describe('architecture/interior browser tool catalog', () => {
  it('exposes the complete deterministic catalog with explicit scopes', () => {
    expect(ARCHITECTURE_INTERIOR_CATALOG_VERSION).toBe('nexyfab.precision-cad.architecture-interior.v1');
    expect(getArchitectureInteriorToolCatalog()).toBe(ARCHITECTURE_INTERIOR_TOOL_CATALOG);
    expect(validateArchitectureInteriorToolCatalog()).toEqual([]);
    expect(ARCHITECTURE_INTERIOR_TOOL_CATALOG.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'get_project_context', 'list_storeys_spaces', 'inspect_element', 'measure_element',
      'create_storey', 'edit_storey', 'create_wall', 'edit_wall', 'create_space', 'edit_space', 'create_slab', 'edit_slab',
      'create_opening', 'create_grid', 'edit_grid', 'edit_opening', 'create_stair', 'edit_stair', 'create_shaft', 'edit_shaft', 'create_elevator', 'edit_elevator', 'create_service_opening', 'edit_service_opening', 'edit_furniture',
      'edit_finish', 'edit_ceiling', 'edit_light', 'edit_millwork',
      'verify_architecture', 'verify_interior', 'verify_space', 'verify_egress',
      'verify_door', 'verify_mep', 'verify_daylight', 'render_plan', 'render_section',
      'render_3d', 'export_ifc', 'export_drawing', 'export_schedule',
    ]));
    expect(ARCHITECTURE_INTERIOR_TOOL_CATALOG.filter(tool => tool.scope === 'apply')).toHaveLength(31);
    expect(ARCHITECTURE_INTERIOR_TOOL_CATALOG.every(tool => tool.adapter.deterministic && tool.adapter.network === 'none' && tool.adapter.execution === 'contract_only')).toBe(true);
  });

  it('requires revision/document/object/parameter paths and a strict patch for apply tools', () => {
    expect(validateArchitectureInteriorToolArguments('edit_wall', {
      revision: 4, documentId: 'architecture', objectId: 'wall-1', parameterPaths: ['geometry.startMm', 'geometry.endMm'],
      patch: { startMm: [0, 0], endMm: [1000, 0] },
    })).toEqual([]);
    expect(validateArchitectureInteriorToolArguments('edit_wall', {
      revision: 4, documentId: 'architecture', objectId: 'wall-1', patch: {},
    })).toContain('invalid_tool_arguments');
    expect(validateArchitectureInteriorToolArguments('edit_wall', {
      revision: 4, documentId: 'architecture', objectId: 'wall-1', parameterPaths: [], patch: {},
    })).toEqual(expect.arrayContaining(['parameter_paths_bounds_invalid', 'apply_patch_required']));
    expect(validateArchitectureInteriorToolArguments('edit_wall', {
      revision: 4, documentId: 'architecture', objectId: 'wall-1', parameterPaths: ['geometry.heightMm'], patch: { startMm: [0, 0] },
    })).toEqual(expect.arrayContaining(['patch_parameter_path_missing:startMm', 'parameter_path_not_in_patch:geometry.heightMm']));
    expect(validateArchitectureInteriorToolArguments('create_stair', {
      revision: 1, documentId: 'architecture', objectId: 'stair-1', parameterPaths: ['fromStoreyId'],
      patch: { fromStoreyId: 'level-1' },
    })).toContain('invalid_tool_arguments');
    expect(validateArchitectureInteriorToolArguments('edit_stair', {
      revision: 1, documentId: 'architecture', objectId: 'stair-1', parameterPaths: ['widthMm'],
      patch: { widthMm: 1200 },
    })).toEqual([]);
    expect(validateArchitectureInteriorToolArguments('edit_grid', {
      revision: 1, documentId: 'architecture', objectId: 'grid-1', parameterPaths: ['name'], patch: { name: 'B' },
    })).toEqual([]);
    expect(validateArchitectureInteriorToolArguments('edit_grid', {
      revision: 1, documentId: 'architecture', objectId: 'grid-1', parameterPaths: ['axis'], patch: {},
    })).toEqual(expect.arrayContaining(['apply_patch_required', 'parameter_path_not_in_patch:axis']));
  });

  it('rejects filesystem paths, URLs, secret-like keys and unbounded geometry', () => {
    expect(validateArchitectureInteriorToolArguments('inspect_element', {
      revision: 1, documentId: 'architecture', objectId: 'wall-1', includeRelations: true, url: 'https://example.invalid',
    })).toEqual(expect.arrayContaining(['forbidden_key:url', 'invalid_tool_arguments']));
    expect(validateArchitectureInteriorToolArguments('render_plan', {
      revision: 1, documentId: 'architecture', viewCode: 'plan', objectIds: ['C:\\temp\\drawing.ifc'],
    })).toContain('forbidden_path_or_url:objectId');
    expect(validateArchitectureInteriorToolArguments('edit_space', {
      revision: 1, documentId: 'architecture', objectId: 'space-1', parameterPaths: ['boundaryMm'],
      patch: { boundaryMm: Array.from({ length: 257 }, () => [0, 0]) },
    })).toContain('array_too_large:boundaryMm');
    expect(validateArchitectureInteriorToolArguments('edit_space', {
      revision: 1, documentId: 'architecture', objectId: 'space-1', parameterPaths: ['boundaryMm'],
      patch: { boundaryMm: [[0, 0, 1], [1, 0], [1, 1]] },
    })).toContain('point2_bounds_invalid:boundaryPointMm');
  });

  it('keeps descriptions as stable codes and schemas closed to unknown properties', () => {
    expect(ARCHITECTURE_INTERIOR_TOOL_CATALOG.every(tool => /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(tool.descriptionCode))).toBe(true);
    const tampered = ARCHITECTURE_INTERIOR_TOOL_CATALOG.map(tool => tool.name === 'create_wall'
      ? { ...tool, parameters: { ...tool.parameters, additionalProperties: true } }
      : tool);
    expect(validateArchitectureInteriorToolCatalog(tampered).some(issue => issue.startsWith('catalog_schema_invalid'))).toBe(true);
    expect(validateArchitectureInteriorToolArguments('get_project_context', {
      revision: 0, documentId: 'architecture', contextCode: 'summary', localizedText: '한국어',
    })).toContain('invalid_tool_arguments');
  });
});
