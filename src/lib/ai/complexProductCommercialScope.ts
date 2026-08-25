import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export const COMPLEX_PRODUCT_COMMERCIAL_SCOPE = {
  schema: 'nexyfab.complex-product-commercial-scope.v1',
  channel: 'closed_beta',
  pilotEligible: true,
  broadSelfService: false,
  manufacturingReleaseGuaranteed: false,
  families: ['gearbox', 'machine_skid', 'welded_enclosure'],
  requiredGates: [
    'authoritative_requirements',
    'precision_cad_verification',
    'physical_validation',
    'expert_release_review',
  ],
} as const;

type ComplexScopeCopy = {
  badge: string;
  families: string;
  boundary: string;
  gates: readonly string[];
};

const COPY: Record<IsoLang, ComplexScopeCopy> = {
  ko: {
    badge: '복잡 제품 · 폐쇄형 베타',
    families: '파일럿 제품군: 기어박스, 기계·스키드, 용접 구조물·인클로저',
    boundary: '범용 셀프서비스와 제조 출시는 보장되지 않습니다. 검증이 끝나기 전 결과는 설계 후보입니다.',
    gates: ['권위 있는 요구사항', '정밀 CAD 검증', '실물 검증', '최종 전문가 승인'],
  },
  en: {
    badge: 'Complex product · Closed beta',
    families: 'Pilot families: gearbox, machine/skid, welded structure/enclosure',
    boundary: 'Broad self-service and manufacturing release are not guaranteed. Results remain design candidates until every gate passes.',
    gates: ['Authoritative requirements', 'Precision CAD verification', 'Physical validation', 'Final expert approval'],
  },
  ja: {
    badge: '複雑製品 · クローズドベータ',
    families: 'パイロット製品群: ギアボックス、機械/スキッド、溶接構造/筐体',
    boundary: '汎用セルフサービスと製造リリースは保証されません。すべてのゲート通過前は設計候補です。',
    gates: ['確定済み要件', 'Precision CAD 検証', '実物検証', '最終専門家承認'],
  },
  zh: {
    badge: '复杂产品 · 封闭测试',
    families: '试点产品族：齿轮箱、机器/滑橇、焊接结构/外壳',
    boundary: '不保证通用自助服务或制造发布。通过全部关卡前，结果仅为设计候选。',
    gates: ['权威需求', 'Precision CAD 验证', '实体验证', '最终专家批准'],
  },
  es: {
    badge: 'Producto complejo · Beta cerrada',
    families: 'Familias piloto: gearbox, máquina/skid y estructura/carcasa soldada',
    boundary: 'No se garantizan el autoservicio general ni la liberación para fabricación. El resultado sigue siendo candidato hasta superar todas las puertas.',
    gates: ['Requisitos autorizados', 'Verificación Precision CAD', 'Validación física', 'Aprobación experta final'],
  },
  ar: {
    badge: 'منتج معقد · إصدار تجريبي مغلق',
    families: 'العائلات التجريبية: علبة التروس، آلة/منصة، وهيكل/حاوية ملحومة',
    boundary: 'لا تُضمن الخدمة الذاتية العامة أو الإطلاق للتصنيع. تبقى النتائج مرشحات تصميم حتى اجتياز جميع البوابات.',
    gates: ['متطلبات موثوقة', 'تحقق Precision CAD', 'تحقق مادي', 'اعتماد خبير نهائي'],
  },
};

export function getComplexProductCommercialScopeCopy(locale: string | undefined | null): ComplexScopeCopy {
  return COPY[toIsoLang(locale)];
}
