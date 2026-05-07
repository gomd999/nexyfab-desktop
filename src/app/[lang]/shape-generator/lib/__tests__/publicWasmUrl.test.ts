import { describe, it, expect, afterEach } from 'vitest';
import { publicWasmUrl } from '../publicWasmUrl';

describe('publicWasmUrl', () => {
  const origBase = process.env.NEXT_PUBLIC_BASE_PATH;
  const origStatic = process.env.NEXT_PUBLIC_STATIC_PREFIX;

  afterEach(() => {
    if (origBase === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = origBase;
    if (origStatic === undefined) delete process.env.NEXT_PUBLIC_STATIC_PREFIX;
    else process.env.NEXT_PUBLIC_STATIC_PREFIX = origStatic;
  });

  it('uses root path when no prefix env is set', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    delete process.env.NEXT_PUBLIC_STATIC_PREFIX;
    expect(publicWasmUrl('replicad_single.wasm')).toBe('/replicad_single.wasm');
    expect(publicWasmUrl('/occt-import-js.wasm')).toBe('/occt-import-js.wasm');
  });

  it('prepends NEXT_PUBLIC_BASE_PATH', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/myapp';
    expect(publicWasmUrl('replicad_single.wasm')).toBe('/myapp/replicad_single.wasm');
  });

  it('strips trailing slash from prefix', () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/myapp/';
    expect(publicWasmUrl('x.wasm')).toBe('/myapp/x.wasm');
  });

  it('NEXT_PUBLIC_STATIC_PREFIX overrides when BASE_PATH unset', () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_STATIC_PREFIX = '/cdn';
    expect(publicWasmUrl('a.wasm')).toBe('/cdn/a.wasm');
  });
});
