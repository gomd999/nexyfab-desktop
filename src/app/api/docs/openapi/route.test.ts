import { describe, expect, it } from 'vitest';
import { GET } from './route';

describe('CAD OpenAPI authentication contract', () => {
  it('does not advertise CAD compute as unauthenticated', async () => {
    const response = await GET();
    const document = await response.json() as {
      paths: Record<string, Record<string, { security?: unknown[] }>>;
    };

    for (const [path, operations] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/cad/v1/')) continue;
      for (const operation of Object.values(operations)) {
        expect(operation.security, `${path} must require bearer auth`).toEqual([
          { bearerAuth: [] },
        ]);
      }
    }
  });
});
