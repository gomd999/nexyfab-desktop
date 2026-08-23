import type { IconName } from '../Icons';
import { loc } from '@/lib/i18n/loc';

export interface SpatialHubEntry {
  id: 'building' | 'civil' | 'landscape' | 'interior' | 'coordination';
  icon: IconName;
  label: string;
  description: string;
  href: string;
  evidence: 'SEMANTIC_EDIT' | 'BOUNDS_PREVIEW';
}

export function spatialHubEntries(lang: string): SpatialHubEntry[] {
  const modeler = (domain: SpatialHubEntry['id'], extra = '') =>
    `/${lang}/shape-generator?expert=1&domain=${domain === 'coordination' ? 'building' : domain}&experience=standard&workMode=precision_cad${extra}`;

  return [
    {
      id: 'building', icon: 'cube', label: loc(lang, { ko: '건축 공간', en: 'Building & Space', ja: '建築空間', zh: '建筑空间', es: 'Edificación y espacio', ar: 'المباني والمساحات' }),
      description: loc(lang, { ko: '그리드·레벨·벽·개구부 의미 모델', en: 'Semantic grids, levels, walls and openings', ja: 'グリッド・レベル・壁・開口部のセマンティックモデル', zh: '网格、标高、墙体和洞口的语义模型', es: 'Modelo semántico de ejes, niveles, muros y aberturas', ar: 'نموذج دلالي للمحاور والمناسيب والجدران والفتحات' }),
      href: modeler('building'), evidence: 'SEMANTIC_EDIT',
    },
    {
      id: 'civil', icon: 'branch', label: loc(lang, { ko: '토목 인프라', en: 'Civil Infrastructure', ja: '土木インフラ', zh: '土木基础设施', es: 'Infraestructura civil', ar: 'البنية التحتية المدنية' }),
      description: loc(lang, { ko: '선형·종단·횡단·배수 계획', en: 'Alignment, profile, section and drainage planning', ja: '線形・縦断・横断・排水計画', zh: '路线、纵断面、横断面和排水规划', es: 'Planificación de alineación, perfil, sección y drenaje', ar: 'تخطيط المحاور والمقاطع الطولية والعرضية والصرف' }),
      href: modeler('civil'), evidence: 'SEMANTIC_EDIT',
    },
    {
      id: 'landscape', icon: 'globe', label: loc(lang, { ko: '조경·대지', en: 'Landscape & Site', ja: 'ランドスケープ・敷地', zh: '景观与场地', es: 'Paisajismo y emplazamiento', ar: 'تنسيق الموقع والأرض' }),
      description: loc(lang, { ko: '대지·구배·식재·관수 구역', en: 'Site, grading, planting and irrigation zones', ja: '敷地・造成・植栽・灌水ゾーン', zh: '场地、坡度、种植和灌溉分区', es: 'Emplazamiento, nivelación, plantación y zonas de riego', ar: 'الموقع والتسوية والزراعة ومناطق الري' }),
      href: modeler('landscape'), evidence: 'SEMANTIC_EDIT',
    },
    {
      id: 'interior', icon: 'sketch', label: loc(lang, { ko: '인테리어', en: 'Interior', ja: 'インテリア', zh: '室内设计', es: 'Interior', ar: 'التصميم الداخلي' }),
      description: loc(lang, { ko: '공간·가구·마감·문 여유 검토', en: 'Rooms, furniture, finishes and door clearance', ja: '室内・家具・仕上げ・扉クリアランスの確認', zh: '房间、家具、饰面和门净空检查', es: 'Revisión de espacios, mobiliario, acabados y holgura de puertas', ar: 'مراجعة الغرف والأثاث والتشطيبات وخلوص الأبواب' }),
      href: modeler('interior'), evidence: 'SEMANTIC_EDIT',
    },
    {
      id: 'coordination', icon: 'combine', label: loc(lang, { ko: '통합 조정', en: 'Federated Coordination', ja: '統合調整', zh: '联合协调', es: 'Coordinación federada', ar: 'التنسيق الموحد' }),
      description: loc(lang, { ko: '좌표 정합·경계 상자 간섭 후보', en: 'Coordinate alignment and bounds clash candidates', ja: '座標整合と境界ボックス干渉候補', zh: '坐标对齐和边界框碰撞候选', es: 'Alineación de coordenadas y posibles colisiones de límites', ar: 'محاذاة الإحداثيات واحتمالات تعارض الحدود' }),
      href: modeler('coordination', '&workspace=coordination'), evidence: 'BOUNDS_PREVIEW',
    },
  ];
}
