import { describe, expect, it } from 'vitest';
import { tools } from '../../../../../../scripts/drawing-to-3d/mcp-server.mjs';
import { GET } from './route';

describe('CAD v1 capability contract', () => {
  it('maps every advertised operation to a published MCP tool and disables quote/RFQ side effects', async () => {
    const payload = await (await GET()).json();
    const mcpNames = new Set(tools.map((tool: { name: string }) => tool.name));
    expect(payload.quoteOrRfqSideEffects).toBe(false);
    for (const operation of payload.operations) {
      expect(mcpNames.has(operation.mcp), `${operation.id} -> ${operation.mcp}`).toBe(true);
      expect(operation.path).toMatch(/^\/api\/cad\/v1\//);
      expect(operation.cli).toBeTruthy();
    }
  });
});
