/**
 * Per-shape usage hints — shown as a tooltip when the user hovers a
 * shape card in the gallery. Helps newcomers pick the right starter
 * without having to drop into the shape and read its parameter list.
 *
 * Why a separate file (vs adding `usageHint` to ShapeConfig):
 *   - Avoids touching ~30 shape definition files every time we want to
 *     refine copy.
 *   - Lets us keep the dict tightly translated in 6 languages with no
 *     drift between them — adding a new shape just appends a row here.
 *
 * Falls back to a category-level hint when a specific shape isn't listed.
 */

import { getShapeCategory, type ShapeCategory } from './categories';

type LangKey = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
const langMap: Record<string, LangKey> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// Keep entries terse — the tooltip width is ~220px. One sentence per language.
// Keys must match real `SHAPES` ids (see `shapes/index.ts`). Unknown ids use
// CATEGORY_FALLBACK from `categories.ts`.
const SHAPE_HINTS: Partial<Record<string, Record<LangKey, string>>> = {
  box: {
    ko: '직육면체. 인클로저, 마운트 플레이트의 기본.',
    en: 'Cuboid. Default starter for enclosures or mount plates.',
    ja: '直方体。エンクロージャやマウント板の基本。',
    zh: '长方体。外壳或安装板的常用基础。',
    es: 'Cuboide. Base para carcasas o placas de montaje.',
    ar: 'متوازي مستطيلات. أساس للحاويات وألواح التركيب.',
  },
  cylinder: {
    ko: '실린더. 축, 보스, 레그.',
    en: 'Cylinder. Shafts, bosses, legs.',
    ja: 'シリンダー。シャフト、ボス、脚。',
    zh: '圆柱。轴、凸台、支腿。',
    es: 'Cilindro. Ejes, bujes, patas.',
    ar: 'أسطوانة. أعمدة وارتفاعات وأرجل.',
  },
  pipe: {
    ko: '파이프 — 외경/내경 분리. 유체, 케이블 트레이.',
    en: 'Pipe — separate inner/outer diameters. Fluids, cable trays.',
    ja: 'パイプ — 内外径分離。流体・ケーブル管。',
    zh: '管道 — 内外径分离。流体、电缆桥架。',
    es: 'Tubo — diámetros interno/externo. Fluidos, cables.',
    ar: 'أنبوب — قطر داخلي وخارجي منفصلان. سوائل وكابلات.',
  },
  gear: {
    ko: '인볼류트 스퍼 기어. BOSL2 라이브러리 의존.',
    en: 'Involute spur gear. Requires BOSL2 library.',
    ja: 'インボリュート平歯車。BOSL2 ライブラリ依存。',
    zh: '渐开线直齿轮。依赖 BOSL2 库。',
    es: 'Engranaje recto con perfil involuta. Requiere BOSL2.',
    ar: 'ترس مستقيم بمنحنى انفلوت. يتطلب مكتبة BOSL2.',
  },
  hexNut: {
    ko: 'M-시리즈 육각너트. 표준 ISO 4032.',
    en: 'M-series hex nut. ISO 4032.',
    ja: 'Mシリーズ六角ナット。ISO 4032。',
    zh: 'M 系列六角螺母。ISO 4032。',
    es: 'Tuerca hexagonal serie M. ISO 4032.',
    ar: 'صامولة سداسية سلسلة M. ISO 4032.',
  },
  flange: {
    ko: '플랜지 — 볼트 패턴 + 시트면.',
    en: 'Flange — bolt pattern + seat face.',
    ja: 'フランジ — ボルトパターン + シート面。',
    zh: '法兰 — 螺栓孔 + 密封面。',
    es: 'Brida — patrón de pernos + cara de asiento.',
    ar: 'شفة — نمط براغي + سطح إغلاق.',
  },
  iBeam: {
    ko: 'I-빔. 구조용 메인 부재.',
    en: 'I-beam. Primary structural member.',
    ja: 'Iビーム。構造主部材。',
    zh: '工字梁。主结构件。',
    es: 'Viga en I. Miembro estructural principal.',
    ar: 'كمرة على شكل I. عنصر هيكلي أساسي.',
  },
  lBracket: {
    ko: 'L-브래킷. 직각 결합 / 마운트.',
    en: 'L-bracket. Right-angle joins or mounts.',
    ja: 'Lブラケット。直角結合・取付。',
    zh: 'L 型支架。直角连接或安装。',
    es: 'Soporte en L. Uniones en ángulo recto.',
    ar: 'حامل على شكل L. وصلات قائمة الزاوية.',
  },
  // ── Primitives (round 36 extension) ────────────────────────────────────
  sphere: {
    ko: '구. 베어링 볼, 노브, 유체 공동.',
    en: 'Sphere. Bearing balls, knobs, fluid cavities.',
    ja: '球。ベアリングボール、ノブ、流体空洞。',
    zh: '球。轴承球、旋钮、流体腔。',
    es: 'Esfera. Bolas de rodamiento, perillas, cavidades.',
    ar: 'كرة. كرات محامل، مقابض، تجاويف.',
  },
  cone: {
    ko: '원뿔. 노즐, 디퓨저, 깔때기.',
    en: 'Cone. Nozzles, diffusers, funnels.',
    ja: '円錐。ノズル、ディフューザー、漏斗。',
    zh: '圆锥。喷嘴、扩散器、漏斗。',
    es: 'Cono. Boquillas, difusores, embudos.',
    ar: 'مخروط. فوهات وموزعات وقمعات.',
  },
  torus: {
    ko: '도넛형. O-링, 가스킷, 코일.',
    en: 'Torus. O-rings, gaskets, coil profiles.',
    ja: 'トーラス。Oリング、ガスケット、コイル。',
    zh: '圆环。O 形圈、密封圈、线圈。',
    es: 'Toroide. Juntas tóricas, bobinas.',
    ar: 'حلقة دائرية. حلقات O، حشيات، ملفات.',
  },
  wedge: {
    ko: '쐐기. 경사면, 램프, 쐐기 클램프.',
    en: 'Wedge. Ramps, inclined faces, wedge clamps.',
    ja: 'くさび。スロープ、傾斜面、くさび留め。',
    zh: '楔形。坡道、斜面、楔形夹具。',
    es: 'Cuña. Rampas, caras inclinadas.',
    ar: 'إسفين. منحدرات وأسطح مائلة.',
  },
  disk: {
    ko: '얇은 원판. 와셔 베이스, 푸셔, 라벨.',
    en: 'Thin disk. Washer bases, pushers, labels.',
    ja: '薄円板。ワッシャベース、押板、ラベル。',
    zh: '薄圆盘。垫圈底座、推板、标签。',
    es: 'Disco delgado. Bases, empujadores, etiquetas.',
    ar: 'قرص رفيع. قواعد ودافعات وملصقات.',
  },
  ellipsoid: {
    ko: '타원체. 항공 페어링, 약통.',
    en: 'Ellipsoid. Aero fairings, capsule shells.',
    ja: '楕円体。航空フェアリング、カプセル。',
    zh: '椭球体。空气整流罩、胶囊。',
    es: 'Elipsoide. Carenados aerodinámicos.',
    ar: 'إهليلج. أغطية ديناميكية وكبسولات.',
  },
  ellipticDisk: {
    ko: '타원판. 비대칭 플랜지, 캠.',
    en: 'Elliptical disk. Asymmetric flanges, cams.',
    ja: '楕円板。非対称フランジ、カム。',
    zh: '椭圆板。非对称法兰、凸轮。',
    es: 'Disco elíptico. Bridas asimétricas, levas.',
    ar: 'قرص بيضاوي. شفات غير متماثلة، كامات.',
  },
  // ── Standard parts ──────────────────────────────────────────────────────
  bolt: {
    ko: '볼트 — 머리 + 나사부. 표준 ISO.',
    en: 'Bolt — head + thread. Standard ISO sizes.',
    ja: 'ボルト — 頭部 + ねじ部。ISO規格。',
    zh: '螺栓 — 头部 + 螺纹。ISO 标准。',
    es: 'Perno — cabeza + rosca. ISO.',
    ar: 'برغي — رأس + سن. مقاسات ISO.',
  },
  washer: {
    ko: '와셔. 외경/내경 분리, 표준 두께.',
    en: 'Washer. Outer/inner diameters, standard thickness.',
    ja: 'ワッシャー。外径/内径、標準厚。',
    zh: '垫圈。外径/内径分离,标准厚度。',
    es: 'Arandela. Diámetros ext/int.',
    ar: 'حلقة معدنية. قطر خارجي/داخلي.',
  },
  bearing: {
    ko: '구름 베어링. 외륜/내륜 + 볼.',
    en: 'Rolling bearing. Outer/inner race + balls.',
    ja: '転がり軸受。外輪/内輪 + ボール。',
    zh: '滚动轴承。外圈/内圈 + 球。',
    es: 'Rodamiento. Pista ext/int + bolas.',
    ar: 'محمل دحرجة. حلقة خارجية/داخلية + كرات.',
  },
  // ── Manufacturing ───────────────────────────────────────────────────────
  fanBlade: {
    ko: '팬 블레이드. 축류식, NACA 프로파일.',
    en: 'Fan blade. Axial flow, NACA profile.',
    ja: 'ファンブレード。軸流、NACAプロファイル。',
    zh: '风扇叶片。轴流式,NACA 轮廓。',
    es: 'Aspa de ventilador. Flujo axial, NACA.',
    ar: 'ريشة مروحة. تدفق محوري، ملف NACA.',
  },
  sprocket: {
    ko: '스프로킷. 체인 구동용 톱니 휠.',
    en: 'Sprocket. Chain-drive toothed wheel.',
    ja: 'スプロケット。チェーン駆動の歯付き車輪。',
    zh: '链轮。链传动齿轮。',
    es: 'Piñón. Rueda dentada para cadena.',
    ar: 'ترس سلسلة. عجلة مسننة للسلاسل.',
  },
  pulley: {
    ko: '풀리. 벨트 구동, V/타이밍.',
    en: 'Pulley. Belt drive, V/timing.',
    ja: 'プーリー。ベルト駆動、V/タイミング。',
    zh: '皮带轮。皮带传动,V/同步。',
    es: 'Polea. Transmisión por correa, V/distribución.',
    ar: 'بكرة. ناقل حركة بسير، V/توقيت.',
  },
  spring: {
    ko: '코일 스프링. 압축/인장.',
    en: 'Coil spring. Compression / extension.',
    ja: 'コイルバネ。圧縮/引張。',
    zh: '螺旋弹簧。压缩/拉伸。',
    es: 'Resorte helicoidal. Compresión / extensión.',
    ar: 'نابض حلزوني. ضغط / شد.',
  },
  sweep: {
    ko: '스윕 — 경로를 따라 단면 압출.',
    en: 'Sweep — extrude profile along a path.',
    ja: 'スイープ — パスに沿って断面押出。',
    zh: '扫掠 — 沿路径拉伸截面。',
    es: 'Barrido — extrusión a lo largo de un camino.',
    ar: 'كنس — بثق ملف على طول مسار.',
  },
  loft: {
    ko: '로프트 — 다중 단면을 부드럽게 보간.',
    en: 'Loft — interpolate between multiple sections.',
    ja: 'ロフト — 複数断面を補間。',
    zh: '放样 — 在多个截面间插值。',
    es: 'Loft — interpolar entre secciones.',
    ar: 'ربط — استكمال بين عدة مقاطع.',
  },
};

const CATEGORY_FALLBACK: Record<ShapeCategory, Record<LangKey, string>> = {
  primitive: {
    ko: '기본 형상 — 다른 부품의 시작점으로 사용하세요.',
    en: 'Primitive — use as a starting block for other parts.',
    ja: '基本形状 — 他部品の起点として使用。',
    zh: '基本形状 — 用作其他零件的起点。',
    es: 'Forma primitiva — punto de partida para otras piezas.',
    ar: 'شكل أولي — نقطة بداية للأجزاء الأخرى.',
  },
  standard: {
    ko: '표준 부품. 산업 표준 규격을 따릅니다.',
    en: 'Standard part. Follows industry-standard sizes.',
    ja: '標準部品。業界規格寸法に準拠。',
    zh: '标准件。遵循行业标准尺寸。',
    es: 'Pieza estándar. Sigue dimensiones normalizadas.',
    ar: 'قطعة قياسية. تتبع المقاسات الصناعية.',
  },
  structural: {
    ko: '구조재. 프레임, 마운트에 사용.',
    en: 'Structural. Use for frames and mounts.',
    ja: '構造材。フレームや取付に使用。',
    zh: '结构件。用于框架和安装。',
    es: 'Estructural. Marcos y montajes.',
    ar: 'هيكلية. للإطارات وأنظمة التركيب.',
  },
  manufacturing: {
    ko: '제조 부품. 특수 공정/기능.',
    en: 'Manufacturing part. Specialized process or function.',
    ja: '製造部品。特殊工程・機能。',
    zh: '制造件。特殊工艺/功能。',
    es: 'Pieza de manufactura. Proceso o función especializada.',
    ar: 'قطعة تصنيع. عملية أو وظيفة متخصصة.',
  },
};

export function getShapeUsageHint(shapeId: string, lang: string): string {
  const langKey = langMap[lang] ?? 'en';
  const explicit = SHAPE_HINTS[shapeId];
  if (explicit) return explicit[langKey];
  return CATEGORY_FALLBACK[getShapeCategory(shapeId)][langKey];
}
