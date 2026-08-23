import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderScadToGeometry } from './renderToGeometry';

describe('renderScadToGeometry transport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts directly to the canonical trailing-slash route without a 308 redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'worker unavailable', code: 'WORKER_UNAVAILABLE' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(renderScadToGeometry('cube([10,10,10]);')).rejects.toMatchObject({ status: 503, code: 'WORKER_UNAVAILABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/nexyfab/openscad-render/');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });
});
