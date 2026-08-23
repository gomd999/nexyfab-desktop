import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/cad/v1/capabilities/route';
import { main, CAD_V1_CLI_COMMANDS, EXIT } from './cli/nexyfab.mjs';
import { callTool, tools as localMcpTools } from './drawing-to-3d/mcp-server.mjs';

/**
 * Runtime parity coverage for the advertised CAD v1 surface.
 *
 * This deliberately uses a 503 adapter for every network-backed operation.
 * The real dispatchers still build their request (including multipart files),
 * but no request can leave the test process and no external operation can be
 * mistaken for a passing verification.  Local fixtures are created beneath a
 * unique temp directory and removed after the test.
 */
const ADAPTER_CODE = 'RUNTIME_PARITY_EXTERNAL_NOT_RUN';
const STEP = 'ISO-10303-21;\nEND-ISO-10303-21;\n';
const IFC = 'ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n';

type Fixture = {
  root: string;
  json: string;
  step: string;
  ifc: string;
  inputs: string;
  stl: string;
  output: (name: string) => string;
};

type AdapterCall = {
  phase: 'mcp' | 'cli';
  path: string;
  method: string;
  body: unknown;
};

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'nexyfab-runtime-parity-'));
  const json = join(root, 'fixture.json');
  const step = join(root, 'fixture.step');
  const ifc = join(root, 'fixture.ifc');
  const inputs = join(root, 'authoritative-inputs.json');
  const stl = join(root, 'fixture.stl');
  await Promise.all([
    writeFile(json, JSON.stringify({ parts: [], fixture: true }), 'utf8'),
    writeFile(step, STEP, 'utf8'),
    writeFile(ifc, IFC, 'utf8'),
    writeFile(inputs, '[]\n', 'utf8'),
    writeFile(stl, 'solid fixture\nendsolid fixture\n', 'utf8'),
  ]);
  return { root, json, step, ifc, inputs, stl, output: (name) => join(root, name) };
}

/** Inputs satisfy each advertised MCP schema and its extra inline guards. */
function mcpArgs(name: string, fixture: Fixture): Record<string, unknown> {
  const { json, step } = fixture;
  const commonDoor = {
    pivot: { x: 0, y: 0 }, closedAngleDeg: 0, openAngleDeg: 90,
    widthMm: 900, thicknessMm: 40, obstacles: [],
  };
  const commonEgress = {
    nodes: [{ id: 'origin', point: { x: 0, y: 0 } }, { id: 'exit', point: { x: 1000, y: 0 } }],
    edges: [{ id: 'edge', from: 'origin', to: 'exit', clearWidthMm: 1000 }],
    originNodeIds: ['origin'], exitNodeIds: ['exit'], maximumTravelDistanceMm: 2000,
    minimumClearWidthMm: 800,
  };
  const commonMep = { runs: [], obstacles: [] };
  switch (name) {
    case 'verify_complex_system_graph':
      return { graphFile: json, artifactFiles: [json] };
    case 'verify_gearbox_system_contract':
    case 'verify_machine_skid_system_contract':
    case 'verify_welded_enclosure_system_contract':
      return { graphFile: json, contractFile: json, artifactFiles: [json] };
    case 'analyze_complex_system_change_impact':
      return { baseGraphFile: json, targetGraphFile: json, baseArtifactFiles: [json], targetArtifactFiles: [json] };
    case 'verify_complex_assembly_scale':
      return { benchmarkFile: json, artifactFiles: [json] };
    case 'product_decomposition':
      return { text: 'fixture product with one bounded part' };
    case 'reconcile_topology_references':
      return { previous: [], current: [] };
    case 'cad_feature_program':
      return { prompt: 'fixture feature program' };
    case 'feature_tree_mesh':
      return { tree: {} };
    case 'export_part_step':
      return { program: {} };
    case 'verify_cad_assembly':
      return { state: {} };
    case 'verify_cad_project':
      return { structure: {}, placement: {} };
    case 'verify_door_swing_clearance':
      return commonDoor;
    case 'verify_space_boundary_closure':
      return {
        segments: [
          { id: 'a', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
          { id: 'b', start: { x: 100, y: 0 }, end: { x: 100, y: 100 } },
          { id: 'c', start: { x: 100, y: 100 }, end: { x: 0, y: 0 } },
        ],
      };
    case 'verify_egress_routes':
      return commonEgress;
    case 'verify_mep_interference':
      return commonMep;
    case 'verify_physical_network':
      return {
        id: 'fixture-network', ports: [], nodes: [], connections: [], runs: [],
        rules: {
          maximumConnectionDistanceMm: 0, minimumDrainSlopePercent: 0,
          requireMatchingConnector: true, requirePhysicalRouteGeometry: true,
          requireDiameterMatch: true, requireRunFromConnectedPort: true,
        },
      };
    case 'decide_cad_release':
      return {
        workflowStatus: 'draft', purpose: 'parity fixture', domain: 'mechanical',
        revisionId: 'fixture-revision', revisionSha256: 'fixture-sha256', roundtrips: [],
      };
    case 'evaluate_assembly_animation':
      return { state: {}, animation: {}, frame: 0 };
    case 'apply_assembly_animation_command':
      return { state: {}, animation: {}, command: 'translate fixture 0mm' };
    case 'preview_assembly_selection_edit':
      return { state: {}, featureTrees: {}, selection: [], command: 'inspect fixture' };
    case 'push_pull_step_face':
      return { step, encoding: 'utf8', faceRef: 'f.import.1', distanceMm: 1 };
    case 'analyze_cad_reference':
      return { step: STEP, encoding: 'utf8', format: 'step', scenarioId: 'fixture', lengthUnit: { kind: 'mm' } };
    case 'verify_ifc_semantic_roundtrip':
      return { beforeIfc: IFC, afterIfc: IFC };
    case 'build_ifc_domain_ir':
      return { ifc: IFC, domain: 'alignment' };
    case 'build_ifc_spatial_ir':
      return { ifc: IFC };
    case 'analyze_step_mechanical_relations':
      return { step: STEP };
    case 'plan_ifc_geometry_recovery':
      return { ifc: IFC };
    case 'recover_ifc_geometry':
      return { ifc: IFC, authoritativeInputs: [] };
    case 'verify_assembly_animation':
      return { state: {}, animation: {}, localBoxes: {} };
    case 'verify_ai_generation':
      return { intent: {}, decomposition: {}, parts: [] };
    case 'transition_ai_generation_state':
      return { action: 'initialize', confirmWrite: true };
    case 'refine_ai_generation':
      return {
        confirmWrite: true,
        state: {},
        context: {
          request: 'fixture refinement', stage: 'intent', attempt: 1,
          priorOutputs: {}, priorCheckpointHashes: {}, feedback: [], immutableEvidenceRefs: [],
        },
      };
    case 'advance_ai_generation':
      return { state: {}, program: {}, confirmWrite: true };
    case 'finalize_ai_generation':
      return { state: {}, program: {}, motion: {}, parts: [], confirmWrite: true };
    case 'generate_robot_6axis':
      return { spec: {} };
    case 'verify_manufacturing_evidence':
      return {};
    case 'verify_sheet_metal':
    case 'verify_weldment':
      return { spec: {} };
    case 'analyze_tolerance_stack':
      return { dimensions: [] };
    case 'verify_cad_pmi':
      return { callouts: [], validTopologyRefs: [] };
    default:
      throw new Error(`fixture missing for MCP tool ${name}`);
  }
}

/** Inputs exercise each exact advertised CLI spelling through main(). */
function cliArgs(command: string, fixture: Fixture): string[] {
  const { json, step, ifc, inputs } = fixture;
  switch (command) {
    case 'design': return ['design', 'fixture product'];
    case 'part': return ['part', 'fixture feature'];
    case 'mesh': return ['mesh', '--file', json, '--out', fixture.output('mesh.stl')];
    case 'step': return ['step', '--file', json, '--out', fixture.output('part.step')];
    case 'release decision': return ['release', 'decision', '--file', json];
    case 'reference analyze': return ['reference', 'analyze', '--file', step, '--scenario', 'fixture', '--unit', 'mm'];
    case 'ifc semantic-roundtrip': return ['ifc', 'semantic-roundtrip', '--before', ifc, '--after', ifc];
    case 'ifc domain-ir': return ['ifc', 'domain-ir', '--file', ifc, '--domain', 'alignment'];
    case 'ifc spatial-ir': return ['ifc', 'spatial-ir', '--file', ifc];
    case 'reference mechanical-relations': return ['reference', 'mechanical-relations', '--file', step];
    case 'ifc recovery-plan': return ['ifc', 'recovery-plan', '--file', ifc];
    case 'ifc recover-geometry': return ['ifc', 'recover-geometry', '--file', ifc, '--inputs', inputs];
    case 'topology reconcile': return ['topology', 'reconcile', '--file', json];
    case 'assembly verify': return ['assembly', 'verify', '--file', json];
    case 'project verify': return ['project', 'verify', '--file', json];
    case 'interior door-swing --file': return ['interior', 'door-swing', '--file', json];
    case 'interior space-boundary --file': return ['interior', 'space-boundary', '--file', json];
    case 'interior egress --file': return ['interior', 'egress', '--file', json];
    case 'interior mep-interference --file': return ['interior', 'mep-interference', '--file', json];
    case 'animation evaluate': return ['animation', 'evaluate', '--file', json];
    case 'animation command': return ['animation', 'command', '--file', json, '--command', 'translate fixture 0mm'];
    case 'assembly edit --verify-brep': return ['assembly', 'edit', '--file', json, '--command', 'inspect fixture', '--verify-brep'];
    case 'brep push-pull': return ['brep', 'push-pull', '--file', json];
    case 'animation verify': return ['animation', 'verify', '--file', json];
    case 'generation verify': return ['generation', 'verify', '--file', json];
    case 'generation state --file': return ['generation', 'state', '--file', json];
    case 'generation advance --file': return ['generation', 'advance', '--file', json];
    case 'generation finalize --file': return ['generation', 'finalize', '--file', json];
    case 'robot generate': return ['robot', 'generate', '--file', json];
    case 'manufacturing verify': return ['manufacturing', 'verify', '--file', json];
    case 'sheet-metal verify': return ['sheet-metal', 'verify', '--file', json];
    case 'weldment verify': return ['weldment', 'verify', '--file', json];
    case 'tolerance analyze': return ['tolerance', 'analyze', '--file', json];
    case 'pmi verify': return ['pmi', 'verify', '--file', json];
    default: throw new Error(`fixture missing for CLI command ${command}`);
  }
}

async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = '';
  let stderr = '';
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
  try {
    return { value: await fn(), stdout, stderr };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

describe('advertised MCP/API/CLI runtime dispatch parity', () => {
  let fixture: Fixture | undefined;
  let previousFetch: typeof globalThis.fetch;
  let previousApiKey: string | undefined;
  let previousApiUrl: string | undefined;

  afterEach(async () => {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.NEXYFAB_API_KEY;
    else process.env.NEXYFAB_API_KEY = previousApiKey;
    if (previousApiUrl === undefined) delete process.env.NEXYFAB_API_URL;
    else process.env.NEXYFAB_API_URL = previousApiUrl;
    if (fixture) await rm(fixture.root, { recursive: true, force: true });
    fixture = undefined;
  });

  it('invokes all 42 API/MCP operations and all 34 CLI commands, external work NOT_RUN', async () => {
    const fx = await makeFixture();
    fixture = fx;
    previousFetch = globalThis.fetch;
    previousApiKey = process.env.NEXYFAB_API_KEY;
    previousApiUrl = process.env.NEXYFAB_API_URL;
    process.env.NEXYFAB_API_KEY = 'nf_runtime_parity_fixture';
    process.env.NEXYFAB_API_URL = 'https://runtime-parity.invalid';

    const calls: AdapterCall[] = [];
    let phase: AdapterCall['phase'] = 'mcp';
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      calls.push({ phase, path: url.pathname, method: init.method ?? 'GET', body: init.body });
      return new Response(JSON.stringify({
        ok: false,
        code: ADAPTER_CODE,
        error: 'external runtime intentionally not run by parity harness',
        reportedGatePass: false,
        designOk: false,
        releaseReady: false,
        trustBoundary: 'client_asserted_preview',
      }), { status: 503, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;

    const capabilityResponse = await GET();
    const capability = await capabilityResponse.json() as {
      operations: Array<{ id: string; path: string; cli: string | null; mcp: string }>;
    };
    expect(capability.operations).toHaveLength(42);
    expect(new Set(capability.operations.map((operation) => operation.mcp)).size).toBe(42);
    for (const operation of capability.operations) {
      expect(localMcpTools.some((tool: { name: string }) => tool.name === operation.mcp), operation.id).toBe(true);
      const result = await callTool(operation.mcp, mcpArgs(operation.mcp, fx));
      expect(result, operation.id).toMatchObject({ ok: false });
    }

    const mcpCalls = calls.filter((call) => call.phase === 'mcp');
    expect(mcpCalls).toHaveLength(42);
    expect(new Set(mcpCalls.map((call) => call.path))).toEqual(new Set(capability.operations.map((operation) => operation.path)));
    expect(mcpCalls.every((call) => call.method === 'POST')).toBe(true);
    const generationCalls = mcpCalls.filter((call) => call.path.includes('/generation/'));
    expect(generationCalls.length).toBeGreaterThan(0);
    expect(generationCalls.every((call) => !String(call.body).includes('confirmWrite'))).toBe(true);

    phase = 'cli';
    expect(CAD_V1_CLI_COMMANDS).toHaveLength(34);
    const cliOperations = capability.operations.filter(
      (operation): operation is typeof operation & { cli: string } => operation.cli !== null,
    );
    expect(cliOperations).toHaveLength(34);
    expect(cliOperations.map((operation) => operation.cli).sort()).toEqual(
      [...CAD_V1_CLI_COMMANDS].sort(),
    );
    for (const command of CAD_V1_CLI_COMMANDS) {
      const callsBeforeCommand = calls.length;
      const result = await capture(() => main(cliArgs(command, fx)));
      // The 503 adapter is a deliberate fail-closed boundary.  A zero here
      // would mean this test accidentally certified an external operation.
      expect(result.value, command).toBe(EXIT.server);
      const commandCalls = calls.slice(callsBeforeCommand).filter((call) => call.phase === 'cli');
      expect(commandCalls, command).toHaveLength(1);
      expect(commandCalls[0]?.path, command).toBe(
        cliOperations.find((operation) => operation.cli === command)?.path,
      );
    }

    const cliCalls = calls.filter((call) => call.phase === 'cli');
    expect(cliCalls).toHaveLength(34);
    expect(cliCalls.every((call) => call.method === 'POST')).toBe(true);
    expect(new Set(cliCalls.map((call) => call.path))).toEqual(
      new Set(cliOperations.map((operation) => operation.path)),
    );
  });
});
