import { describe, expect, it } from 'vitest';
import {
  getCadCapability,
  snapshotCadHostAdapters,
} from './cadCapabilityRegistry';

const allHosts = {
  brep: true,
  solver: true,
  mateSolver: true,
  drawingStudio: true,
  dfm: true,
  fea: true,
  render: true,
  vision: true,
};

describe('CAD capability truth layer', () => {
  it('reports a primitive as executable only when the B-rep adapter is present', () => {
    expect(getCadCapability({ feature: 'brep_primitive' }).status).toBe('unavailable');
    expect(getCadCapability({ feature: 'brep_primitive', environment: { hostAdapters: allHosts } })).toMatchObject({
      status: 'executable', canonicalId: 'brep_primitive', operationMode: 'new-design',
    });
  });

  it('keeps sketch creation executable but gates solving on selection/solver truth', () => {
    expect(getCadCapability({ feature: 'sketch_create' })).toMatchObject({ status: 'executable' });
    expect(getCadCapability({ feature: 'sketch_solve', environment: { hostAdapters: allHosts } }).status).toBe('executable');
    expect(getCadCapability({ feature: 'sketch_solve' }).reason).toBe('required_host_adapter_missing:solver');
  });

  it('does not equate an arbitrary catalog entry with an executable or client-dispatched capability', () => {
    expect(getCadCapability({ feature: 'modeling.lattice' })).toMatchObject({
      status: 'unavailable',
      reason: 'catalog_presence_is_not_an_execution_capability',
      executionGate: 'blocked',
      allowedActions: [],
    });
  });

  it('requires explicit client runtime and selection truth for addable features', () => {
    expect(getCadCapability({ feature: 'fillet' })).toMatchObject({ status: 'requires-selection', executionGate: 'blocked' });
    expect(getCadCapability({ feature: 'fillet', selection: { edgeIds: ['edge-1'] } })).toMatchObject({
      status: 'client-only', reason: 'client_dispatcher_required', executionGate: 'blocked',
    });
    expect(getCadCapability({ feature: 'fillet', selection: { edgeIds: ['edge-1'] }, environment: { clientDispatcherAvailable: true } })).toMatchObject({
      status: 'client-only', reason: 'client_dispatcher_available', executionGate: 'open',
    });
  });

  it('checks an explicitly supplied tool map for SCAD definitions as well as catalog bridges', () => {
    expect(getCadCapability({ feature: 'brep_primitive', environment: { hostAdapters: allHosts, tools: new Set() } })).toMatchObject({
      status: 'unavailable', reason: 'agent_tool_not_registered:brep_primitive',
    });
  });

  it('requires an explicit selection for edge-consuming B-rep edits', () => {
    expect(getCadCapability({ feature: 'brep_fillet', environment: { hostAdapters: allHosts } })).toMatchObject({
      status: 'requires-selection', requiredSelection: 'edge',
    });
    expect(getCadCapability({ feature: 'brep_fillet', selection: { edgeIds: ['edge-1'] }, environment: { hostAdapters: allHosts } }).status).toBe('executable');
  });

  it('bridges assembly, drawing and DFM catalog ids to their actual agent adapters', () => {
    expect(getCadCapability({ feature: 'assembly.mate-dof', environment: { hostAdapters: allHosts } }).status).toBe('executable');
    expect(getCadCapability({ feature: 'drawing.auto-views', environment: { hostAdapters: allHosts } }).status).toBe('executable');
    expect(getCadCapability({ feature: 'dfm.rules', environment: { hostAdapters: allHosts } }).status).toBe('executable');
    expect(getCadCapability({ feature: 'dfm.rules' }).reason).toBe('required_host_adapter_missing:dfm');
  });

  it('labels simulation tools mock/partial rather than production executable', () => {
    expect(getCadCapability({ feature: 'sim_cfd' })).toMatchObject({ status: 'mock-partial', reason: 'mock_adapter_only_production_solver_required' });
  });

  it('never executes an unknown feature and offers a generic-planner fallback for a new prompt', () => {
    const result = getCadCapability({ feature: 'future.unknown', prompt: 'design a compact bracket' });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'unknown_feature', clarificationRequired: true });
    expect(result.fallback).toMatchObject({ kind: 'generic-parametric-planner', available: true });
  });

  it('fail-closes broad modification requests without a mutation scope', () => {
    expect(getCadCapability({ feature: 'sketch_create', mode: 'scoped-modification' })).toMatchObject({
      status: 'unavailable', reason: 'modification_scope_required', executionGate: 'blocked',
    });
    expect(getCadCapability({ feature: 'sketch_create', mode: 'scoped-modification', scope: { featureIds: ['sketch-1'] } })).toMatchObject({
      status: 'executable', operationMode: 'scoped-modification', allowedActions: ['modify', 'verify'],
    });
  });

  it('exposes host adapter presence without importing implementation modules', () => {
    expect(snapshotCadHostAdapters({ brep: {} as never, dfm: undefined })).toMatchObject({ brep: true, dfm: false });
  });

  const ownership = {
    schema: 'nexyfab.cad-session-ownership.v1' as const,
    partIds: ['arm', 'housing'],
    brepHandles: { 'occt:arm': 'arm', 'occt:housing': 'housing' },
    featureIds: { 'feature:arm:fillet': 'arm' },
    mateIds: { 'mate:arm-housing': ['arm', 'housing'] },
  };

  it('requires exact signed ownership for a scoped B-rep selection', () => {
    expect(getCadCapability({
      feature: 'brep_fillet', mode: 'scoped-modification', scope: { partIds: ['arm'] },
      selection: { bodyIds: ['occt:arm'], edgeIds: ['unknown-edge'] },
      environment: { hostAdapters: allHosts, ownership },
    })).toMatchObject({ status: 'unavailable', reason: 'cad_target_ownership_unproven', executionGate: 'blocked' });
    expect(getCadCapability({
      feature: 'brep_fillet', mode: 'scoped-modification', scope: { partIds: ['arm'] },
      selection: { bodyIds: ['occt:arm'], edgeIds: ['all'] },
      environment: { hostAdapters: allHosts, ownership },
    })).toMatchObject({ status: 'executable', selectionOwnership: 'proven' });
  });

  it('rejects mixed B-rep ownership even when both parts are in scope', () => {
    expect(getCadCapability({
      feature: 'brep_boolean', mode: 'scoped-modification', scope: { partIds: ['arm', 'housing'] },
      selection: { bodyIds: ['occt:arm', 'occt:housing'] },
      environment: { hostAdapters: allHosts, ownership },
    })).toMatchObject({ status: 'unavailable', reason: 'cad_cross_part_operation', executionGate: 'blocked' });
  });
});
