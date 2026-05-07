import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseProject, toJsonString } from '@/app/[lang]/shape-generator/io/nfabFormat';
import { nfabProjectExportJsonLooksValid } from '@/lib/nfAssemblySnapshotGuards';

/**
 * M0: 골든 .nfab 이 현재 스키마에서 파싱되는지 고정 (회귀 방지).
 */
describe('M0 golden nfab', () => {
  it('parses tests/golden/m0-minimal.nfab.json', () => {
    const path = join(process.cwd(), 'tests/golden/m0-minimal.nfab.json');
    const json = readFileSync(path, 'utf8');
    const p = parseProject(json);
    expect(p.magic).toBe('nfab');
    expect(p.version).toBe(1);
    expect(p.scene.selectedId).toBe('box');
    expect(p.tree.rootId).toBe('m0-root-node');
    expect(p.name).toContain('M0 golden');
  });

  it('golden file passes export JSON guard and parse→toJsonString stays valid', () => {
    const path = join(process.cwd(), 'tests/golden/m0-minimal.nfab.json');
    const json = readFileSync(path, 'utf8');
    expect(nfabProjectExportJsonLooksValid(json)).toBe(true);
    const p = parseProject(json);
    const again = toJsonString(p, false);
    expect(nfabProjectExportJsonLooksValid(again)).toBe(true);
  });
});
