/**
 * /examples — 예시 갤러리 (29축 P, 2026-07-16).
 * 전 분야 10종 결정론 파이프라인 산출물: 카드(분야·핵심 수치·검증 요약) →
 * [3D 보기]=자립형 GA 뷰어(조정 패널 v2) · [스튜디오에서 만들기]=해당 분야 프리필.
 * 정직: 모든 수치는 빌드·검증 엔진 실측값(매니페스트는 생성 시점 산출) — 마케팅 수치 없음.
 */
import type { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import manifest from './manifest.json';

export async function generateMetadata(
  { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
  const { lang } = await params;
  return buildMetadata(lang, 'nexyfab');
}

interface Example {
  slug: string; domain: string; studioDomain: string; icon: string;
  titleKo: string; titleEn: string; descKo: string; descEn: string;
  stats: { parts: number | null; areaM2: number | null; massKg: number | null; manifold: boolean | null; interferences: number | null; egressM?: number; egressPass?: boolean };
}

const DOMAIN_COLOR: Record<string, string> = {
  mech: '#3b82f6', rack: '#6366f1', civil: '#0ea5e9', bridge: '#0891b2',
  building: '#8b5cf6', landscape: '#22c55e', interior: '#f59e0b',
};

const COPY: Record<IsoLang, {
  title: string; description: string; parts: string; noClash: string; egress: string;
  view3d: string; makeYours: string; disclaimer: string;
}> = {
  ko: { title: '예시 갤러리 — 기계부터 인테리어·교량까지', description: '모든 예시는 NexyFab 결정론 파이프라인 산출물입니다(AI 형상 생성 없음). 수치는 빌드·검증 엔진 실측값이며 3D는 브라우저에서 바로 열립니다.', parts: '부품', noClash: '간섭 0', egress: '피난', view3d: '3D 보기', makeYours: '직접 만들기 →', disclaimer: 'AI 응답·산출물은 비법정 참고자료입니다. 최종 검토·서명은 유자격 기술자의 책임입니다.' },
  en: { title: 'Example gallery — mechanical to interiors & bridges', description: 'All examples are produced by the NexyFab deterministic pipeline without AI-generated geometry. Figures are engine-measured and 3D opens in your browser.', parts: 'parts', noClash: 'no clash', egress: 'egress', view3d: 'View 3D', makeYours: 'Make yours →', disclaimer: 'Outputs are non-statutory references; final review and sign-off are the responsibility of a qualified engineer.' },
  ja: { title: '作例ギャラリー — 機械からインテリア・橋梁まで', description: 'すべてNexyFabの決定論的パイプラインによる成果物です（AI形状生成なし）。数値は検証エンジンの実測値で、3Dはブラウザで開けます。', parts: '部品', noClash: '干渉 0', egress: '避難', view3d: '3Dを見る', makeYours: '自分で作る →', disclaimer: 'AIの応答・成果物は法定資料ではありません。最終確認と承認は有資格技術者の責任です。' },
  zh: { title: '示例库 — 从机械到室内与桥梁', description: '所有示例均由 NexyFab 确定性管线生成（不使用 AI 生成几何体）。数值来自验证引擎实测，3D 可直接在浏览器中打开。', parts: '零件', noClash: '无干涉', egress: '疏散', view3d: '查看 3D', makeYours: '自行创建 →', disclaimer: 'AI 回复和输出仅供非规范性参考；最终审核与签署由具备资质的工程师负责。' },
  es: { title: 'Galería de ejemplos — mecánica, interiores y puentes', description: 'Todos los ejemplos proceden del flujo determinista de NexyFab, sin geometría generada por IA. Las cifras son mediciones del motor y el 3D se abre en el navegador.', parts: 'piezas', noClash: 'sin interferencias', egress: 'evacuación', view3d: 'Ver 3D', makeYours: 'Crear el suyo →', disclaimer: 'Las respuestas y los resultados de IA son referencias no reglamentarias; la revisión y aprobación final corresponden a un técnico cualificado.' },
  ar: { title: 'معرض الأمثلة — من الميكانيكا إلى التصميم الداخلي والجسور', description: 'أُنتجت جميع الأمثلة عبر مسار NexyFab الحتمي من دون إنشاء هندسة بالذكاء الاصطناعي. الأرقام مقاسة بمحرك التحقق ويمكن فتح العرض ثلاثي الأبعاد في المتصفح.', parts: 'أجزاء', noClash: 'بلا تداخل', egress: 'إخلاء', view3d: 'عرض ثلاثي الأبعاد', makeYours: 'أنشئ تصميمك ←', disclaimer: 'ردود الذكاء الاصطناعي ومخرجاته مراجع غير نظامية؛ والمراجعة والاعتماد النهائيان مسؤولية مهندس مؤهل.' },
};

type TranslatedExample = { title: string; description: string };
type GalleryLocale = Exclude<IsoLang, 'ko' | 'en'>;

const ITEM_COPY: Record<string, Record<GalleryLocale, TranslatedExample>> = {
  'mech-tank': {
    ja: { title: '機械 — 水タンク', description: '円筒容器プリセット・常時マニフォールド検証' }, zh: { title: '机械 — 水箱', description: '圆柱容器预设与持续流形验证' }, es: { title: 'Mecánica — Depósito de agua', description: 'Preajuste de recipiente cilíndrico y verificación continua de variedad' }, ar: { title: 'ميكانيكا — خزان مياه', description: 'إعداد مسبق لوعاء أسطواني مع تحقق مستمر من سلامة المجسم' },
  },
  'rack-portal': {
    ja: { title: '架台・ラック — 門型フレーム', description: '複数部材の門型フレームプリセット' }, zh: { title: '机架 — 门式框架', description: '多构件门式框架预设' }, es: { title: 'Bastidor — Pórtico', description: 'Preajuste de pórtico con varios elementos' }, ar: { title: 'حامل — إطار بوابي', description: 'إعداد إطار بوابي متعدد العناصر' },
  },
  'civil-wall': {
    ja: { title: '土木 — 擁壁延長', description: '擁壁アセンブリとKDS安定性チェック' }, zh: { title: '土木 — 挡土墙', description: '挡土墙装配与 KDS 稳定性检查' }, es: { title: 'Obra civil — Muro de contención', description: 'Conjunto de muro de contención y comprobaciones de estabilidad KDS' }, ar: { title: 'مدني — جدار استنادي', description: 'تجميع جدار استنادي وفحوص ثبات KDS' },
  },
  'bridge-girder': {
    ja: { title: '橋梁 — 桁橋', description: '桁橋とKL-510活荷重解析' }, zh: { title: '桥梁 — 梁桥', description: '梁桥与 KL-510 活载分析' }, es: { title: 'Puente — Puente de vigas', description: 'Puente de vigas y análisis de carga viva KL-510' }, ar: { title: 'جسر — جسر عوارض', description: 'جسر عوارض وتحليل الحمل الحي KL-510' },
  },
  'building-rc': {
    ja: { title: '建築 — RCフレーム', description: 'RCフレームと荷重経路の検証チェーン' }, zh: { title: '建筑 — 钢筋混凝土框架', description: '钢筋混凝土框架与荷载路径验证链' }, es: { title: 'Edificio — Pórtico de hormigón', description: 'Pórtico de hormigón y cadena de verificación de cargas' }, ar: { title: 'مبنى — إطار خرسانة مسلحة', description: 'إطار خرسانة مسلحة وسلسلة تحقق من مسار الأحمال' },
  },
  'landscape-pergola': {
    ja: { title: 'ランドスケープ — 木製パーゴラ', description: 'パーゴラの部材・風荷重チェック' }, zh: { title: '景观 — 木质凉亭', description: '凉亭构件与风荷载检查' }, es: { title: 'Paisajismo — Pérgola', description: 'Comprobaciones de elementos y carga de viento' }, ar: { title: 'مناظر طبيعية — عريشة', description: 'فحوص العناصر وأحمال الرياح للعريشة' },
  },
  'interior-studio': {
    ja: { title: 'インテリア — ワンルーム', description: 'ワンルーム住戸と避難距離チェック' }, zh: { title: '室内 — 单间公寓', description: '单间公寓与疏散距离检查' }, es: { title: 'Interior — Estudio', description: 'Vivienda tipo estudio y comprobación de evacuación' }, ar: { title: 'داخلي — شقة استوديو', description: 'وحدة استوديو وفحص مسافة الإخلاء' },
  },
  'interior-apartment': {
    ja: { title: 'インテリア — 2LDK住戸', description: '2寝室・LDK・浴室と避難チェック' }, zh: { title: '室内 — 两居室公寓', description: '两卧室、客餐厨、浴室与疏散检查' }, es: { title: 'Interior — Apartamento de 2 dormitorios', description: 'Dos dormitorios, salón-comedor-cocina, baño y evacuación' }, ar: { title: 'داخلي — شقة بغرفتي نوم', description: 'غرفتا نوم ومعيشة ومطبخ وحمام وفحص إخلاء' },
  },
  'interior-three': {
    ja: { title: 'インテリア — 3ルーム', description: '3ルーム住戸と避難チェック' }, zh: { title: '室内 — 三居室', description: '三居室与疏散检查' }, es: { title: 'Interior — Vivienda de 3 habitaciones', description: 'Tres habitaciones y comprobación de evacuación' }, ar: { title: 'داخلي — ثلاث غرف', description: 'وحدة من ثلاث غرف وفحص الإخلاء' },
  },
  'interior-cafe': {
    ja: { title: 'インテリア — カフェ', description: 'カフェのレイアウト・避難・座席検証' }, zh: { title: '室内 — 咖啡馆', description: '咖啡馆布局、疏散与座位检查' }, es: { title: 'Interior — Cafetería', description: 'Distribución de cafetería, evacuación y asientos' }, ar: { title: 'داخلي — مقهى', description: 'تخطيط مقهى وفحص الإخلاء والمقاعد' },
  },
};

export default async function ExamplesPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const locale = toIsoLang(lang);
  const copy = COPY[locale];
  const items = manifest as Example[];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '96px 20px 60px', fontFamily: "'Segoe UI',sans-serif" }}>
      <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
        {copy.title}
      </h1>
      <p style={{ fontSize: 14, color: '#5a6875', margin: '0 0 26px', lineHeight: 1.6 }}>
        {copy.description}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: 16 }}>
        {items.map((ex) => {
          const item = locale === 'ko'
            ? { title: ex.titleKo, description: ex.descKo }
            : locale === 'en'
              ? { title: ex.titleEn, description: ex.descEn }
              : ITEM_COPY[ex.slug]?.[locale] ?? { title: ex.titleEn, description: ex.descEn };
          const c = DOMAIN_COLOR[ex.domain] ?? '#64748b';
          const s = ex.stats;
          const chips: string[] = [];
          if (s.parts) chips.push(`${copy.parts} ${s.parts}`);
          if (s.areaM2) chips.push(s.areaM2 + '㎡');
          if (s.massKg) chips.push((s.massKg >= 1000 ? (s.massKg / 1000).toFixed(1) + 't' : Math.round(s.massKg) + 'kg'));
          if (s.manifold === true) chips.push('manifold ✓');
          if (s.interferences === 0) chips.push(copy.noClash);
          if (typeof s.egressM === 'number') chips.push(`${copy.egress} ${s.egressM}m${s.egressPass ? ' ✓' : ''}`);
          return (
            <div key={ex.slug} style={{ border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', background: '#fff', display: 'flex', flexDirection: 'column' }}>
              <div style={{ height: 8, background: c }} />
              <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                  <span aria-hidden style={{ marginRight: 7 }}>{ex.icon}</span>{item.title}
                </div>
                <div style={{ fontSize: 12, color: '#5a6875', lineHeight: 1.55, marginBottom: 10 }}>{item.description}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                  {chips.map((ch) => (
                    <span key={ch} style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: '#f1f5f9', color: '#334155', fontVariantNumeric: 'tabular-nums' }}>{ch}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                  <a href={`/examples/${ex.slug}/GA_3D.html`} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, background: c, color: '#fff', fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                    🧊 {copy.view3d}
                  </a>
                  <a href={`/${lang}/nexyfab/design/?domain=${ex.studioDomain}`}
                    style={{ flex: 1, textAlign: 'center', padding: '9px 0', borderRadius: 9, border: `1.5px solid ${c}`, color: c, fontSize: 12.5, fontWeight: 800, textDecoration: 'none' }}>
                    {copy.makeYours}
                  </a>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ marginTop: 26, fontSize: 11, color: '#94a3b8' }}>
        {copy.disclaimer}
      </p>
    </div>
  );
}
