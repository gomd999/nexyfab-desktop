import { describe, expect, it } from 'vitest';
import {
  SPATIAL_CAD_COMMAND_SCHEMA,
  applySpatialCadCommand,
  createSpatialCadDocument,
  type SpatialCadCommand,
} from './spatialCadCommand';

function command(baseRevision: number, value: number): SpatialCadCommand {
  return {
    schema: SPATIAL_CAD_COMMAND_SCHEMA,
    commandId: `cmd-${baseRevision}`,
    domain: 'building',
    baseRevision,
    actor: 'human',
    operation: { kind: 'set_parameter', key: 'width', value },
  };
}

describe('spatial CAD command transaction', () => {
  it('commits one immutable semantic revision and invalidates verification', () => {
    const base = createSpatialCadDocument('building', { width: 12_000, depth: 8000 });
    const result = applySpatialCadCommand(base, command(0, 13_500));
    expect(result).toMatchObject({ committed: true, document: { revision: 1, parameters: { width: 13_500 }, verification: 'NOT_RUN' }, changedPaths: ['parameters.width'] });
    expect(base).toMatchObject({ revision: 0, parameters: { width: 12_000 } });
  });

  it('refuses stale and cross-domain commands without changing the document', () => {
    const base = createSpatialCadDocument('building', { width: 12_000 });
    expect(applySpatialCadCommand(base, command(4, 13_500))).toMatchObject({ committed: false, issues: ['stale_base_revision'], document: base });
    expect(applySpatialCadCommand(base, { ...command(0, 13_500), domain: 'civil' })).toMatchObject({ committed: false, issues: ['domain_mismatch'], document: base });
  });

  it('refuses prototype keys, non-finite values and no-op replacements', () => {
    const base = createSpatialCadDocument('interior', { width: 8000 });
    expect(applySpatialCadCommand(base, { ...command(0, 1), domain: 'interior', operation: { kind: 'set_parameter', key: '__proto__', value: 1 } }).committed).toBe(false);
    expect(applySpatialCadCommand(base, { ...command(0, 1), domain: 'interior', operation: { kind: 'set_parameter', key: 'width', value: Number.NaN } }).committed).toBe(false);
    expect(applySpatialCadCommand(base, { ...command(0, 1), domain: 'interior', operation: { kind: 'replace_parameters', parameters: { width: 8000 } } })).toMatchObject({ committed: false, issues: ['no_effect'] });
  });
});

