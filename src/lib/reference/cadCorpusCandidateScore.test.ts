import { describe, expect, it } from 'vitest';
import { scoreCadCorpusCandidateEvidence } from './cadCorpusCandidateScore';

describe('CAD corpus candidate evidence scoring', () => {
  it('prefers source evidence relevant to requested assertions without awarding pass', () => {
    const flat = `#1=NEXT_ASSEMBLY_USAGE_OCCURRENCE('a','a','',#10,#20,$);`;
    const mechanical = `${flat}\n#2=PRODUCT('Drive Shaft',...);\n#3=PRODUCT('Main Bearing',...);\n#4=CYLINDRICAL_SURFACE('',#9,10.);`;
    expect(scoreCadCorpusCandidateEvidence('step', mechanical, ['assembly_hierarchy', 'shaft_bearing_layout']).score).toBeGreaterThan(scoreCadCorpusCandidateEvidence('step', flat, ['assembly_hierarchy', 'shaft_bearing_layout']).score);
  });
  it('recognizes an actual nested definition edge separately from a flat graph', () => {
    const nested = `#1=NEXT_ASSEMBLY_USAGE_OCCURRENCE('a','a','',#10,#20,$);\n#2=NEXT_ASSEMBLY_USAGE_OCCURRENCE('b','b','',#20,#30,$);`;
    expect(scoreCadCorpusCandidateEvidence('step', nested, ['subassemblies']).reasons).toContain('nested_definition:1');
  });
});
