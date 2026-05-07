/**
 * materialMapping.ts — library/materials.ts ID → MATERIAL_PRESETS ID
 *
 * library/materials.ts (제조 카탈로그) 와 shape-generator/materials.ts (3D 시각화 + FEA 프리셋)
 * 는 별도 ID 공간을 사용. compose 결과를 기존 funnel(DFM/견적/시각화) 에 흘려보내려면
 * 아래 매핑이 필요.
 */

export const COMPOSE_TO_PRESET: Record<string, string> = {
  // 알루미늄 계열 → 'aluminum'
  'al-6061': 'aluminum',
  'al-7075': 'aluminum',

  // 강철 / 스테인리스 → 'steel'
  'steel-1045': 'steel',
  'stainless-304': 'steel',
  'stainless-316': 'steel',

  // 티타늄
  'titanium-g5': 'titanium',

  // 구리 / 황동
  'copper': 'copper',
  'brass': 'copper',

  // 플라스틱
  'pla': 'abs_white',
  'abs': 'abs_black',
  'petg': 'abs_white',
  'nylon-pa12': 'nylon',
  'peek': 'nylon',
  'acrylic': 'glass',

  // 복합/세라믹
  'cfrp': 'nylon',
  'alumina': 'ceramic',
};

export function mapToPresetId(composeMaterialId: string): string | undefined {
  return COMPOSE_TO_PRESET[composeMaterialId];
}
