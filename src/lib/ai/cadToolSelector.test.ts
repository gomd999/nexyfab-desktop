import { describe, expect, it } from 'vitest';
import { normalizeMechanicalVocabulary } from './mechanicalVocabulary';
import { selectCadTools } from './cadToolSelector';

describe('native CAD tool selection', () => {
  it('routes explicit interference requests to the verifier', () => {
    const text = '브래킷 간섭을 검사하고 도면과 BOM을 갱신해줘';
    const result = selectCadTools(text, normalizeMechanicalVocabulary(text).hits);
    expect(result.map(item => item.tool)).toEqual(expect.arrayContaining(['interference-check', 'drawing-bom', 'scad']));
  });

  it('routes shaft alignment to mate repair', () => {
    const text = 'shaft를 기준축에 메이트해줘';
    expect(selectCadTools(text, normalizeMechanicalVocabulary(text).hits).map(item => item.tool)).toContain('mate-repair');
  });

  it('selects existing planner and repair loop for complex refinement', () => {
    const text = '복잡한 제품 구조를 구체화하고 간섭을 고쳐 재생성해줘';
    const tools = selectCadTools(text, normalizeMechanicalVocabulary(text).hits).map(item => item.tool);
    expect(tools).toEqual(expect.arrayContaining(['product-planner', 'repair-loop', 'interference-check', 'assembly']));
  });
});
