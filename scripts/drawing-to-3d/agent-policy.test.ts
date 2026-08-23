import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { tools } from './mcp-server.mjs';
import {
  AGENT_SCOPES,
  DEFAULT_AGENT_SCOPE,
  allToolScopes,
  annotationsForTool,
  authorizeToolCall,
  classifyTool,
  filterTools,
  INSTALLER_CORE_TOOLS,
  isPathInsideProjectRoot,
  normalizeAgentRuntimeProfile,
  normalizeAgentScope,
} from './agent-policy.mjs';

describe('NexyFab agent policy', () => {
  it('classifies every currently exported source tool', () => {
    const scopes = allToolScopes() as Record<string, string>;
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(scopes[tool.name]).toBeDefined();
      expect(classifyTool(tool.name).known).toBe(true);
    }
    expect(Object.keys(scopes).sort()).toEqual(tools.map(tool => tool.name).sort());
  });

  it('fails closed for unknown tools', () => {
    const result = authorizeToolCall('tool_added_without_review', {}, { scope: 'export' });
    expect(result.allowed).toBe(false);
    expect(result.denial?.code).toBe('UNKNOWN_TOOL');
    expect(authorizeToolCall('__proto__', {}, { scope: 'export' }).denial?.code).toBe('UNKNOWN_TOOL');
    expect(authorizeToolCall('constructor', {}, { scope: 'export' }).denial?.code).toBe('UNKNOWN_TOOL');
  });

  it('rejects traversal, sibling-prefix escapes, and missing roots', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-agent-policy-'));
    const root = path.join(parent, 'project');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'model.json'), '{}');
    try {
      const traversal = authorizeToolCall('verify_complex_system_graph', {
        graphFile: path.join(root, '..', 'secret.json'),
      }, { scope: 'read', projectRoot: root });
      expect(traversal.denial?.code).toBe('PATH_OUTSIDE_PROJECT_ROOT');

      const sibling = authorizeToolCall('verify_complex_system_graph', {
        graphFile: `${root}-other/secret.json`,
      }, { scope: 'read', projectRoot: root });
      expect(sibling.denial?.code).toBe('PATH_OUTSIDE_PROJECT_ROOT');
      expect(sibling).not.toHaveProperty('projectRoot');

      const alternateSeparator = path.sep === '\\'
        ? `${root}/../outside/secret.json`
        : `${root}\\..\\outside\\secret.json`;
      const alternateDecision = authorizeToolCall('verify_complex_system_graph', {
        graphFile: alternateSeparator,
      }, { scope: 'read', projectRoot: root });
      expect(alternateDecision.denial?.code).toBe('PATH_OUTSIDE_PROJECT_ROOT');

      const noRoot = authorizeToolCall('verify_complex_system_graph', { graphFile: 'model.json' }, { scope: 'read', projectRoot: '' });
      expect(noRoot.denial?.code).toBe('PROJECT_ROOT_REQUIRED');
      expect(authorizeToolCall('verify_complex_system_graph', { graphFile: 'etc/passwd' }, { scope: 'read', projectRoot: path.parse(root).root }).denial?.code).toBe('PROJECT_ROOT_REQUIRED');
      expect(authorizeToolCall('verify_complex_system_graph', { graphFile: 'model.json' }, { scope: 'read', projectRoot: root }).allowed).toBe(true);
      expect(isPathInsideProjectRoot(path.join(root, 'model.json'), root)).toBe(true);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects an in-project symlink that escapes the project root', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-agent-symlink-'));
    const root = path.join(parent, 'project');
    const outside = path.join(parent, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.step'), 'secret');
    const link = path.join(root, 'linked-outside');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      const decision = authorizeToolCall('extract_gdt', {
        stepPath: path.join(link, 'secret.step'),
      }, { scope: 'read', projectRoot: root });
      expect(decision.denial?.code).toBe('PATH_OUTSIDE_PROJECT_ROOT');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('rejects a symlink or junction used as the project trust boundary', () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-agent-root-link-'));
    const actual = path.join(parent, 'actual');
    const linkedRoot = path.join(parent, 'linked-project');
    fs.mkdirSync(actual);
    fs.writeFileSync(path.join(actual, 'model.json'), '{}');
    try {
      fs.symlinkSync(actual, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
      const decision = authorizeToolCall('verify_complex_system_graph', {
        graphFile: path.join(linkedRoot, 'model.json'),
      }, { scope: 'read', projectRoot: linkedRoot });
      expect(decision.denial?.code).toBe('PROJECT_ROOT_REQUIRED');
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('uses read as the safe default and gates higher scopes', () => {
    expect(DEFAULT_AGENT_SCOPE).toBe('read');
    expect(AGENT_SCOPES).toEqual(['read', 'propose', 'apply', 'export']);
    expect(normalizeAgentScope('not-a-scope')).toBe('read');
    expect(filterTools(tools, 'read').some((tool: { name: string }) => tool.name === 'edit_part')).toBe(false);
    expect(filterTools(tools, 'apply').some((tool: { name: string }) => tool.name === 'edit_part')).toBe(true);
  });

  it('adds truthful MCP annotations', () => {
    expect(annotationsForTool('verify_3d')).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(annotationsForTool('verify_cad_project')).toEqual({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
    expect(annotationsForTool('edit_part')).toEqual({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
    expect(annotationsForTool('analyze_fea')).toEqual({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(annotationsForTool('not-a-tool')).toBeNull();
  });

  it('requires export scope when render_preview writes files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-agent-render-'));
    try {
      expect(authorizeToolCall('render_preview', {}, { scope: 'propose', projectRoot: root }).allowed).toBe(true);
      const denied = authorizeToolCall('render_preview', { outDir: 'previews' }, { scope: 'propose', projectRoot: root });
      expect(denied.denial?.code).toBe('SCOPE_REQUIRED');
      expect(denied.requiredScope).toBe('export');
      expect(authorizeToolCall('render_preview', { outDir: '   ' }, { scope: 'propose', projectRoot: root }).denial?.code).toBe('SCOPE_REQUIRED');
      expect(authorizeToolCall('render_preview', { outDir: 'previews' }, { scope: 'export', projectRoot: root }).allowed).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('exposes exactly the qualified installer-core subset and fails closed for others', () => {
    const names = filterTools(tools, 'export', { profile: 'installer-core' }).map((tool: { name: string }) => tool.name);
    expect(names.sort()).toEqual([...INSTALLER_CORE_TOOLS].sort());
    expect(normalizeAgentRuntimeProfile('unknown-profile')).toBe('source');
    expect(authorizeToolCall('verify_3d', {}, { scope: 'read', profile: 'installer-core' }).denial?.code).toBe('PROFILE_TOOL_UNAVAILABLE');
    expect(authorizeToolCall('build_assembly', { assembly: { parts: [] } }, { scope: 'apply', profile: 'installer-core' }).allowed).toBe(true);
  });
});
