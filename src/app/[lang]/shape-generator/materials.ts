export type MaterialUseCase =
  | 'outdoor'
  | 'structural'
  | 'food_contact'
  | 'electrical_insulation'
  | 'lightweight'
  | 'prototype_3dp';

export interface MaterialPreset {
  id: string;
  name: { ko: string; en: string };
  color: string;
  roughness: number;
  metalness: number;
  envMapIntensity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  opacity?: number;
  transparent?: boolean;
  // Physical / mechanical properties (for FEA)
  youngsModulus?: number;  // GPa
  poissonRatio?: number;
  yieldStrength?: number;  // MPa
  density?: number;        // g/cm³
  // Use-case tags — drives the "용도별 추천" picker for non-experts.
  useCases?: MaterialUseCase[];
}

export const MATERIAL_PRESETS: MaterialPreset[] = [
  { id: 'aluminum', name: { ko: '알루미늄', en: 'Aluminum' }, color: '#b0b8c8', roughness: 0.3, metalness: 0.85, youngsModulus: 69, poissonRatio: 0.33, yieldStrength: 276, density: 2.7, useCases: ['outdoor', 'structural', 'lightweight'] },
  { id: 'steel', name: { ko: '스틸', en: 'Steel' }, color: '#8a929e', roughness: 0.2, metalness: 0.9, youngsModulus: 200, poissonRatio: 0.3, yieldStrength: 250, density: 7.85, useCases: ['structural', 'food_contact'] },
  { id: 'titanium', name: { ko: '티타늄', en: 'Titanium' }, color: '#a0a8b4', roughness: 0.25, metalness: 0.88, youngsModulus: 116, poissonRatio: 0.34, yieldStrength: 880, density: 4.43, useCases: ['outdoor', 'structural', 'food_contact'] },
  { id: 'copper', name: { ko: '구리', en: 'Copper' }, color: '#b87333', roughness: 0.3, metalness: 0.9, youngsModulus: 117, poissonRatio: 0.34, yieldStrength: 210, density: 8.96 },
  { id: 'gold', name: { ko: '금', en: 'Gold' }, color: '#ffd700', roughness: 0.15, metalness: 0.95, youngsModulus: 79, poissonRatio: 0.44, yieldStrength: 205, density: 19.3 },
  { id: 'abs_white', name: { ko: 'ABS (흰색)', en: 'ABS (White)' }, color: '#f0ede8', roughness: 0.7, metalness: 0.0, youngsModulus: 2.3, poissonRatio: 0.35, yieldStrength: 40, density: 1.05, useCases: ['electrical_insulation', 'lightweight', 'prototype_3dp'] },
  { id: 'abs_black', name: { ko: 'ABS (검정)', en: 'ABS (Black)' }, color: '#2a2a2a', roughness: 0.6, metalness: 0.0, youngsModulus: 2.3, poissonRatio: 0.35, yieldStrength: 40, density: 1.05, useCases: ['electrical_insulation', 'lightweight', 'prototype_3dp'] },
  { id: 'nylon', name: { ko: '나일론', en: 'Nylon' }, color: '#d4d0c8', roughness: 0.8, metalness: 0.0, youngsModulus: 2.7, poissonRatio: 0.39, yieldStrength: 70, density: 1.14, useCases: ['electrical_insulation', 'lightweight', 'prototype_3dp'] },
  { id: 'glass', name: { ko: '유리', en: 'Glass' }, color: '#88ccff', roughness: 0.05, metalness: 0.1, opacity: 0.3, transparent: true, youngsModulus: 70, poissonRatio: 0.22, yieldStrength: 33, density: 2.5, useCases: ['food_contact', 'electrical_insulation'] },
  { id: 'rubber', name: { ko: '고무', en: 'Rubber' }, color: '#333333', roughness: 0.95, metalness: 0.0, youngsModulus: 0.05, poissonRatio: 0.49, yieldStrength: 15, density: 1.2, useCases: ['electrical_insulation'] },
  { id: 'wood', name: { ko: '나무', en: 'Wood' }, color: '#8B6914', roughness: 0.85, metalness: 0.0, youngsModulus: 12, poissonRatio: 0.35, yieldStrength: 40, density: 0.6, useCases: ['lightweight', 'electrical_insulation'] },
  { id: 'ceramic', name: { ko: '세라믹', en: 'Ceramic' }, color: '#f5f5f0', roughness: 0.4, metalness: 0.05, youngsModulus: 300, poissonRatio: 0.22, yieldStrength: 250, density: 3.9, useCases: ['food_contact', 'electrical_insulation'] },
];

export interface UseCaseDef {
  id: MaterialUseCase;
  label: { ko: string; en: string };
  icon: string;
  hint: { ko: string; en: string };
}

export const USE_CASE_DEFS: UseCaseDef[] = [
  { id: 'outdoor',               label: { ko: '야외',       en: 'Outdoor'    }, icon: '☀️', hint: { ko: '부식·UV 저항',          en: 'Corrosion / UV resistant' } },
  { id: 'structural',            label: { ko: '구조',       en: 'Structural' }, icon: '🏗️', hint: { ko: '하중 지지',              en: 'Load-bearing' } },
  { id: 'food_contact',          label: { ko: '식품접촉',   en: 'Food-safe'  }, icon: '🍽️', hint: { ko: '무독·매끈한 표면',       en: 'Non-toxic, smooth' } },
  { id: 'electrical_insulation', label: { ko: '전기절연',   en: 'Insulator'  }, icon: '⚡', hint: { ko: '비전도성',                en: 'Non-conductive' } },
  { id: 'lightweight',           label: { ko: '경량',       en: 'Lightweight'}, icon: '🪶', hint: { ko: '저밀도',                  en: 'Low density' } },
  { id: 'prototype_3dp',         label: { ko: '3D 프린팅',  en: '3D Print'   }, icon: '🖨️', hint: { ko: '빠른 시제품',             en: 'Rapid prototype' } },
];

export function getMaterialsForUseCase(useCase: MaterialUseCase): MaterialPreset[] {
  return MATERIAL_PRESETS.filter(m => m.useCases?.includes(useCase));
}

export function getMaterialPreset(id: string): MaterialPreset | undefined {
  return MATERIAL_PRESETS.find(m => m.id === id);
}
