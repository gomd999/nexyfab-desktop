import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_SCOPE,
  defaultConnectionConfig,
  generateClaudeCodeCommand,
  generateClaudeDesktopConfig,
  generateCodexConfig,
  isAbsoluteAgentPath,
} from './connectionConfig';

const config = {
  gatewayPath: String.raw`C:\Users\Ada Lovelace\NexyFab\agent-mcp-server.mjs`,
  projectRoot: String.raw`C:\Users\Ada Lovelace\Models\project`,
  scope: 'read' as const,
};

describe('desktop agent connection snippets', () => {
  it('defaults to the least-privileged read scope', () => {
    expect(DEFAULT_AGENT_SCOPE).toBe('read');
    expect(defaultConnectionConfig().scope).toBe('read');
  });

  it('generates secret-free Claude Desktop JSON with escaped paths', () => {
    const parsed = JSON.parse(generateClaudeDesktopConfig(config));
    expect(parsed.mcpServers.nexyfab.command).toBe('node');
    expect(parsed.mcpServers.nexyfab.args).toEqual([config.gatewayPath]);
    expect(parsed.mcpServers.nexyfab.env).toEqual({
      NEXYFAB_AGENT_SCOPE: 'read',
      NEXYFAB_PROJECT_ROOT: config.projectRoot,
    });
    expect(generateClaudeDesktopConfig(config)).not.toMatch(/API_KEY|secret|token/i);
  });

  it('quotes Windows paths in Claude Code CLI output', () => {
    const snippet = generateClaudeCodeCommand(config);
    expect(snippet).toContain(`--env 'NEXYFAB_PROJECT_ROOT=${config.projectRoot}'`);
    expect(snippet).toContain(`-- node '${config.gatewayPath}'`);
    expect(generateClaudeCodeCommand({
      ...config,
      projectRoot: String.raw`C:\Users\O'Brien\Models`,
    })).toContain(String.raw`'NEXYFAB_PROJECT_ROOT=C:\Users\O''Brien\Models'`);
  });

  it('writes a Codex MCP config with only the two gateway variables', () => {
    const snippet = generateCodexConfig({ ...config, scope: 'apply' });
    expect(snippet).toContain('[mcp_servers.nexyfab]');
    expect(snippet).toContain('command = "node"');
    expect(snippet).toContain('NEXYFAB_AGENT_SCOPE = "apply"');
    expect(snippet).toContain('NEXYFAB_PROJECT_ROOT');
    expect(snippet).not.toMatch(/API_KEY|secret|token/i);
  });

  it('accepts Windows and Unix absolute paths and rejects control characters', () => {
    expect(isAbsoluteAgentPath(String.raw`C:\NexyFab\gateway.mjs`)).toBe(true);
    expect(isAbsoluteAgentPath('/Applications/NexyFab/gateway.mjs')).toBe(true);
    expect(isAbsoluteAgentPath('relative/gateway.mjs')).toBe(false);
    expect(isAbsoluteAgentPath('C:\\NexyFab\\gateway.mjs\nmalicious')).toBe(false);
  });

  it('generates binary gateway snippets without a node argument', () => {
    const binary = { ...config, gatewayPath: String.raw`C:\Program Files\NexyFab\nexyfab-agent-gateway.exe`, mode: 'binary' as const };
    const desktop = JSON.parse(generateClaudeDesktopConfig(binary));
    expect(desktop.mcpServers.nexyfab.command).toBe(binary.gatewayPath);
    expect(desktop.mcpServers.nexyfab.args).toBeUndefined();
    expect(desktop.mcpServers.nexyfab.env.NEXYFAB_AGENT_RUNTIME_PROFILE).toBe('installer-core');
    expect(generateClaudeCodeCommand(binary)).toContain(`-- '${binary.gatewayPath}'`);
    expect(generateClaudeCodeCommand(binary)).not.toContain('-- node');
    expect(generateCodexConfig(binary)).toContain(`command = ${JSON.stringify(binary.gatewayPath)}`);
    expect(generateCodexConfig(binary)).not.toContain('args =');
  });
});
