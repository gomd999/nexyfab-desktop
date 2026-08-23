// Sibling module (not inside page.tsx) — Next.js Page files may only export the
// default component + a small allow-list (generateMetadata, etc). Exporting a
// helper straight from page.tsx fails `next build`'s TypeScript route-type
// check even though local `tsc --noEmit` doesn't catch it.
import type { NexyfabOrder } from '@/types/nexyfab-orders';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_STEPS = [
  { label: 'Placed',     labelKo: '주문 완료',  completedAt: Date.now() - 14 * 86400000 },
  { label: 'Production', labelKo: '생산 중',    estimatedAt: Date.now() - 5 * 86400000 },
  { label: 'QC',         labelKo: '품질 검사',  estimatedAt: Date.now() + 3 * 86400000 },
  { label: 'Shipped',    labelKo: '배송 중',    estimatedAt: Date.now() + 7 * 86400000 },
  { label: 'Delivered',  labelKo: '납품 완료',  estimatedAt: Date.now() + 12 * 86400000 },
];

const DEMO_ORDERS: NexyfabOrder[] = [
  {
    id: 'DEMO-001',
    rfqId: 'RFQ-DEMO-001',
    userId: 'demo',
    partName: '알루미늄 브라켓 A-100',
    manufacturerName: '대우정밀 주식회사',
    quantity: 500,
    totalPriceKRW: 4_500_000,
    totalPrice: 4_500_000,
    currency: 'KRW',
    status: 'production',
    steps: DEMO_STEPS,
    createdAt: Date.now() - 14 * 86400000,
    estimatedDeliveryAt: Date.now() + 12 * 86400000,
  },
  {
    id: 'DEMO-002',
    rfqId: 'RFQ-DEMO-002',
    userId: 'demo',
    partName: '스테인리스 플랜지 SUS304',
    manufacturerName: '한국정밀가공 협동조합',
    quantity: 200,
    totalPriceKRW: 2_800_000,
    totalPrice: 2_800_000,
    currency: 'KRW',
    status: 'qc',
    steps: DEMO_STEPS.map((s, i) => ({
      ...s,
      completedAt: i <= 2 ? Date.now() - (10 - i * 3) * 86400000 : undefined,
      estimatedAt: i > 2 ? Date.now() + i * 4 * 86400000 : undefined,
    })),
    createdAt: Date.now() - 22 * 86400000,
    estimatedDeliveryAt: Date.now() + 6 * 86400000,
  },
  {
    id: 'DEMO-003',
    rfqId: 'RFQ-DEMO-003',
    userId: 'demo',
    partName: 'CNC 선삭 축 φ25×300',
    manufacturerName: '삼성정밀 기계',
    quantity: 100,
    totalPriceKRW: 1_200_000,
    totalPrice: 1_200_000,
    currency: 'KRW',
    status: 'delivered',
    steps: DEMO_STEPS.map((s, i) => ({
      ...s,
      completedAt: Date.now() - (20 - i * 4) * 86400000,
      estimatedAt: undefined,
    })),
    createdAt: Date.now() - 35 * 86400000,
    estimatedDeliveryAt: Date.now() - 2 * 86400000,
  },
];

// DEMO_ORDERS above is authored in Korean; English display names for the same
// three demo rows (index-aligned) so non-Korean users don't see raw Korean
// product/manufacturer names in the fallback demo view.
const DEMO_ORDER_NAMES: Record<IsoLang, { partName: string; manufacturerName: string }[]> = {
  ko: DEMO_ORDERS.map(({ partName, manufacturerName }) => ({ partName, manufacturerName })),
  en: [
    { partName: 'Aluminum Bracket A-100', manufacturerName: 'Daewoo Precision Co., Ltd.' },
    { partName: 'Stainless Flange SUS304', manufacturerName: 'Korea Precision Machining Cooperative' },
    { partName: 'CNC Turned Shaft φ25×300', manufacturerName: 'Samsung Precision Machinery' },
  ],
  ja: [
    { partName: 'アルミブラケット A-100', manufacturerName: '大宇精密株式会社' },
    { partName: 'ステンレスフランジ SUS304', manufacturerName: '韓国精密加工協同組合' },
    { partName: 'CNC旋削シャフト φ25×300', manufacturerName: '三星精密機械' },
  ],
  zh: [
    { partName: '铝制支架 A-100', manufacturerName: '大宇精密株式会社' },
    { partName: '不锈钢法兰 SUS304', manufacturerName: '韩国精密加工合作社' },
    { partName: 'CNC 车削轴 φ25×300', manufacturerName: '三星精密机械' },
  ],
  es: [
    { partName: 'Soporte de aluminio A-100', manufacturerName: 'Daewoo Precision Co., Ltd.' },
    { partName: 'Brida inoxidable SUS304', manufacturerName: 'Korea Precision Machining Cooperative' },
    { partName: 'Eje torneado CNC φ25×300', manufacturerName: 'Samsung Precision Machinery' },
  ],
  ar: [
    { partName: 'حامل ألمنيوم A-100', manufacturerName: 'دايو للصناعات الدقيقة' },
    { partName: 'شفة فولاذ مقاوم للصدأ SUS304', manufacturerName: 'تعاونية كوريا للتشغيل الدقيق' },
    { partName: 'عمود مخروّط CNC ‏φ25×300', manufacturerName: 'سامسونغ للآلات الدقيقة' },
  ],
};

/** Unit suffix must follow the isKo branch: this used to append the Korean
 * word '원' unconditionally, so non-Korean users saw prices like "49,000원"
 * with no English rendering of the currency unit at all. */
export function fmtKRW(n: number, language: boolean | string): string {
  const iso = typeof language === 'boolean' ? (language ? 'ko' : 'en') : toIsoLang(language);
  const locale: Record<IsoLang, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', ar: 'ar-SA' };
  const value = new Intl.NumberFormat(locale[iso], { maximumFractionDigits: 0 }).format(n);
  const suffix: Record<IsoLang, string> = { ko: '원', en: ' KRW', ja: ' KRW', zh: ' 韩元', es: ' KRW', ar: ' وون كوري' };
  return value + suffix[iso];
}

export function getDemoOrders(language: boolean | string): NexyfabOrder[] {
  const iso = typeof language === 'boolean' ? (language ? 'ko' : 'en') : toIsoLang(language);
  if (iso === 'ko') return DEMO_ORDERS;
  const names = DEMO_ORDER_NAMES[iso];
  return DEMO_ORDERS.map((o, i) => ({
    ...o,
    partName: names[i]?.partName ?? o.partName,
    manufacturerName: names[i]?.manufacturerName ?? o.manufacturerName,
  }));
}
