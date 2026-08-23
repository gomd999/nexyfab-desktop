export type AgentScope = 'read' | 'propose' | 'apply' | 'export';
export type AgentClient = 'claude-desktop' | 'claude-code' | 'codex';
export type AgentGatewayMode = 'node-script' | 'binary';

export interface AgentConnectionConfig {
  gatewayPath: string;
  projectRoot: string;
  scope?: AgentScope;
  mode?: AgentGatewayMode;
}

export const DEFAULT_AGENT_SCOPE: AgentScope = 'read';
export const INSTALLER_AGENT_PROFILE = 'installer-core';

function normalized(config: AgentConnectionConfig): Required<AgentConnectionConfig> {
  return {
    gatewayPath: config.gatewayPath.trim(),
    projectRoot: config.projectRoot.trim(),
    scope: config.scope && ['read', 'propose', 'apply', 'export'].includes(config.scope)
      ? config.scope
      : DEFAULT_AGENT_SCOPE,
    mode: config.mode === 'binary' ? 'binary' : 'node-script',
  };
}

/** JSON escaping is also the safest representation for Windows paths. */
function jsonString(value: string): string {
  return JSON.stringify(value);
}

function powershellArg(value: string): string {
  // The installable Windows flow presents a PowerShell command. Single-quoted
  // literals do not expand $, backticks, or metacharacters; an apostrophe is
  // represented by two apostrophes.
  return `'${value.replace(/'/g, "''")}'`;
}

export function isAbsoluteAgentPath(value: string): boolean {
  const candidate = value.trim();
  return candidate.length > 0
    && !/[\0\r\n]/.test(candidate)
    && (/^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('/'));
}

export function generateClaudeDesktopConfig(config: AgentConnectionConfig): string {
  const c = normalized(config);
  const command = c.mode === 'binary' ? c.gatewayPath : 'node';
  return JSON.stringify({
    mcpServers: {
      nexyfab: {
        command,
        ...(c.mode === 'binary' ? {} : { args: [c.gatewayPath] }),
        env: {
          NEXYFAB_AGENT_SCOPE: c.scope,
          NEXYFAB_PROJECT_ROOT: c.projectRoot,
          ...(c.mode === 'binary' ? { NEXYFAB_AGENT_RUNTIME_PROFILE: INSTALLER_AGENT_PROFILE } : {}),
        },
      },
    },
  }, null, 2);
}

export function generateClaudeCodeCommand(config: AgentConnectionConfig): string {
  const c = normalized(config);
  const command = c.mode === 'binary' ? powershellArg(c.gatewayPath) : `node ${powershellArg(c.gatewayPath)}`;
  return [
    'claude mcp add --transport stdio nexyfab',
    `--env ${powershellArg(`NEXYFAB_AGENT_SCOPE=${c.scope}`)}`,
    `--env ${powershellArg(`NEXYFAB_PROJECT_ROOT=${c.projectRoot}`)}`,
    ...(c.mode === 'binary' ? [`--env ${powershellArg(`NEXYFAB_AGENT_RUNTIME_PROFILE=${INSTALLER_AGENT_PROFILE}`)}`] : []),
    `-- ${command}`,
  ].join(' ');
}

export function generateCodexConfig(config: AgentConnectionConfig): string {
  const c = normalized(config);
  const command = c.mode === 'binary' ? c.gatewayPath : 'node';
  return [
    '[mcp_servers.nexyfab]',
    `command = ${jsonString(command)}`,
    ...(c.mode === 'binary' ? [] : [`args = [${jsonString(c.gatewayPath)}]`]),
    `env = { NEXYFAB_AGENT_SCOPE = ${jsonString(c.scope)}, NEXYFAB_PROJECT_ROOT = ${jsonString(c.projectRoot)}${c.mode === 'binary' ? `, NEXYFAB_AGENT_RUNTIME_PROFILE = ${jsonString(INSTALLER_AGENT_PROFILE)}` : ''} }`,
    '',
  ].join('\n');
}

export function generateConnectionSnippet(client: AgentClient, config: AgentConnectionConfig): string {
  if (client === 'claude-desktop') return generateClaudeDesktopConfig(config);
  if (client === 'claude-code') return generateClaudeCodeCommand(config);
  return generateCodexConfig(config);
}

// Friendly aliases for consumers that prefer the client name in the function.
export const buildConnectionSnippet = generateConnectionSnippet;
export const createConnectionSnippet = generateConnectionSnippet;

export function defaultConnectionConfig(): Required<AgentConnectionConfig> {
  return { gatewayPath: '', projectRoot: '', scope: DEFAULT_AGENT_SCOPE, mode: 'node-script' };
}
