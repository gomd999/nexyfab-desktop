#!/usr/bin/env node
import { startInstallerCoreServer } from './installer-core-agent-server.mjs';

// The SEA entry has no command-line surface: stdin/stdout are the MCP protocol.
void startInstallerCoreServer({ scope: process.env.NEXYFAB_AGENT_SCOPE ?? 'read' })
  .catch(() => { process.exitCode = 1; });
