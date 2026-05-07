/**
 * M3: 어셈블리 블록이 포함된 골든 `.nfab`가 `parseProject` 전체 파이프에서 살아 있는지 고정.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseProject } from '@/app/[lang]/shape-generator/io/nfabFormat';

describe('M3 golden nfab (assembly)', () => {
  it('parses tests/golden/m3-assembly-minimal.nfab.json with assembly snapshot', () => {
    const path = join(process.cwd(), 'tests/golden/m3-assembly-minimal.nfab.json');
    const json = readFileSync(path, 'utf8');
    const p = parseProject(json);
    expect(p.magic).toBe('nfab');
    expect(p.version).toBe(1);
    expect(p.name).toContain('M3 golden');
    expect(p.assembly).toBeDefined();
    expect(p.assembly!.placedParts).toHaveLength(2);
    expect(p.assembly!.mates).toHaveLength(1);
    expect(p.assembly!.placedParts[0].name).toBe('A');
    expect(p.assembly!.placedParts[1].rotation[1]).toBe(22.5);
    expect(p.assembly!.mates[0].type).toBe('coincident');
    expect(p.assembly!.mates[0].partA).toBe('A');
    expect(p.assembly!.mates[0].partB).toBe('B');
    expect(p.assembly!.mates[0].locked).toBe(true);
  });
});
