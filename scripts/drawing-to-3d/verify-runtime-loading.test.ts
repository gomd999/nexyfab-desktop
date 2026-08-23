import { readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { resolveOpenScadAsset } from './verify.mjs';

describe('OpenSCAD verifier runtime isolation', () => {
  it('resolves only the two fixed runtime assets inside public/openscad', () => {
    const expectedRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'openscad');
    for (const asset of ['openscad.js', 'openscad.wasm']) {
      const resolved = resolveOpenScadAsset(asset);
      const contained = relative(expectedRoot, resolved);
      expect(basename(resolved)).toBe(asset);
      expect(contained.startsWith('..') || isAbsolute(contained)).toBe(false);
    }
    expect(() => resolveOpenScadAsset('../mcp-server.mjs')).toThrow('unsupported OpenSCAD runtime asset');
    expect(() => resolveOpenScadAsset('file:///tmp/attacker.mjs')).toThrow('unsupported OpenSCAD runtime asset');
  });

  it('keeps the fixed Emscripten glue import runtime-isolated from webpack', () => {
    const source = readFileSync(fileURLToPath(new URL('./verify.mjs', import.meta.url)), 'utf8');
    expect(source).toContain('import(/* webpackIgnore: true */ pathToFileURL(OPENSCAD_JS).href)');
    expect(source).not.toContain('import(pathToFileURL(join(OSDIR');
  });
});
