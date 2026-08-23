import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '../../src/app/api/cad/v1/capabilities/route';
import { CAD_V1_CLI_COMMANDS } from '../cli/nexyfab.mjs';
import { tools as localMcpTools } from './mcp-server.mjs';
import { INSTALLER_CORE_TOOLS } from './agent-policy.mjs';
import {
  CAD_V1_ROUTE_EXPOSURE_HOLD,
  CAPABILITY_SURFACE_BASELINE,
  DOWNLOADABLE_REMOTE_MCP_TOOLS,
  INSTALLER_SIDECAR_TOOLS,
} from './capability-surface-manifest.mjs';

type Operation = { id: string; path: string; cli: string | null; mcp: string };

function routeFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === 'route.ts') found.push(path);
    }
  };
  visit(root);
  return found;
}

function routePath(root: string, file: string): string {
  const suffix = relative(root, dirname(file)).split('\\').join('/');
  return `/api/cad/v1${suffix ? `/${suffix}` : ''}`;
}

function downloadableToolNames(): string[] {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(value => JSON.stringify(value)).join('\n') + '\n';
  const result = spawnSync(process.execPath, [resolve('public/downloads/nexyfab-mcp.mjs')], {
    cwd: resolve('.'),
    input,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 10_000_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  return responses.find(response => response.id === 2)?.result?.tools.map((tool: { name: string }) => tool.name) ?? [];
}

describe('Agent/MCP/CLI capability surface inventory', () => {
  it('binds every advertised CAD v1 operation to an existing route, MCP tool, and exact CLI spelling', async () => {
    const payload = await (await GET()).json() as { operations: Operation[] };
    const root = resolve('src/app/api/cad/v1');
    const routes = routeFiles(root).map(file => routePath(root, file)).sort();
    const advertisedPaths = new Set(payload.operations.map(operation => operation.path));
    const localNames = new Set(localMcpTools.map((tool: { name: string }) => tool.name));

    expect(routes).toHaveLength(CAPABILITY_SURFACE_BASELINE.cadV1RouteFiles);
    expect(payload.operations).toHaveLength(CAPABILITY_SURFACE_BASELINE.advertisedCadV1Operations);
    expect(new Set(payload.operations.map(operation => operation.id)).size).toBe(payload.operations.length);
    expect(new Set(payload.operations.map(operation => operation.path)).size).toBe(payload.operations.length);
    for (const operation of payload.operations) {
      expect(routes, operation.path).toContain(operation.path);
      expect(localNames.has(operation.mcp), `${operation.id} -> ${operation.mcp}`).toBe(true);
    }

    const cliCommands = payload.operations.flatMap(operation => operation.cli ? [operation.cli] : []);
    expect(cliCommands).toHaveLength(CAPABILITY_SURFACE_BASELINE.advertisedCadV1CliCommands);
    expect(CAD_V1_CLI_COMMANDS).toEqual(cliCommands);

    const held = routes.filter(path => path !== '/api/cad/v1/capabilities' && !advertisedPaths.has(path));
    expect(held).toEqual([...CAD_V1_ROUTE_EXPOSURE_HOLD]);
    expect(held).toHaveLength(CAPABILITY_SURFACE_BASELINE.heldCadV1Routes);
  });

  it('keeps robot routes unadvertised unless an implemented operation exists', async () => {
    const payload = await (await GET()).json() as { operations: Operation[] };
    const root = resolve('src/app/api/cad/v1');
    const robotRoutes = routeFiles(root)
      .map(file => routePath(root, file))
      .filter(path => path.startsWith('/api/cad/v1/robot/'));
    const robotOperations = payload.operations.filter(operation => operation.path.startsWith('/api/cad/v1/robot/'));
    expect(robotRoutes).toHaveLength(CAPABILITY_SURFACE_BASELINE.robotRouteFiles);
    expect(robotOperations).toHaveLength(CAPABILITY_SURFACE_BASELINE.advertisedRobotOperations);
    expect(robotOperations[0]).toMatchObject({ path: '/api/cad/v1/robot/generate', cli: 'robot generate', mcp: 'generate_robot_6axis' });
  });

  it('matches actual downloadable, installer, and local MCP tool surfaces', () => {
    expect(downloadableToolNames()).toEqual([...DOWNLOADABLE_REMOTE_MCP_TOOLS]);
    expect(INSTALLER_CORE_TOOLS).toEqual([...INSTALLER_SIDECAR_TOOLS]);
    expect(localMcpTools).toHaveLength(CAPABILITY_SURFACE_BASELINE.localMcpTools);
  });

  it('keeps public developer copy on the downloadable MCP names, not local-only aliases', () => {
    const developerPage = readFileSync(resolve('src/app/[lang]/nexyfab/developers/page.tsx'), 'utf8');
    const vertical = readFileSync(resolve('src/app/[lang]/EngVertical.tsx'), 'utf8');
    const dictionary = readFileSync(resolve('src/app/[lang]/engDict.ts'), 'utf8');
    for (const name of DOWNLOADABLE_REMOTE_MCP_TOOLS) expect(developerPage, name).toContain(name);
    for (const name of DOWNLOADABLE_REMOTE_MCP_TOOLS.slice(0, 6)) {
      expect(vertical, name).toContain(name);
      expect(dictionary, name).toContain(name);
    }
    for (const stale of ['text_to_assembly', 'compose_3d', 'generate_domain_package']) {
      expect(developerPage).not.toContain(stale);
      expect(vertical).not.toContain(stale);
      expect(dictionary).not.toContain(stale);
    }
    expect(developerPage).toContain('정확히 15개');
    expect(developerPage).toContain('90 tools');
  });
});
