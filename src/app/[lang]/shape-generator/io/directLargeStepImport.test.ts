// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const tryServerStepObjectImport = vi.hoisted(() => vi.fn());
vi.mock('./serverStepImport', () => ({ tryServerStepObjectImport }));
import { importLargeStepDirect } from './directLargeStepImport';

afterEach(() => vi.unstubAllGlobals());

describe('importLargeStepDirect', () => {
  it('uses intent → direct PUT → commit → object-key worker without reading the File into JS memory', async () => {
    const geometry = { marker: 'preview' };
    tryServerStepObjectImport.mockResolvedValue({ geometry });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        key: 'private/files/u1/id/loader.step', uploadUrl: 'https://r2.example/put?sig=short', contentType: 'application/step',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { id: 'f1' } }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['header-only-fixture'], 'loader.step', { type: 'application/step' });
    Object.defineProperty(file, 'size', { value: 417 * 1024 * 1024 });
    Object.defineProperty(file, 'arrayBuffer', { value: vi.fn(() => { throw new Error('must not read into JS memory'); }) });

    await expect(importLargeStepDirect(file)).resolves.toEqual({ geometry });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://r2.example/put?sig=short');
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: 'PUT', body: file });
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(tryServerStepObjectImport).toHaveBeenCalledWith('loader.step', 'private/files/u1/id/loader.step');
  });
});
