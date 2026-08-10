import type { DesignDomainId } from './domainProfile';

export type DomainJourneyStageId = 'requirements' | 'ai_build' | 'manual_refine' | 'precision_verify' | 'deliver';

export interface DomainUserJourney {
  domain: DesignDomainId;
  title: string;
  focus: string;
  example: string;
  stages: readonly { id: DomainJourneyStageId; label: string }[];
  exactInputs: readonly string[];
  validations: readonly string[];
  deliverables: readonly string[];
}

type LocalizedJourney = Omit<DomainUserJourney, 'domain' | 'stages'>;
type JourneyLocale = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const STAGES = {
  ko: [
    { id: 'requirements', label: '요구사항' },
    { id: 'ai_build', label: 'AI 구현' },
    { id: 'manual_refine', label: '수동 조정(선택)' },
    { id: 'precision_verify', label: '정밀 검증' },
    { id: 'deliver', label: '도면·산출물' },
  ],
  en: [
    { id: 'requirements', label: 'Requirements' },
    { id: 'ai_build', label: 'AI build' },
    { id: 'manual_refine', label: 'Manual refine (optional)' },
    { id: 'precision_verify', label: 'Precision verify' },
    { id: 'deliver', label: 'Documents & delivery' },
  ],
  ja: [
    { id: 'requirements', label: '要件' }, { id: 'ai_build', label: 'AI構築' },
    { id: 'manual_refine', label: '手動調整（任意）' }, { id: 'precision_verify', label: '精密検証' },
    { id: 'deliver', label: '図面・成果物' },
  ],
  zh: [
    { id: 'requirements', label: '需求' }, { id: 'ai_build', label: 'AI生成' },
    { id: 'manual_refine', label: '手动调整（可选）' }, { id: 'precision_verify', label: '精密验证' },
    { id: 'deliver', label: '图纸与交付' },
  ],
  es: [
    { id: 'requirements', label: 'Requisitos' }, { id: 'ai_build', label: 'Generación con IA' },
    { id: 'manual_refine', label: 'Ajuste manual (opcional)' }, { id: 'precision_verify', label: 'Verificación precisa' },
    { id: 'deliver', label: 'Planos y entrega' },
  ],
  ar: [
    { id: 'requirements', label: 'المتطلبات' }, { id: 'ai_build', label: 'الإنشاء بالذكاء الاصطناعي' },
    { id: 'manual_refine', label: 'الضبط اليدوي (اختياري)' }, { id: 'precision_verify', label: 'التحقق الدقيق' },
    { id: 'deliver', label: 'الرسومات والتسليم' },
  ],
} as const satisfies Record<JourneyLocale, readonly { id: DomainJourneyStageId; label: string }[]>;

const JOURNEYS: Record<DesignDomainId, Record<'ko' | 'en', LocalizedJourney>> = {
  mechanical: {
    ko: { title: '기계·제품', focus: '부품·조립·동작·제조', example: '가로 300mm 알루미늄 브래킷, 두께 8mm, 볼트홀 4개', exactInputs: ['핵심 치수·공차', '재료·제조 공정', '하중·동작 조건'], validations: ['B-rep 형상', '조립 자유도·간섭', '공차·DFM'], deliverables: ['STEP', '제작도면', 'BOM'] },
    en: { title: 'Mechanical product', focus: 'Parts, assemblies, motion and manufacturing', example: 'a 300 mm aluminium bracket, 8 mm thick, with four bolt holes', exactInputs: ['Critical dimensions & tolerances', 'Material & process', 'Loads & motion'], validations: ['B-rep geometry', 'Assembly DOF & collision', 'Tolerance & DFM'], deliverables: ['STEP', 'Manufacturing drawing', 'BOM'] },
  },
  building: {
    ko: { title: '건축', focus: '대지·층·공간·개구부·BIM', example: '대지 20×30m, 3층 근린생활시설, 층고 3.6m', exactInputs: ['대지 좌표·기준고', '층·면적 프로그램', '피난·접근성 기준'], validations: ['공간 폐합', '호스트·개구부', '피난·MEP 조정'], deliverables: ['IFC', '평·입·단면도', '수량표'] },
    en: { title: 'Building', focus: 'Site, storeys, spaces, openings and BIM', example: 'a three-storey neighborhood facility on a 20×30 m site, 3.6 m floor height', exactInputs: ['Site coordinates & datum', 'Storeys & area program', 'Egress & accessibility basis'], validations: ['Space closure', 'Hosts & openings', 'Egress & MEP coordination'], deliverables: ['IFC', 'Plans/elevations/sections', 'Schedules'] },
  },
  civil: {
    ko: { title: '토목', focus: '측량·지형·선형·배수·시공단계', example: '연장 500m 진입도로, 폭 7m, 종단구배 6% 이하', exactInputs: ['좌표계·측량 기준점', '현황 지표면', '선형·배수 설계기준'], validations: ['측량 폐합·지표면', '선형·종단·횡단', '토공·배수'], deliverables: ['LandXML·IFC', '종횡단 도면', '토공·배수 수량'] },
    en: { title: 'Civil', focus: 'Survey, terrain, alignment, drainage and stages', example: 'a 500 m access road, 7 m wide, maximum 6% grade', exactInputs: ['CRS & survey control', 'Existing surface', 'Alignment & drainage criteria'], validations: ['Survey & surface quality', 'Alignment/profile/sections', 'Earthwork & drainage'], deliverables: ['LandXML/IFC', 'Profile & section drawings', 'Earthwork/drainage quantities'] },
  },
  landscape: {
    ko: { title: '조경', focus: '지형·식재·포장·관수·유지관리', example: '마당 6×3m 데크와 교목 3주, 우수 배수 포함', exactInputs: ['현황 지형·경계', '수종·성숙 크기·토심', '구배·배수·급수 조건'], validations: ['지형 구배·표면수', '식재 간격·토량', '관수 압력·일람표'], deliverables: ['조경 모델', '식재·포장·관수도', 'BOQ·유지관리표'] },
    en: { title: 'Landscape', focus: 'Terrain, planting, hardscape, irrigation and maintenance', example: 'a 6×3 m garden deck with three trees and storm drainage', exactInputs: ['Existing terrain & boundary', 'Plant mature size & soil', 'Grading, drainage & water'], validations: ['Grading & surface flow', 'Plant clearance & soil volume', 'Irrigation & schedules'], deliverables: ['Landscape model', 'Planting/hardscape/irrigation plans', 'BOQ & maintenance plan'] },
  },
  interior: {
    ko: { title: '인테리어', focus: '실측·동선·가구·천장·마감', example: '8×6m 카페, 4인 테이블 6개와 서비스 카운터', exactInputs: ['현장 실측·건축 기준 모델', '사용자·동선 프로그램', '가구·마감·천장·설비 사양'], validations: ['공간·문 회전·피난', '가구 활동 여유', '천장·MEP·조명 간섭'], deliverables: ['인테리어 모델', '배치·천장·입면도', '마감·FF&E·BOQ'] },
    en: { title: 'Interior', focus: 'Field measure, circulation, furniture, ceiling and finishes', example: 'an 8×6 m cafe with six four-seat tables and a service counter', exactInputs: ['Field measure & host model', 'Users & circulation program', 'Furniture, finish, ceiling & MEP specs'], validations: ['Space, door swing & egress', 'Furniture clearance', 'Ceiling, MEP & lighting'], deliverables: ['Interior model', 'Layout/ceiling/elevation drawings', 'Finish/FF&E schedules & BOQ'] },
  },
};

const TRANSLATED_JOURNEYS: Record<Exclude<JourneyLocale, 'ko' | 'en'>, Record<DesignDomainId, LocalizedJourney>> = {
  ja: {
    mechanical: { title: '機械・製品', focus: '部品、組立、動作、製造', example: '幅300 mm、厚さ8 mm、ボルト穴4個のアルミブラケット', exactInputs: ['主要寸法・公差', '材料・製造工程', '荷重・動作条件'], validations: ['B-rep形状', '組立自由度・干渉', '公差・DFM'], deliverables: ['STEP', '製作図', 'BOM'] },
    building: { title: '建築', focus: '敷地、階、空間、開口、BIM', example: '20×30 mの敷地に階高3.6 mの3階建て施設', exactInputs: ['敷地座標・基準高', '階・面積プログラム', '避難・アクセシビリティ基準'], validations: ['空間閉鎖', 'ホスト・開口', '避難・MEP調整'], deliverables: ['IFC', '平面・立面・断面図', '集計表'] },
    civil: { title: '土木', focus: '測量、地形、線形、排水、施工段階', example: '延長500 m、幅7 m、最大縦断勾配6%の進入道路', exactInputs: ['座標系・測量基準点', '現況地表面', '線形・排水設計基準'], validations: ['測量・地表面品質', '線形・縦断・横断', '土工・排水'], deliverables: ['LandXML/IFC', '縦横断図', '土工・排水数量'] },
    landscape: { title: 'ランドスケープ', focus: '地形、植栽、舗装、灌水、維持管理', example: '6×3 mのデッキ、樹木3本、雨水排水を含む庭', exactInputs: ['現況地形・境界', '樹種・成長寸法・土壌', '勾配・排水・給水条件'], validations: ['造成勾配・表面流', '植栽間隔・土壌量', '灌水・集計表'], deliverables: ['ランドスケープモデル', '植栽・舗装・灌水図', 'BOQ・維持管理表'] },
    interior: { title: 'インテリア', focus: '実測、動線、家具、天井、仕上げ', example: '8×6 mのカフェ、4人席6卓とサービスカウンター', exactInputs: ['現場実測・建築基準モデル', '利用者・動線プログラム', '家具・仕上げ・天井・設備仕様'], validations: ['空間・扉回転・避難', '家具の活動余裕', '天井・MEP・照明干渉'], deliverables: ['インテリアモデル', '配置・天井・展開図', '仕上げ・FF&E・BOQ'] },
  },
  zh: {
    mechanical: { title: '机械与产品', focus: '零件、装配、运动与制造', example: '宽300 mm、厚8 mm、带4个螺栓孔的铝支架', exactInputs: ['关键尺寸与公差', '材料与制造工艺', '载荷与运动条件'], validations: ['B-rep几何', '装配自由度与干涉', '公差与DFM'], deliverables: ['STEP', '制造图', 'BOM'] },
    building: { title: '建筑', focus: '场地、楼层、空间、洞口与BIM', example: '20×30 m场地上的三层设施，层高3.6 m', exactInputs: ['场地坐标与基准标高', '楼层与面积任务书', '疏散与无障碍依据'], validations: ['空间闭合', '主体与洞口', '疏散与MEP协调'], deliverables: ['IFC', '平立剖图', '明细表'] },
    civil: { title: '土木', focus: '测量、地形、线形、排水与施工阶段', example: '长500 m、宽7 m、最大纵坡6%的进场道路', exactInputs: ['坐标系与测量控制', '现状地表', '线形与排水标准'], validations: ['测量与地表质量', '线形、纵断面与横断面', '土方与排水'], deliverables: ['LandXML/IFC', '纵横断面图', '土方与排水工程量'] },
    landscape: { title: '景观', focus: '地形、种植、铺装、灌溉与养护', example: '6×3 m平台、3棵乔木并含雨水排水的庭院', exactInputs: ['现状地形与边界', '植物成熟尺寸与土壤', '坡度、排水与供水条件'], validations: ['场地坡度与地表径流', '植物间距与土量', '灌溉与明细表'], deliverables: ['景观模型', '种植、铺装与灌溉图', 'BOQ与养护表'] },
    interior: { title: '室内', focus: '现场测量、流线、家具、天花与饰面', example: '8×6 m咖啡馆，6张四人桌及服务台', exactInputs: ['现场测量与建筑基准模型', '用户与流线任务书', '家具、饰面、天花与机电规格'], validations: ['空间、门扇与疏散', '家具使用净距', '天花、MEP与照明碰撞'], deliverables: ['室内模型', '平面、天花与立面图', '饰面、FF&E与BOQ'] },
  },
  es: {
    mechanical: { title: 'Mecánica y producto', focus: 'Piezas, conjuntos, movimiento y fabricación', example: 'soporte de aluminio de 300 mm, espesor 8 mm y cuatro taladros', exactInputs: ['Dimensiones y tolerancias críticas', 'Material y proceso', 'Cargas y movimiento'], validations: ['Geometría B-rep', 'Grados de libertad e interferencias', 'Tolerancias y DFM'], deliverables: ['STEP', 'Plano de fabricación', 'BOM'] },
    building: { title: 'Arquitectura', focus: 'Parcela, plantas, espacios, huecos y BIM', example: 'edificio de tres plantas en parcela de 20×30 m y altura de 3,6 m', exactInputs: ['Coordenadas y cota de referencia', 'Programa de plantas y superficies', 'Criterios de evacuación y accesibilidad'], validations: ['Cierre de espacios', 'Anfitriones y huecos', 'Evacuación y coordinación MEP'], deliverables: ['IFC', 'Plantas, alzados y secciones', 'Cuadros'] },
    civil: { title: 'Ingeniería civil', focus: 'Topografía, terreno, trazado, drenaje y fases', example: 'vial de acceso de 500 m, ancho 7 m y pendiente máxima 6%', exactInputs: ['CRS y control topográfico', 'Superficie existente', 'Criterios de trazado y drenaje'], validations: ['Calidad topográfica y de superficie', 'Trazado, perfil y secciones', 'Movimiento de tierras y drenaje'], deliverables: ['LandXML/IFC', 'Planos de perfil y secciones', 'Mediciones de tierras y drenaje'] },
    landscape: { title: 'Paisajismo', focus: 'Terreno, plantación, pavimentos, riego y mantenimiento', example: 'terraza de 6×3 m con tres árboles y drenaje pluvial', exactInputs: ['Terreno y límites existentes', 'Tamaño adulto y suelo de las plantas', 'Pendientes, drenaje y agua'], validations: ['Pendientes y escorrentía', 'Separación y volumen de suelo', 'Riego y cuadros'], deliverables: ['Modelo de paisaje', 'Planos de plantación, pavimento y riego', 'BOQ y mantenimiento'] },
    interior: { title: 'Interiorismo', focus: 'Levantamiento, circulación, mobiliario, techo y acabados', example: 'cafetería de 8×6 m con seis mesas de cuatro plazas y mostrador', exactInputs: ['Levantamiento y modelo base', 'Usuarios y programa de circulación', 'Mobiliario, acabados, techo y MEP'], validations: ['Espacio, giro de puertas y evacuación', 'Holguras de mobiliario', 'Interferencias de techo, MEP e iluminación'], deliverables: ['Modelo interior', 'Planos de distribución, techo y alzados', 'Cuadros de acabados, FF&E y BOQ'] },
  },
  ar: {
    mechanical: { title: 'الميكانيكا والمنتجات', focus: 'الأجزاء والتجميع والحركة والتصنيع', example: 'حامل ألمنيوم بعرض 300 مم وسماكة 8 مم وأربع فتحات تثبيت', exactInputs: ['الأبعاد والتفاوتات الحرجة', 'المادة وعملية التصنيع', 'الأحمال والحركة'], validations: ['هندسة B-rep', 'درجات حرية التجميع والتداخل', 'التفاوتات وقابلية التصنيع'], deliverables: ['STEP', 'رسم التصنيع', 'BOM'] },
    building: { title: 'العمارة', focus: 'الموقع والطوابق والفراغات والفتحات وBIM', example: 'مبنى من ثلاثة طوابق على موقع 20×30 م بارتفاع طابق 3.6 م', exactInputs: ['إحداثيات الموقع والمنسوب المرجعي', 'برنامج الطوابق والمساحات', 'أساس الإخلاء وإتاحة الوصول'], validations: ['إغلاق الفراغات', 'العناصر المضيفة والفتحات', 'تنسيق الإخلاء وMEP'], deliverables: ['IFC', 'المساقط والواجهات والقطاعات', 'الجداول'] },
    civil: { title: 'الهندسة المدنية', focus: 'المساحة والتضاريس والمسار والتصريف والمراحل', example: 'طريق وصول بطول 500 م وعرض 7 م وميل أقصى 6%', exactInputs: ['نظام الإحداثيات وضبط المساحة', 'السطح القائم', 'معايير المسار والتصريف'], validations: ['جودة المساحة والسطح', 'المسار والقطاع الطولي والعرضي', 'الأعمال الترابية والتصريف'], deliverables: ['LandXML/IFC', 'رسومات القطاعات', 'كميات الحفر والتصريف'] },
    landscape: { title: 'تصميم المناظر الطبيعية', focus: 'التضاريس والزراعة والرصف والري والصيانة', example: 'سطح حديقة 6×3 م مع ثلاث أشجار وتصريف لمياه الأمطار', exactInputs: ['التضاريس والحدود القائمة', 'حجم النبات الناضج والتربة', 'الميول والتصريف والمياه'], validations: ['التسوية والجريان السطحي', 'تباعد النباتات وحجم التربة', 'الري والجداول'], deliverables: ['نموذج المناظر الطبيعية', 'مخططات الزراعة والرصف والري', 'جدول الكميات والصيانة'] },
    interior: { title: 'التصميم الداخلي', focus: 'الرفع الميداني والحركة والأثاث والسقف والتشطيبات', example: 'مقهى 8×6 م بست طاولات لأربعة أشخاص ومنضدة خدمة', exactInputs: ['الرفع الميداني والنموذج المعماري المرجعي', 'المستخدمون وبرنامج الحركة', 'مواصفات الأثاث والتشطيب والسقف وMEP'], validations: ['الفراغ وفتح الأبواب والإخلاء', 'خلوص استخدام الأثاث', 'تداخل السقف وMEP والإضاءة'], deliverables: ['النموذج الداخلي', 'مخططات التوزيع والسقف والواجهات', 'جداول التشطيبات وFF&E وBOQ'] },
  },
};

function journeyLocale(lang: string): JourneyLocale {
  if (lang === 'ko' || lang === 'kr') return 'ko';
  if (lang === 'ja' || lang === 'es' || lang === 'ar') return lang;
  if (lang === 'zh' || lang === 'cn') return 'zh';
  return 'en';
}

export function getDomainUserJourney(domain: DesignDomainId, lang: string): DomainUserJourney {
  const locale = journeyLocale(lang);
  const journey = locale === 'ko' || locale === 'en' ? JOURNEYS[domain][locale] : TRANSLATED_JOURNEYS[locale][domain];
  return { domain, stages: STAGES[locale], ...journey };
}

export function designDomainFromSlug(value: string | null | undefined): DesignDomainId {
  if (value === 'bridge') return 'civil';
  if (value === 'building' || value === 'civil' || value === 'landscape' || value === 'interior') return value;
  return 'mechanical';
}

export function precisionCadHref(lang: string, domain: DesignDomainId): string {
  const query = new URLSearchParams({
    expert: '1',
    mode: 'expert',
    entry: '3d-edit',
    domain,
    experience: 'expert',
    workMode: 'precision_cad',
  });
  return `/${lang}/shape-generator?${query.toString()}`;
}
