import type { EngChatActionPayload } from '@/lib/engChatActionPayload';

type CorrectionLang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const COPY: Record<CorrectionLang, {
  jetDefault: string; jetRefine: string; vague: string;
  scoop: (bowl: number, thickness: number, handleD: number, handleL: number) => string;
}> = {
  kr: { jetDefault: '기본값으로 터보제트 개념 조립체를 생성합니다. 형상·유로·부품별 검증 결과를 함께 표시합니다.', jetRefine: '구체화 계획: ① 부품 어휘를 표준 타입으로 정규화 ② 축·케이싱·로터 기준축 정렬 ③ 간섭·부유 부품 재검사 ④ BOM·SCAD·STEP 산출물을 갱신한 뒤 다시 생성합니다.', vague: '현재 지시에는 변경 기준이 없어 바로 형상을 바꾸지 않겠습니다. 다음 중 원하는 작업을 선택해 주세요: (1) 연결부·기준축 정렬 (2) 간섭·부유 부품 해결 (3) 치수·공차 구체화 (4) 제조성·재질 개선 (5) BOM·STEP·SCAD 갱신. 선택하면 계획을 세운 뒤 실행합니다.', scoop: (b, t, d, l) => `맞습니다. 기존 원통형 보우를 폐기하고, 상부가 열린 반구형 보우(ϴ${b}mm, t${t}mm)와 손잡이(ϴ${d}×${l}mm)로 재생성합니다.` },
  en: { jetDefault: 'I will generate the turbojet concept assembly with the recommended defaults and show geometry, flow-path and part-level verification.', jetRefine: 'Refinement plan: 1) normalize parts to standard vocabulary, 2) align shaft, casing and rotor datums, 3) recheck clashes and floating parts, and 4) refresh BOM, SCAD and STEP outputs before regenerating.', vague: 'The instruction has no measurable change criterion, so I will not alter the geometry yet. Choose: (1) align interfaces/datums, (2) resolve clashes/floating parts, (3) refine dimensions/tolerances, (4) improve manufacturability/material, or (5) refresh BOM/STEP/SCAD.', scoop: (b, t, d, l) => `Correct. I will replace the cylindrical bowl with an open hemispherical bowl (ϴ${b}mm, t${t}mm) and a handle (ϴ${d}×${l}mm).` },
  ja: { jetDefault: '推奨初期値でターボジェット概念アセンブリを生成し、形状・流路・部品別の検証結果を表示します。', jetRefine: '詳細化計画：①部品を標準語彙へ正規化 ②軸・ケーシング・ローターの基準軸を整列 ③干渉と浮遊部品を再検査 ④BOM・SCAD・STEPを更新して再生成します。', vague: '変更基準が明確でないため、まだ形状は変更しません。①接続部・基準軸の整列 ②干渉・浮遊部品の解消 ③寸法・公差の詳細化 ④製造性・材質の改善 ⑤BOM・STEP・SCAD更新から選んでください。', scoop: (b, t, d, l) => `そのとおりです。円筒形ボウルを廃止し、上部が開いた半球ボウル(ϴ${b}mm、t${t}mm)とハンドル(ϴ${d}×${l}mm)で再生成します。` },
  cn: { jetDefault: '将按推荐默认值生成涡喷概念装配体，并显示几何、流道和零件级验证结果。', jetRefine: '细化计划：①将零件规范为标准类型 ②对齐轴、机匣和转子的基准轴 ③复查干涉与悬空零件 ④更新BOM、SCAD和STEP后重新生成。', vague: '当前指令没有明确的修改标准，因此暂不改变几何。请选择：①接口/基准轴对齐 ②解决干涉/悬空零件 ③细化尺寸/公差 ④改进可制造性/材料 ⑤更新BOM/STEP/SCAD。', scoop: (b, t, d, l) => `正确。将删除圆柱形勺头，改为顶部开放的半球勺头(ϴ${b}mm，t${t}mm)和手柄(ϴ${d}×${l}mm)。` },
  es: { jetDefault: 'Generaré el conjunto conceptual del turborreactor con los valores recomendados y mostraré la verificación de geometría, flujo y piezas.', jetRefine: 'Plan de refinamiento: 1) normalizar piezas, 2) alinear ejes de referencia, 3) revisar interferencias y piezas flotantes y 4) actualizar BOM, SCAD y STEP antes de regenerar.', vague: 'La instrucción no contiene un criterio medible, así que aún no cambiaré la geometría. Elige: (1) alinear interfaces/ejes, (2) resolver interferencias, (3) detallar cotas/tolerancias, (4) mejorar fabricación/material o (5) actualizar BOM/STEP/SCAD.', scoop: (b, t, d, l) => `Correcto. Sustituiré el cuenco cilíndrico por uno hemisférico abierto (ϴ${b}mm, t${t}mm) y un mango (ϴ${d}×${l}mm).` },
  ar: { jetDefault: 'سأنشئ تجميعًا مفاهيميًا للمحرك النفاث بالقيم الموصى بها، مع عرض تحقق الشكل ومسار التدفق وكل جزء.', jetRefine: 'خطة التحسين: 1) توحيد الأجزاء وفق الأنواع القياسية، 2) محاذاة محاور العمود والغلاف والدوار، 3) إعادة فحص التداخل والأجزاء العائمة، و4) تحديث BOM وSCAD وSTEP قبل إعادة الإنشاء.', vague: 'لا يتضمن الطلب معيارًا قابلًا للقياس، لذلك لن أغير الشكل الآن. اختر: (1) محاذاة الوصلات والمحاور، (2) حل التداخل والأجزاء العائمة، (3) تفصيل الأبعاد والتفاوتات، (4) تحسين قابلية التصنيع أو المادة، أو (5) تحديث BOM وSTEP وSCAD.', scoop: (b, t, d, l) => `صحيح. سأستبدل الوعاء الأسطواني بوعاء نصف كروي مفتوح (ϴ${b}mm، t${t}mm) ومقبض (ϴ${d}×${l}mm).` },
};

const numberAfter = (text: string, patterns: RegExp[], fallback: number): number => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = Number(match?.[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
};

/** Deterministic recovery for semantic corrections to an already-generated product. */
export function mechanicalSemanticCorrection(
  message: string,
  history: unknown,
  lastSpec = '',
  lang: CorrectionLang = 'kr',
): EngChatActionPayload | null {
  const copy = COPY[lang] ?? COPY.en;
  const prior = Array.isArray(history)
    ? history.map((item) => (item && typeof item === 'object' && 'content' in item ? String((item as { content?: unknown }).content ?? '') : '')).join('\n')
    : '';
  const context = `${prior}\n${lastSpec}`;
  const jetContext = /(?:\uC81C\uD2B8\s*\uC5D4\uC9C4|\uD130\uBCF4\uC81C\uD2B8|\uD130\uBCF4\uD32C|jet\s*engine|turbo\s*jet|gas\s*turbine)/i.test(context);
  const affirmative = /^(?:\uB124|\uC608|\uC751|\uAE30\uBCF8\uAC12(?:\uC73C\uB85C)?\s*\uC9C4\uD589|\uC9C4\uD589|ok|okay|yes|proceed|default|はい|進めて|デフォルト|是|好的|继续|默认|sí|si|continuar|por defecto|نعم|تابع|استمر|افتراضي)\s*[.!?~。！؟]*$/i.test(String(message).trim());
  if (jetContext && affirmative) {
    return {
      type: 'assembly',
      prompt: 'Turbojet engine concept assembly; fan diameter 500mm, overall length 1500mm, 5-stage axial compressor, 2-stage turbine, NACA blade-ring rotors, annular combustor liner, coaxial shaft, casing and exhaust nozzle. Preliminary geometry only; keep all subsystems as separate parts.',
      reply: copy.jetDefault,
    };
  }
  const asksJetDetail = /(?:\uB354\s*\uAD6C\uCCB4|\uC0C1\uC138|\uC790\uC138|detail|expand|refine|詳細|具体化|细化|详细|detallar|refinar|تفصيل|تحسين)/i.test(String(message).trim());
  if (jetContext && asksJetDetail) {
    return {
      type: 'assembly',
      prompt: 'Refine the existing turbojet concept assembly using NexyFab mechanical vocabulary: separate inlet cowl, compressor casing, fan rotor, axial compressor blade rings, annular combustor liner and fuel manifold, turbine blade rings, rotor shaft, bearings, exhaust nozzle and casing. Preserve the prior dimensions and stage counts; improve axial alignment and keep the preliminary CFD/thermal/rotordynamics limitations explicit.',
      reply: copy.jetRefine,
    };
  }
  // Do not silently invent dimensions or apply a vague edit to an existing
  // model.  Turn underspecified instructions into a short, actionable plan;
  // the user can then choose the native CAD/engineering operation.
  const hasExistingDesign = /(?:\uC0DD\uC131|\uC870\uB9BD\uCCB4|\uC124\uACC4|\uBAA8\uB378|assembly|design|model|created|generated)/i.test(context);
  const vagueEdit = /(?:\uC880\s*(?:\uAC1C\uC120|\uB354\s*\uC88B\uAC8C)|\uC54C\uC544\uC11C|\uC801\uB2F9\uD788|\uB354\s*\uC790\uC138|\uAD6C\uCCB4\uD654|improve|make\s+it\s+better|refine|enhance)/i.test(String(message).trim());
  if (hasExistingDesign && vagueEdit) {
    return {
      type: 'reply',
      reply: copy.vague,
    };
  }
  const isExistingScoop = /(?:아이스\s*크림[^\n]{0,30}(?:스쿱|스쿠프)|아이스크림[^\n]{0,30}(?:스쿱|스쿠프)|ice\s*cream\s*scoop)/i.test(context)
    && /(?:생성|(?:스쿱|스쿠프)\s*형태|generated|created)/i.test(context);
  const asksShapeCorrection = /(?:반구|(?:스쿱|스쿠프)[^\n]{0,20}아니|형태[^\n]{0,12}아니|hemispher|not\s+(?:a\s+)?scoop|wrong\s+shape)/i.test(message);
  if (!isExistingScoop || !asksShapeCorrection) return null;

  const all = `${context}\n${message}`;
  const bowl = numberAfter(all, [/(?:보우|볼|머리|bowl|head)[^\dØϕ⌀]{0,20}[Øϕ⌀]?\s*(\d+(?:\.\d+)?)/i], 55);
  const handleD = numberAfter(all, [/(?:손잡이|handle)[^\d]{0,20}[Øϕ⌀]?\s*(\d+(?:\.\d+)?)/i], 18);
  const handleL = numberAfter(all, [/(?:손잡이|handle)[^\n]{0,30}[Øϕ⌀]?\s*\d+(?:\.\d+)?\s*[x×]\s*(\d+(?:\.\d+)?)/i], 120);
  const thickness = numberAfter(all, [/(?:두께|thickness|wall)[^\d]{0,12}(\d+(?:\.\d+)?)/i], 2);
  return {
    type: 'scad',
    prompt: `Ice cream scoop with an open hollow hemispherical bowl, bowl diameter ${bowl}mm, wall thickness ${thickness}mm, handle diameter ${handleD}mm and handle length ${handleL}mm. The bowl must be a true hemispherical shell, not a solid cylinder or flat disk.`,
    reply: copy.scoop(bowl, thickness, handleD, handleL),
  };
}
