import { describe, expect, it } from 'vitest';
import { probeStepStructure } from './stepStructureProbe';

const encode = (value: string) => new TextEncoder().encode(value).buffer;

describe('probeStepStructure', () => {
  it('keeps a plain single part on the non-assembly path', () => {
    expect(probeStepStructure(encode("ISO-10303-21;#1=PRODUCT('part');END-ISO-10303-21;"))).toEqual({ isAssembly: false, markers: [] });
  });
  it('recognizes standard assembly relationships case-insensitively', () => {
    const result = probeStepStructure(encode("#9=next_assembly_usage_occurrence('id','','',#1,#2,$);"));
    expect(result.isAssembly).toBe(true);
    expect(result.markers).toContain('NEXT_ASSEMBLY_USAGE_OCCURRENCE');
  });
  it('finds a marker split across scan chunks', () => {
    const prefix = ' '.repeat(256 * 1024 - 10);
    expect(probeStepStructure(encode(`${prefix}NEXT_ASSEMBLY_USAGE_OCCURRENCE`)).isAssembly).toBe(true);
  });
});
