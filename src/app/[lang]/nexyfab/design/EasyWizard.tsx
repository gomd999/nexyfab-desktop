'use client';

/**
 * 일반인 진입 위저드 (EasyWizard) — "마당에 6×3m 데크를 놓고 싶어요" 수준에서 출발해
 * 3~4 단계 질문만으로 **기존 어셈블리 템플릿 + 파라미터**까지 데려간다.
 *
 * 흐름: ① 분야 → ② 무엇을 만드나요(템플릿 카드) → ③ 크기·수량(핵심 2~4개) → ④ 확인·생성
 *
 * 배선(신규 API 없음 — AssemblyPresetPanel 과 완전히 동일한 경로):
 *   GET  /api/nexyfab/drawing/preset/?kind=assembly&domain=<slug>
 *        → { ok, templates: [{ domain, id, labelKo, labelEn, params: [{ name, labelKo, unit, default, min, max }] }] }
 *   POST /api/nexyfab/drawing/preset/  body { kind:'assembly', domain, templateId, params }
 *        → { ok, composeIntent, openscad, assembly, interferences, support, ... }
 *   결과는 onApply(composeIntent, openscad) + onBuildInfo({interferences, floating, assembly}) 로
 *   DesignInner 의 기존 어셈블리 수신 배선(applyDesign / pendingAssemblyRef)에 그대로 합류한다.
 *
 * 정직 원칙: 위저드는 사용자 입력을 임의로 보정하지 않는다. 범위를 벗어나면 min/max 를
 * 안내하고 생성 버튼을 잠근 채 사용자가 직접 고치게 한다(자동 clamp 금지).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loc } from '@/lib/i18n/loc';
import { isKorean } from '@/lib/i18n/normalize';
import { designList, designPair } from './designI18n';

// ─── API 응답 타입 (AssemblyPresetPanel.tsx 의 ParamSpec/Template 과 동일 형태) ──

interface ParamSpec { name: string; labelKo: string; labelEn?: string; unit: string; default: number; min: number; max: number }
interface Template { domain: string; id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface BuildResp {
  ok: boolean;
  assembly?: { name?: string; parts?: unknown[] };
  openscad?: string;
  composeIntent?: { name?: string; features?: unknown[] };
  interferences?: Array<{ a: string; b: string }>;
  support?: { floating?: string[] } | null;
  gateErrors?: string[];
  error?: string;
}

// ─── ① 분야 카드 — 일반인 어휘. slugs 는 실제 어셈블리 템플릿이 등록된 도메인 ────

interface Category {
  key: string;
  icon: string;
  /** 이 분야에서 불러올 preset API 도메인 slug(들). */
  slugs: string[];
  ko: string; en: string; ja: string; zh: string; es: string; ar: string;
  koDesc: string; enDesc: string; jaDesc: string; zhDesc: string; esDesc: string; arDesc: string;
}

const CATEGORIES: Category[] = [
  { key: 'landscape', icon: '🌳', slugs: ['landscape'], ko: '조경', en: 'Landscape', ja: 'ランドスケープ', zh: '园林', es: 'Paisajismo', ar: 'تنسيق المواقع', koDesc: '마당·정원·야외 시설', enDesc: 'Yards, gardens, outdoor structures', jaDesc: '庭・ガーデン・屋外施設', zhDesc: '庭院、花园、户外设施', esDesc: 'Patios, jardines y estructuras exteriores', arDesc: 'الأفنية والحدائق والمنشآت الخارجية' },
  { key: 'interior', icon: '🪑', slugs: ['interior'], ko: '인테리어', en: 'Interior', ja: 'インテリア', zh: '室内设计', es: 'Interiorismo', ar: 'التصميم الداخلي', koDesc: '집·가게 안의 공간 배치', enDesc: 'Room layouts for homes and shops', jaDesc: '住宅・店舗の空間レイアウト', zhDesc: '住宅与店铺的空间布局', esDesc: 'Distribución de espacios en viviendas y locales', arDesc: 'توزيع مساحات المنازل والمحال' },
  { key: 'building', icon: '🏢', slugs: ['building'], ko: '건축', en: 'Building', ja: '建築', zh: '建筑', es: 'Edificación', ar: 'البناء', koDesc: '집·건물의 뼈대와 지붕', enDesc: 'House and building frames, roofs', jaDesc: '住宅・建物の躯体と屋根', zhDesc: '住宅与建筑的框架和屋顶', esDesc: 'Estructuras y cubiertas de viviendas y edificios', arDesc: 'هياكل المنازل والمباني وأسقفها' },
  { key: 'civil', icon: '🌉', slugs: ['civil', 'bridge'], ko: '토목', en: 'Civil', ja: '土木', zh: '土木', es: 'Obra civil', ar: 'الهندسة المدنية', koDesc: '옹벽·다리 같은 바깥 구조물', enDesc: 'Retaining walls, bridges', jaDesc: '擁壁・橋などの屋外構造物', zhDesc: '挡土墙、桥梁等室外结构', esDesc: 'Muros de contención, puentes', arDesc: 'الجدران الاستنادية والجسور' },
  { key: 'mech', icon: '🔧', slugs: ['mech'], ko: '기계', en: 'Machinery', ja: '機械', zh: '机械', es: 'Maquinaria', ar: 'الميكانيكا', koDesc: '장비·탱크·기계 부품', enDesc: 'Equipment, tanks, machine parts', jaDesc: '装置・タンク・機械部品', zhDesc: '设备、储罐、机械零件', esDesc: 'Equipos, depósitos y piezas de máquina', arDesc: 'المعدات والخزانات وقطع الآلات' },
];

// ─── 템플릿 id → 쉬운 한 줄 설명(부제). 없으면 부제를 생략한다(허위 설명 금지) ──

interface EasyDesc { ko: string; en: string; ja: string; zh: string; es: string; ar: string }

// All category and description copy is defined in six locales and rendered through loc().
export const EASY_DESC: Record<string, EasyDesc> = {
  // 조경
  pergola: { ko: '기둥과 서까래로 만든 그늘막 — 마당·테라스에', en: 'Shade structure with posts and rafters for yards', ja: '柱と垂木で作った日除け — 庭・テラスに', zh: '立柱和椽条搭建的遮阳棚 — 适用于庭院、露台', es: 'Estructura de sombra con postes y vigas para patios y terrazas', ar: 'مظلة مصنوعة من أعمدة وعوارض — للأفنية والشرفات' },
  timber_deck: { ko: '나무 바닥 데크 — 마당·베란다에 까는 평상', en: 'Timber deck floor for a yard or balcony', ja: '木製の床デッキ — 庭やベランダに敷く床', zh: '木质地板露台 — 铺设于庭院或阳台', es: 'Suelo de terraza de madera para patio o balcón', ar: 'أرضية خشبية مرتفعة — تُركب في الفناء أو الشرفة' },
  // 인테리어
  apartment_unit: { ko: '아파트 한 세대 평면', en: 'A single apartment unit plan', ja: 'マンション一世帯分の平面図', zh: '一套公寓户型平面图', es: 'Plano de una unidad de apartamento', ar: 'مخطط وحدة سكنية واحدة في مبنى شقق' },
  studio_unit: { ko: '원룸 한 칸', en: 'A studio (one-room) unit', ja: 'ワンルーム一室', zh: '一间单间公寓', es: 'Una unidad tipo estudio (una habitación)', ar: 'وحدة استوديو (غرفة واحدة)' },
  three_room_unit: { ko: '방 세 개짜리 집 평면', en: 'A three-bedroom home plan', ja: '部屋が三つある家の平面図', zh: '三居室住宅平面图', es: 'Plano de una vivienda de tres dormitorios', ar: 'مخطط منزل من ثلاث غرف' },
  two_room: { ko: '방 두 개짜리 집 평면', en: 'A two-bedroom home plan', ja: '部屋が二つある家の平面図', zh: '两居室住宅平面图', es: 'Plano de una vivienda de dos dormitorios', ar: 'مخطط منزل من غرفتين' },
  cafe_room: { ko: '카페 홀 — 테이블·카운터 배치', en: 'Café floor with tables and a counter', ja: 'カフェのホール — テーブル・カウンター配置', zh: '咖啡厅大堂 — 桌椅与吧台布局', es: 'Sala de café con mesas y mostrador', ar: 'صالة مقهى — ترتيب الطاولات والكاونتر' },
  // 건축
  rc_frame: { ko: '콘크리트 기둥·보 뼈대', en: 'Concrete column and beam frame', ja: 'コンクリートの柱・梁の骨組み', zh: '混凝土柱梁框架', es: 'Estructura de columnas y vigas de hormigón', ar: 'هيكل من أعمدة وكمرات خرسانية' },
  steel_canopy: { ko: '철골 캐노피 — 주차장·출입구 지붕', en: 'Steel canopy roof for parking or entrances', ja: '鉄骨キャノピー — 駐車場・出入口の屋根', zh: '钢结构雨棚 — 停车场、出入口屋顶', es: 'Marquesina de acero para aparcamientos o entradas', ar: 'مظلة فولاذية — لسقف مواقف السيارات أو المداخل' },
  gable_house: { ko: '박공지붕 주택 — 흔한 삼각지붕 집', en: 'Gable-roof house', ja: '切妻屋根の住宅 — よくある三角屋根の家', zh: '人字形屋顶住宅 — 常见的三角屋顶房屋', es: 'Vivienda con tejado a dos aguas (el típico techo triangular)', ar: 'منزل بسقف جملوني — السقف المثلثي الشائع' },
  industrial_stair: { ko: '철제 계단', en: 'Industrial steel stair', ja: '鉄製階段', zh: '钢制楼梯', es: 'Escalera industrial de acero', ar: 'درج فولاذي صناعي' },
  elevator_shaft: { ko: '엘리베이터 통로', en: 'Elevator shaft', ja: 'エレベーターシャフト', zh: '电梯井', es: 'Hueco de ascensor', ar: 'بئر المصعد' },
  duct_run: { ko: '환기 덕트 배관', en: 'Ventilation duct run', ja: '換気ダクト配管', zh: '通风管道', es: 'Tramo de conducto de ventilación', ar: 'مسار مجرى تهوية' },
  commercial_massing: { ko: '상가 건물 덩어리(매스)', en: 'Commercial building massing', ja: '商業ビルのマッシング(全体形状)', zh: '商业建筑体量(整体造型)', es: 'Volumetría de un edificio comercial', ar: 'الكتلة الحجمية لمبنى تجاري' },
  // 토목
  retaining_wall_run: { ko: '흙을 받쳐주는 옹벽 한 구간', en: 'A run of retaining wall holding back soil', ja: '土を支える擁壁の一区間', zh: '支撑土体的挡土墙一段', es: 'Tramo de muro de contención que sostiene tierra', ar: 'امتداد من الجدار الاستنادي لدعم التربة' },
  retaining_wall_alignment: { ko: '길을 따라 꺾이는 옹벽', en: 'Retaining wall following an alignment', ja: '道に沿って曲がる擁壁', zh: '沿道路走向弯折的挡土墙', es: 'Muro de contención que sigue una alineación', ar: 'جدار استنادي يتبع محاذاة الطريق' },
  girder_bridge: { ko: '가장 흔한 형태의 거더 다리', en: 'The most common girder bridge', ja: '最も一般的な形の桁橋', zh: '最常见的梁桥', es: 'El tipo de puente de vigas más común', ar: 'أكثر أنواع الجسور الجائزية شيوعًا' },
  arch_bridge: { ko: '아치 모양 다리', en: 'Arch bridge', ja: 'アーチ橋', zh: '拱桥', es: 'Puente de arco', ar: 'جسر مقوس' },
  cable_stayed_bridge: { ko: '사장교 — 탑에서 케이블로 잡아주는 다리', en: 'Cable-stayed bridge', ja: '斜張橋 — 塔からケーブルで支える橋', zh: '斜拉桥 — 由桥塔通过缆索拉住的桥梁', es: 'Puente atirantado, sostenido por cables desde una torre', ar: 'جسر مشدود بالكابلات من أبراج' },
  suspension_bridge: { ko: '현수교 — 케이블에 매달린 다리', en: 'Suspension bridge', ja: '吊り橋 — ケーブルに吊るされた橋', zh: '悬索桥 — 由缆索悬挂的桥梁', es: 'Puente colgante, suspendido de cables', ar: 'جسر معلق بالكابلات' },
  truss_bridge: { ko: '삼각 뼈대(트러스) 다리', en: 'Truss bridge', ja: '三角骨組み(トラス)橋', zh: '三角桁架桥', es: 'Puente de celosía (estructura triangular)', ar: 'جسر جملوني (هيكل مثلثي)' },
  // 기계
  tank_silo: { ko: '저장 탱크·사일로', en: 'Storage tank or silo', ja: '貯蔵タンク・サイロ', zh: '储罐、筒仓', es: 'Tanque de almacenamiento o silo', ar: 'خزان تخزين أو صومعة' },
  pressure_vessel: { ko: '압력용기', en: 'Pressure vessel', ja: '圧力容器', zh: '压力容器', es: 'Recipiente a presión', ar: 'وعاء ضغط' },
  pump_unit: { ko: '펌프 유닛', en: 'Pump unit', ja: 'ポンプユニット', zh: '泵组', es: 'Unidad de bombeo', ar: 'وحدة مضخة' },
  gate_valve: { ko: '게이트 밸브', en: 'Gate valve', ja: 'ゲートバルブ', zh: '闸阀', es: 'Válvula de compuerta', ar: 'صمام بوابة' },
  flanged_fitting: { ko: '플랜지 배관 이음', en: 'Flanged pipe fitting', ja: 'フランジ配管継手', zh: '法兰管道接头', es: 'Conexión de tubería embridada', ar: 'وصلة أنابيب مفلنجة' },
  heat_exchanger: { ko: '열교환기', en: 'Heat exchanger', ja: '熱交換器', zh: '热交换器', es: 'Intercambiador de calor', ar: 'مبادل حراري' },
  conveyor: { ko: '컨베이어', en: 'Conveyor', ja: 'コンベヤ', zh: '输送机', es: 'Cinta transportadora', ar: 'ناقل حزامي' },
  machine_line: { ko: '기계 생산 라인', en: 'Machine production line', ja: '機械生産ライン', zh: '机械生产线', es: 'Línea de producción de maquinaria', ar: 'خط إنتاج آلي' },
  robot_arm: { ko: '로봇 팔', en: 'Robot arm', ja: 'ロボットアーム', zh: '机械臂', es: 'Brazo robótico', ar: 'ذراع روبوتية' },
  gear_train: { ko: '기어 열', en: 'Gear train', ja: '歯車列', zh: '齿轮系', es: 'Tren de engranajes', ar: 'مجموعة تروس' },
  four_bar: { ko: '4절 링크 기구', en: 'Four-bar linkage', ja: '四節リンク機構', zh: '四连杆机构', es: 'Mecanismo de cuatro barras', ar: 'آلية رباعية القضبان' },
  mold_cavity: { ko: '금형 캐비티', en: 'Mold cavity', ja: '金型キャビティ', zh: '模具型腔', es: 'Cavidad de molde', ar: 'تجويف القالب' },
  propeller: { ko: '프로펠러', en: 'Propeller', ja: 'プロペラ', zh: '螺旋桨', es: 'Hélice', ar: 'مروحة دافعة' },
  tower_crane: { ko: '타워 크레인', en: 'Tower crane', ja: 'タワークレーン', zh: '塔式起重机', es: 'Grúa torre', ar: 'رافعة برجية' },
  transmission_tower: { ko: '송전탑', en: 'Transmission tower', ja: '送電塔', zh: '输电塔', es: 'Torre de transmisión eléctrica', ar: 'برج نقل الكهرباء' },
  excavator_bucket: { ko: '굴착기 버킷', en: 'Excavator bucket', ja: '掘削機バケット', zh: '挖掘机铲斗', es: 'Cucharón de excavadora', ar: 'دلو حفارة' },
};

// ─── 단위 표기 헬퍼: 표시만 m/개로 바꾸고 **전송값은 원 단위(mm 등) 유지** ──────

/** mm 파라미터 중 큰 치수(최대 2 m 이상)는 m 로 보여준다 — 일반인 가독성. */
function showsMeters(p: ParamSpec): boolean {
  return p.unit === 'mm' && p.max >= 2000;
}

function unitLabel(p: ParamSpec, lang: string): string {
  if (showsMeters(p)) return 'm';
  if (p.unit === '') return designPair(lang, '개', 'ea');
  return p.unit;
}

/** 원 단위 숫자 → 표시 문자열 */
function toDisp(p: ParamSpec, v: number): string {
  const d = showsMeters(p) ? v / 1000 : v;
  return String(Math.round(d * 1000) / 1000);
}

/** 표시 문자열 → 원 단위 숫자 (파싱 실패 시 null) */
function fromDisp(p: ParamSpec, s: string): number | null {
  const n = Number.parseFloat(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return showsMeters(p) ? n * 1000 : n;
}

// ─── 핵심 파라미터 선별: 크기·수량류를 우선 2~4개만 노출 ──────────────────────

const KEY_STRONG = /^(width|depth|height|length|span|w|d|h|l)$/i;
const KEY_WEAK = /(width|depth|height|length|span|count|rows?|cols?|num|qty|floors?|stor(y|ies)|bay)/i;

function pickKeyParams(params: ParamSpec[]): ParamSpec[] {
  const scored = params.map((p, i) => ({
    p, i,
    score: KEY_STRONG.test(p.name) ? 2 : KEY_WEAK.test(p.name) ? 1 : 0,
  }));
  const picked = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .slice(0, 4)
    .map((s) => s.p);
  if (picked.length >= 2) return picked;
  // 이름으로 못 고르면 앞에서부터(템플릿 정의 순서 = 대표 치수 순서)
  return params.slice(0, Math.min(3, params.length));
}

// ─── 스타일 관용구 (DesignInner 톤) ───────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '11px 12px', borderRadius: 9,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)',
  color: 'var(--nx-text, #1a2230)', cursor: 'pointer',
};
const primaryBtn: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 8, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'var(--nx-text-2, #46505e)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
};
const inputStyle: React.CSSProperties = {
  width: 110, padding: '7px 9px', borderRadius: 7, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', fontSize: 13,
};

export default function EasyWizard({
  lang,
  open,
  onClose,
  onApply,
  onBuildInfo,
}: {
  lang: string;
  open: boolean;
  onClose: () => void;
  /** AssemblyPresetPanel 과 동일한 시그니처 — DesignInner 의 applyDesign 으로 이어진다. */
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string) => void | Promise<void>;
  /** 빌드 결과 요약 — DesignInner 의 pendingAssemblyRef/검증 그물 배선과 동일. */
  onBuildInfo?: (info: { interferences: number; floating?: number | null; assembly?: Record<string, unknown> | null }) => void;
}) {
  const ko = isKorean(lang);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [cat, setCat] = useState<Category | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  /** 원 단위(mm 등) 확정값 */
  const [vals, setVals] = useState<Record<string, number>>({});
  /** 입력 중 표시 문자열 — 소수점 타이핑이 반올림에 잘려나가지 않게 분리 보관 */
  const [typing, setTyping] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildErr, setBuildErr] = useState<string | null>(null);

  // 분야 선택 → 해당 도메인 템플릿 목록 로드(기존 GET 경로 그대로)
  useEffect(() => {
    if (!cat) return;
    let alive = true;
    setTemplates(null); setLoadErr(null);
    Promise.all(
      cat.slugs.map((slug) =>
        fetch(`/api/nexyfab/drawing/preset/?kind=assembly&domain=${encodeURIComponent(slug)}`)
          .then((r) => r.json())
          .then((d: { ok: boolean; templates?: Template[] }) => (d.ok && d.templates ? d.templates : [])),
      ),
    )
      .then((lists) => {
        if (!alive) return;
        const merged = lists.flat();
        if (!merged.length) { setLoadErr(designPair(lang, '이 분야의 템플릿을 불러오지 못했습니다.', 'Could not load templates for this field.')); return; }
        setTemplates(merged);
      })
      .catch((e: unknown) => {
        if (!alive) return;
      setLoadErr(designPair(lang, '불러오기 실패: ', 'Load failed: ') + (e instanceof Error ? e.message : String(e)));
      });
    return () => { alive = false; };
  }, [cat, ko]);

  const keyParams = useMemo(() => (tpl ? pickKeyParams(tpl.params) : []), [tpl]);
  const keyNames = useMemo(() => new Set(keyParams.map((p) => p.name)), [keyParams]);

  // 범위 검사 — 자동 보정 없이 위반 목록만 만든다(정직 원칙)
  const violations = useMemo(() => {
    if (!tpl) return [] as Array<{ p: ParamSpec; kind: 'nan' | 'range' }>;
    const out: Array<{ p: ParamSpec; kind: 'nan' | 'range' }> = [];
    for (const p of tpl.params) {
      const raw = typing[p.name];
      if (raw !== undefined && fromDisp(p, raw) === null) { out.push({ p, kind: 'nan' }); continue; }
      const v = vals[p.name];
      if (!Number.isFinite(v)) { out.push({ p, kind: 'nan' }); continue; }
      if (v < p.min || v > p.max) out.push({ p, kind: 'range' });
    }
    return out;
  }, [tpl, vals, typing]);

  const chooseTemplate = useCallback((t: Template) => {
    setTpl(t);
    setVals(Object.fromEntries(t.params.map((p) => [p.name, p.default])));
    setTyping({});
    setAdvanced(false);
    setBuildErr(null);
    setStep(3);
  }, []);

  const setParam = useCallback((p: ParamSpec, text: string) => {
    setTyping((prev) => ({ ...prev, [p.name]: text }));
    const n = fromDisp(p, text);
    if (n !== null) setVals((prev) => ({ ...prev, [p.name]: n }));
  }, []);

  // ④ 생성 — AssemblyPresetPanel.generate 와 동일한 POST 계약
  const build = useCallback(async () => {
    if (!tpl || violations.length) return;
    setBusy(true); setBuildErr(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'assembly', domain: tpl.domain, templateId: tpl.id, params: vals }),
      });
      const data = (await res.json()) as BuildResp;
      if (data.ok && data.composeIntent && data.openscad) {
        onBuildInfo?.({
          interferences: data.interferences?.length ?? 0,
          floating: data.support?.floating?.length ?? null,
          assembly: (data as { assembly?: Record<string, unknown> }).assembly ?? null,
        });
        await onApply(data.composeIntent, data.openscad);
        onClose();
        return;
      }
      setBuildErr(designPair(lang, '만들지 못했습니다: ', 'Could not build: ') + (data.gateErrors?.join('; ') ?? data.error ?? ''));
    } catch (e) {
      setBuildErr(designPair(lang, '만들지 못했습니다: ', 'Could not build: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [tpl, vals, violations.length, onApply, onBuildInfo, onClose, ko]);

  if (!open) return null;

  const stepTitles = designList(lang, {
    ko: ['어떤 분야인가요?', '무엇을 만드나요?', '크기·수량을 정해주세요', '이대로 만들까요?'],
    en: ['Which field?', 'What do you want to make?', 'Set the size & count', 'Ready to build?'],
    ja: ['分野を選択', '何を作りますか？', 'サイズと数量を設定', 'この内容で作成しますか？'],
    zh: ['选择领域', '要制作什么？', '设置尺寸和数量', '按此内容创建？'],
    es: ['¿Qué campo?', '¿Qué quieres fabricar?', 'Define tamaño y cantidad', '¿Listo para construir?'],
    ar: ['ما المجال؟', 'ماذا تريد أن تصنع؟', 'حدد الحجم والكمية', 'هل أنت جاهز للبناء؟'],
  });

  // 파라미터 입력 한 줄
  const renderParam = (p: ParamSpec) => {
    const bad = violations.find((v) => v.p.name === p.name) ?? null;
    const shown = typing[p.name] ?? toDisp(p, vals[p.name] ?? p.default);
    return (
      <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', fontSize: 13, color: 'var(--nx-text, #1a2230)' }}>{designPair(lang, p.labelKo, p.labelEn ?? p.labelKo)}</div>
        <input
          value={shown}
          inputMode="decimal"
          onChange={(e) => setParam(p, e.target.value)}
          style={{ ...inputStyle, borderColor: bad ? '#ef4444' : 'var(--nx-border, #dfe3e8)' }}
        />
        <div style={{ width: 26, fontSize: 12, color: 'var(--nx-text-3, #6b7684)' }}>{unitLabel(p, lang)}</div>
        <div style={{ flexBasis: '100%', fontSize: 11, color: bad ? '#ef4444' : 'var(--nx-text-3, #6b7684)' }}>
          {bad
            ? designPair(lang, `${toDisp(p, p.min)} ~ ${toDisp(p, p.max)} ${unitLabel(p, lang)} 사이의 값을 입력해 주세요.`, `Enter a value between ${toDisp(p, p.min)} and ${toDisp(p, p.max)} ${unitLabel(p, lang)}.`)
            : designPair(lang, `가능 범위 ${toDisp(p, p.min)} ~ ${toDisp(p, p.max)} ${unitLabel(p, lang)}`, `Allowed ${toDisp(p, p.min)} – ${toDisp(p, p.max)} ${unitLabel(p, lang)}`)}
        </div>
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(15,23,42,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '100%', maxWidth: 620, maxHeight: '88vh', overflowY: 'auto', borderRadius: 14,
        background: 'var(--nx-panel, #fff)', border: '1px solid var(--nx-border, #dfe3e8)',
        color: 'var(--nx-text, #1a2230)', padding: 18, boxSizing: 'border-box',
      }}>
        {/* 헤더 — 단계 표시 + 닫기 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nx-accent, #2563eb)' }}>
              {designPair(lang, `쉬운 설계 · ${step}/4단계`, `Easy design · step ${step}/4`)}
            </div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>{stepTitles[step - 1]}</div>
          </div>
          <button type="button" onClick={onClose} aria-label={designPair(lang, '닫기', 'Close')}
            style={{ ...ghostBtn, padding: '6px 11px' }}>✕</button>
        </div>

        {/* 단계 진행 바 */}
        <div style={{ display: 'flex', gap: 4, margin: '12px 0 14px' }}>
          {[1, 2, 3, 4].map((s) => (
            <div key={s} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: s <= step ? 'var(--nx-accent, #2563eb)' : 'var(--nx-border, #dfe3e8)',
            }} />
          ))}
        </div>

        {/* ① 분야 */}
        {step === 1 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {CATEGORIES.map((c) => (
              <button key={c.key} type="button" style={cardStyle}
                onClick={() => { setCat(c); setTpl(null); setStep(2); }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{c.icon}</span>
                  <span>
                    {/* Category and template labels are localized through the shared helper. */}
                    <span style={{ fontWeight: 700, fontSize: 14 }}>{loc(lang, c)}</span>
                    <span style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)' }}> — {loc(lang, { ko: c.koDesc, en: c.enDesc, ja: c.jaDesc, zh: c.zhDesc, es: c.esDesc, ar: c.arDesc })}</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ② 템플릿 */}
        {step === 2 && (
          <div>
            {loadErr && <div style={{ fontSize: 12.5, color: '#ef4444', marginBottom: 8 }}>{loadErr}</div>}
            {!templates && !loadErr && (
              <div style={{ fontSize: 12.5, color: 'var(--nx-text-3, #6b7684)' }}>{designPair(lang, '불러오는 중…', 'Loading…')}</div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              {templates?.map((t) => {
                const desc = EASY_DESC[t.id];
                return (
                  <button key={`${t.domain}/${t.id}`} type="button" style={cardStyle} onClick={() => chooseTemplate(t)}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{designPair(lang, t.labelKo, t.labelEn)}</div>
                    {desc && (
                      <div style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)', marginTop: 3 }}>{loc(lang, desc)}</div>
                    )}
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 14 }}>
              <button type="button" style={ghostBtn} onClick={() => setStep(1)}>{designPair(lang, '← 이전', '← Back')}</button>
            </div>
          </div>
        )}

        {/* ③ 크기·수량 */}
        {step === 3 && tpl && (
          <div>
            <div style={{ fontSize: 12.5, color: 'var(--nx-text-3, #6b7684)', marginBottom: 6 }}>
              {designPair(lang, `${tpl.labelKo} — 아래 값만 정하면 됩니다. 나머지는 기본값을 사용합니다.`, `${tpl.labelEn} — set these values; the rest use defaults.`)}
            </div>
            {keyParams.map(renderParam)}

            {tpl.params.length > keyParams.length && (
              <div style={{ marginTop: 10, borderTop: '1px solid var(--nx-border, #dfe3e8)', paddingTop: 10 }}>
                <button type="button" style={ghostBtn} onClick={() => setAdvanced((v) => !v)}>
                  {advanced
                    ? designPair(lang, '고급 설정 접기', 'Hide advanced')
                    : designPair(lang, `고급 설정 펼치기 (나머지 ${tpl.params.length - keyParams.length}개)`, `Show advanced (${tpl.params.length - keyParams.length} more)`)}
                </button>
                {advanced && (
                  <div style={{ marginTop: 8 }}>
                    {tpl.params.filter((p) => !keyNames.has(p.name)).map(renderParam)}
                  </div>
                )}
              </div>
            )}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button type="button" style={ghostBtn} onClick={() => setStep(2)}>{designPair(lang, '← 이전', '← Back')}</button>
              <button type="button" style={{ ...primaryBtn, opacity: violations.length ? 0.5 : 1, cursor: violations.length ? 'not-allowed' : 'pointer' }}
                disabled={violations.length > 0} onClick={() => setStep(4)}>
                {designPair(lang, '다음 →', 'Next →')}
              </button>
            </div>
            {violations.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#ef4444' }}>
                {designPair(lang, '범위를 벗어난 값이 있습니다 — 위 안내대로 직접 고쳐주세요(자동으로 바꾸지 않습니다).', 'Some values are out of range — please fix them yourself (nothing is auto-adjusted).')}
              </div>
            )}
          </div>
        )}

        {/* ④ 확인 */}
        {step === 4 && tpl && cat && (
          <div>
            <div style={{ border: '1px solid var(--nx-border, #dfe3e8)', borderRadius: 9, padding: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)' }}>
                {cat.icon} {loc(lang, cat)}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, margin: '3px 0 8px' }}>{designPair(lang, tpl.labelKo, tpl.labelEn)}</div>
              {keyParams.map((p) => (
                <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '3px 0' }}>
                  <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{p.labelKo}</span>
                  <span style={{ fontWeight: 700 }}>{toDisp(p, vals[p.name] ?? p.default)} {unitLabel(p, lang)}</span>
                </div>
              ))}
              {tpl.params.length > keyParams.length && (
                <div style={{ fontSize: 11.5, color: 'var(--nx-text-3, #6b7684)', marginTop: 6 }}>
                  {designPair(lang, `나머지 ${tpl.params.length - keyParams.length}개 값은 템플릿 기본값 또는 입력한 고급 설정값을 사용합니다.`, `The other ${tpl.params.length - keyParams.length} values use template defaults or your advanced entries.`)}
                </div>
              )}
            </div>

            {buildErr && <div style={{ marginTop: 10, fontSize: 12.5, color: '#ef4444', whiteSpace: 'pre-wrap' }}>{buildErr}</div>}

            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button type="button" style={ghostBtn} disabled={busy} onClick={() => setStep(3)}>{designPair(lang, '← 수정', '← Edit')}</button>
              <button type="button" style={{ ...primaryBtn, cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1 }}
                disabled={busy} onClick={() => void build()}>
                {busy ? designPair(lang, '만드는 중…', 'Building…') : designPair(lang, '이대로 만들기', 'Build it')}
              </button>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--nx-text-3, #6b7684)' }}>
              {designPair(lang, '만든 뒤에도 오른쪽 화면에서 치수를 바로 고칠 수 있습니다.', 'You can keep adjusting dimensions in the studio after building.')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
