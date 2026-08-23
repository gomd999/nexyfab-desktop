import type { MechanicalVocabularyHit } from './mechanicalVocabulary';

export type CadToolSelection = {
  tool: 'scad' | 'assembly' | 'product-planner' | 'repair-loop' | 'mate-repair' | 'interference-check' | 'drawing-bom';
  reason: string;
  confidence: number;
};

/** Deterministic native-tool routing; the model may explain, but cannot override an explicit check request. */
export function selectCadTools(message: string, hits: MechanicalVocabularyHit[]): CadToolSelection[] {
  const text = message.toLocaleLowerCase();
  const out: CadToolSelection[] = [];
  const add = (tool: CadToolSelection['tool'], reason: string, confidence: number) => {
    if (!out.some(item => item.tool === tool)) out.push({ tool, reason, confidence });
  };
  if (/간섭|충돌|interference|collision|clearance/i.test(text)) add('interference-check', 'explicit interference/clearance request', 0.99);
  if (/mate|메이트|구속|정렬|align|축|shaft/i.test(text) || hits.some(hit => hit.canonical === 'mate' || hit.canonical === 'shaft')) add('mate-repair', 'mate, axis or alignment vocabulary', 0.9);
  if (/도면|bom|부품표|drawing|manufactur/i.test(text)) add('drawing-bom', 'drawing/BOM/manufacturing output request', 0.95);
  if (/구체화|refine|expand|복잡|complex|system|제품 구조|product structure/i.test(text)) add('product-planner', 'complex-product decomposition and hierarchy planning', 0.9);
  if (/수정|고쳐|repair|fix|간섭 해결|refine|재생성/i.test(text)) add('repair-loop', 'iterative CAD repair with preserved intent', 0.9);
  if (hits.some(hit => hit.category === 'assembly') || /조립|assembly|system|엔진/i.test(text)) add('assembly', 'multi-part or system vocabulary', 0.93);
  if (out.some(item => item.tool === 'product-planner')) add('assembly', 'complex product plans compile to an assembly', 0.93);
  if (!out.length || hits.some(hit => hit.category === 'part' || hit.category === 'feature')) add('scad', 'single-part or feature geometry', 0.85);
  return out;
}
