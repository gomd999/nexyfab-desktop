import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '../src/app/api/cad/v1/capabilities/route';
import { CAD_V1_CLI_COMMANDS } from './cli/nexyfab.mjs';
import { tools as localMcpTools } from './drawing-to-3d/mcp-server.mjs';
import { getToolScope, INSTALLER_CORE_TOOLS } from './drawing-to-3d/agent-policy.mjs';
import { AGENT_SURFACE_MATRIX, discoverUserFacingAgentHttpRoutes, validateAgentSurfaceMatrix } from './agent-surface-matrix.mjs';
import { CAD_V1_ROUTE_EXPOSURE_HOLD, CAD_V1_ROUTE_EXPOSURE_HOLD_REASONS } from './drawing-to-3d/capability-surface-manifest.mjs';
import { requiredCadApiKeyScope } from '../src/lib/cad-api-proxy-boundary';

function routeFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name === 'route.ts') files.push(file);
    }
  };
  visit(root);
  return files;
}

function downloadableToolNames(): string[] {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [resolve('public/downloads/nexyfab-mcp.mjs')], {
    cwd: resolve('.'), input, encoding: 'utf8', timeout: 5_000, maxBuffer: 10_000_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  return responses.find(response => response.id === 2)?.result?.tools.map((tool: { name: string }) => tool.name) ?? [];
}

describe('Agent surface matrix is a fail-closed contract', () => {
  it('matches the live route, CAD v1, local MCP, downloadable MCP, sidecar, and CLI inventories', async () => {
    const payload = await (await GET()).json() as {
      operations: Array<{ path: string; mcp: string; cli: string | null }>;
    };
    const routeRoot = resolve('src/app/api/cad/v1');
    const routePaths = routeFiles(routeRoot)
      .map(file => `/api/cad/v1${relative(routeRoot, dirname(file)).split('\\').join('/') ? `/${relative(routeRoot, dirname(file)).split('\\').join('/')}` : ''}`)
      .filter(path => path !== '/api/cad/v1/capabilities')
      .sort();
    const advertisedPaths = payload.operations.map(operation => operation.path).sort();
    const heldPaths = [...CAD_V1_ROUTE_EXPOSURE_HOLD].sort();
    expect(new Set(routePaths)).toEqual(new Set([...advertisedPaths, ...heldPaths]));
    expect(routePaths).toHaveLength(advertisedPaths.length + heldPaths.length);
    const discoveredAgentRoutes = discoverUserFacingAgentHttpRoutes(resolve('.'));
    const actualWebRoutes = discoveredAgentRoutes.map(route => `${route.method} ${route.path}`).sort();
    const actual = {
      webRoutes: actualWebRoutes,
      cadV1RoutePaths: routePaths,
      cadV1Operations: payload.operations.map(operation => ({ path: operation.path, mcp: operation.mcp, cli: operation.cli })),
      localMcpTools: localMcpTools.map(tool => tool.name),
      downloadableMcpTools: downloadableToolNames(),
      installerSidecarTools: [...INSTALLER_CORE_TOOLS],
      cliCommands: [...CAD_V1_CLI_COMMANDS],
    };
    const validationOptions = Object.assign({ root: resolve('.') }, { actual });
    const result = validateAgentSurfaceMatrix(AGENT_SURFACE_MATRIX, validationOptions);
    expect(result, result.errors.join('\n')).toEqual({ ok: true, errors: [] });
    for (const operation of AGENT_SURFACE_MATRIX.cadV1.advertisedOperations) {
      expect(operation.web.requiredAuthScope).toBe(requiredCadApiKeyScope(operation.path));
      expect(operation.mcp.requiredAuthScope).toBe(operation.web.requiredAuthScope);
      if (operation.cli.availability !== 'HOLD') {
        expect(operation.cli.requiredAuthScope).toBe(operation.web.requiredAuthScope);
      }
    }
    expect(discoveredAgentRoutes.map(route => `${route.method} ${route.path}`)).toEqual([
      'GET /api/nexyfab/projects/[id]/architecture-interior-agent',
      'GET /api/nexyfab/projects/[id]/precision-cad-agent/catalog',
      'GET /api/nexyfab/scad-agent/brep-mesh',
      'GET /api/nexyfab/scad-agent/brep-step',
      'GET /api/nexyfab/scad-agent/presence',
      'POST /api/nexyfab/projects/[id]/architecture-interior-agent',
      'POST /api/nexyfab/projects/[id]/precision-cad-agent/bootstrap',
      'POST /api/nexyfab/projects/[id]/precision-cad-agent/call',
      'POST /api/nexyfab/projects/[id]/precision-cad-agent/turn',
      'POST /api/nexyfab/scad-agent',
      'POST /api/nexyfab/scad-agent/presence',
    ]);
    for (const route of AGENT_SURFACE_MATRIX.webAgent.routes) {
      const source = readFileSync(resolve(route.dispatcher.source), 'utf8');
      if (route.apiKeyScopeEnforcement === 'explicit') {
        expect(source).toContain(`'${route.requiredAuthScope}'`);
        if (route.agentKind === 'remote_installer_agent') expect(source).toContain('hasPrecisionCadProjectScope');
        else expect(source).toContain('scopes.includes');
      } else {
        expect(route.requiredAuthScope).toBeNull();
      }
      if (route.originRequirement === 'same_origin_required') expect(source).toContain('checkOrigin(req)');
      expect(route.releaseClaimAllowed).toBe(false);
      expect(route.runtimeBoundary.processLocalState.length).toBeGreaterThan(0);
      expect(route.runtimeBoundary.crossReplica.length).toBeGreaterThan(0);
    }
    expect(new Set(AGENT_SURFACE_MATRIX.webAgent.routes.map(route => route.agentKind))).toEqual(
      new Set(['ai_design_agent', 'domain_agent', 'remote_installer_agent']),
    );
    expect(AGENT_SURFACE_MATRIX.downloadableRemoteMcp.localOverlapByName.filter(name => actual.localMcpTools.includes(name))).toEqual(AGENT_SURFACE_MATRIX.downloadableRemoteMcp.localOverlapByName);
    expect(AGENT_SURFACE_MATRIX.downloadableRemoteMcp.remoteOnlyByName.every(name => !actual.localMcpTools.includes(name))).toBe(true);
  });

  it('requires every web-only route to deny MCP and CLI claims explicitly', () => {
    const broken = structuredClone(AGENT_SURFACE_MATRIX);
    broken.webAgent.routes[0].mcp.availability = 'dispatcher';
    const result = validateAgentSurfaceMatrix(broken, { root: resolve('.') });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('web:scad-ai-design-agent:mcp_claim_not_closed');
  });

  it('fails when any independently discovered Agent HTTP method is omitted', () => {
    const broken = structuredClone(AGENT_SURFACE_MATRIX);
    broken.webAgent.routes = broken.webAgent.routes.slice(1);
    const result = validateAgentSurfaceMatrix(broken, { root: resolve('.') });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('discovered_web_agent_routes_mismatch');
  });

  it('does not invent an API-key scope for routes that authenticate without a scope guard', () => {
    const broken = structuredClone(AGENT_SURFACE_MATRIX);
    const route = broken.webAgent.routes.find(item => item.id === 'scad-ai-design-presence-read');
    if (!route) throw new Error('scad-ai-design-presence-read fixture is missing');
    route.requiredAuthScope = 'write:projects';
    expect(validateAgentSurfaceMatrix(broken, { root: resolve('.') }).errors).toContain(
      'web:scad-ai-design-presence-read:unscoped_route_must_not_invent_scope',
    );
  });

  it('fails closed when a CAD operation loses its dispatcher or release boundary', () => {
    const missingDispatcher = structuredClone(AGENT_SURFACE_MATRIX);
    delete missingDispatcher.cadV1.advertisedOperations[0].mcp.entrypoint;
    expect(validateAgentSurfaceMatrix(missingDispatcher, { root: resolve('.') }).ok).toBe(false);

    const falseClaim = structuredClone(AGENT_SURFACE_MATRIX);
    falseClaim.cadV1.advertisedOperations[0].mcp.releaseClaimAllowed = true;
    expect(validateAgentSurfaceMatrix(falseClaim, { root: resolve('.') }).ok).toBe(false);
  });

  it('keeps source references inside this project and does not treat evidence text as a dispatcher', () => {
    for (const operation of AGENT_SURFACE_MATRIX.cadV1.advertisedOperations) {
      for (const surface of ['web', 'mcp'] as const) {
        const source = operation[surface].source;
        expect(source).not.toContain('docs/evidence');
        expect(statSync(resolve(source)).isFile()).toBe(true);
      }
    }
    expect(readFileSync(resolve('scripts/agent-surface-matrix.mjs'), 'utf8')).toContain('missingDispatcher');
  });

  it('keeps every advertised CAD MCP mutation scope aligned with the Agent policy', () => {
    for (const operation of AGENT_SURFACE_MATRIX.cadV1.advertisedOperations) {
      expect(getToolScope(operation.mcp.name), operation.id).toBe(operation.mcp.mutationScope);
      expect(operation.mcp.approvalBoundary, operation.id).toBe('cad_http_boundary_only');
      expect(operation.mcp.approvalStatus, operation.id).toBe('HOLD_raw_mcp_entrypoint');
    }
  });

  it('records the commercial persistence contract for generation state transitions', () => {
    const expected = {
      refine_ai_generation: 'commercial_mode_postgres_generation_state',
      transition_ai_generation_state: 'commercial_mode_postgres_generation_state',
      advance_ai_generation: 'commercial_mode_postgres_generation_state_with_advance_replay_and_topology_lineage',
      finalize_ai_generation: 'commercial_mode_postgres_generation_state_with_verified_receipt_reference',
    } as const;
    for (const [id, persistence] of Object.entries(expected)) {
      const operation = AGENT_SURFACE_MATRIX.cadV1.advertisedOperations.find(item => item.id === id);
      expect(operation, id).toBeDefined();
      expect(operation?.web.requiredAuthScope, id).toBe('write:projects');
      expect(operation?.web.commercialPersistence, id).toBe(persistence);
      expect(operation?.mcp.commercialPersistence, id).toBe(persistence);
    }
  });

  it('keeps side-effecting held routes explicitly marked HOLD', () => {
    const statusPath = '/api/cad/v1/architecture/daylight/status';
    const statusReason = AGENT_SURFACE_MATRIX.cadV1.heldRoutes.find(item => item.path === statusPath)?.reason;
    expect(statusReason).toBe(CAD_V1_ROUTE_EXPOSURE_HOLD_REASONS[statusPath]);
    expect(statusReason).toContain('HOLD');
    expect(statusReason).toContain('side_effect');
    expect(CAD_V1_ROUTE_EXPOSURE_HOLD).toContain(statusPath);
  });
});
