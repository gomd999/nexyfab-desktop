/**
 * 설계 진행 단계 — **초안 → 상세 → 제작**. 화면이 「어디까지 왔는지」를 말할 수 있게.
 *
 * ## 왜 상태로 만드나
 * 종전에는 단계가 **문구로만** 있었다. 「이 사양으로 정밀 3D를 생성할까요?」라고 묻는데
 * 그 시점에 이미 형상은 만들어져 있어서, 사용자 눈에는 **「묻고선 이미 해버렸다」**로 보인다.
 * 그리고 「확정」 버튼이 실제로 한 일은 STEP 파일 생성이라 **확정본이 어디에도 안 남았다.**
 *
 * ```
 *   1 초안(draft)   개념 배치 · 치수 추정 포함    → 말로 고친다(되돌릴 수 있다)
 *   2 상세(detail)  치수 확정 · 게이트 통과       → 여기서 「확정」한다
 *   3 산출물(make)  STEP · 도면 · 물량            → 확정한 뒤에만 만든다
 * ```
 *
 * ⚠ **확정은 스냅샷을 남긴다.** 남기지 않으면 다음 수정이 확정본을 덮어써서, 사용자는
 *   「무엇을 확정했는지」를 잃는다. 되돌릴 곳이 없으면 확정은 선언일 뿐이다.
 * ⚠ 문구가 동작과 같아야 한다 — 「생성할까요?」라고 물으려면 **그 전에 안 만들었어야** 한다.
 *   이미 만들었으면 「초안입니다. 이대로 확정할까요?」가 맞는 말이다.
 */

export type DesignStage = 'draft' | 'detail' | 'make';

/** 단계 정의 — 라벨은 6개국어(사이트 규약). 화면이 문자열을 직접 들지 않는다. */
export const DESIGN_STAGES: Array<{
  id: DesignStage;
  ko: string; en: string; zh: string; ja: string; es: string; ar: string;
  /** 이 단계에서 **무엇이 확정되지 않았는지** — 사용자가 뭘 더 말해야 하는지 알 수 있게. */
  pendingKo: string; pendingEn: string; pendingZh: string; pendingJa: string; pendingEs: string; pendingAr: string;
}> = [
  {
    id: 'draft', ko: '초안', en: 'Draft', zh: '草案', ja: '初案', es: 'Borrador', ar: 'مسودة',
    pendingKo: '치수 일부는 추정입니다 — 다르면 말로 고쳐 주세요.',
    pendingEn: 'Some dimensions are estimated — tell me if they are wrong.',
    pendingZh: '部分尺寸为估算值——如有不符，请直接说明修改。',
    pendingJa: '一部の寸法は推定値です。異なる場合は修正内容を伝えてください。',
    pendingEs: 'Algunas cotas son estimadas; indícame cuáles deben corregirse.',
    pendingAr: 'بعض الأبعاد تقديرية — أخبرني بما يجب تصحيحه.',
  },
  {
    id: 'detail', ko: '상세', en: 'Detail', zh: '深化', ja: '詳細', es: 'Detalle', ar: 'تفصيل',
    pendingKo: '치수가 확정됐습니다. 이대로 확정하면 제작물을 만듭니다.',
    pendingEn: 'Dimensions are settled. Confirm to produce manufacturing outputs.',
    pendingZh: '尺寸已确定。确认后将生成制造输出。',
    pendingJa: '寸法が確定しました。確認すると製造用出力を生成します。',
    pendingEs: 'Las cotas están definidas. Confirma para generar los entregables de fabricación.',
    pendingAr: 'تم تثبيت الأبعاد. أكّد لإنشاء مخرجات التصنيع.',
  },
  {
    id: 'make', ko: '제작 산출물', en: 'Manufacturing outputs', zh: '制造输出', ja: '製造出力', es: 'Entregables', ar: 'مخرجات التصنيع',
    pendingKo: 'STEP·도면·물량이 확정본 기준으로 생성됩니다. 실제 제작 전에는 제조 검증이 필요합니다.',
    pendingEn: 'STEP, drawings and quantities use the confirmed version. Manufacturing verification is still required.',
    pendingZh: 'STEP、图纸和工程量均基于确认版本生成；实际制造前仍需制造验证。',
    pendingJa: 'STEP・図面・数量は確定版から生成されます。実製造前には製造検証が必要です。',
    pendingEs: 'STEP, planos y cantidades se generan desde la versión confirmada. Aún se requiere verificación antes de fabricar.',
    pendingAr: 'تُنشأ ملفات STEP والرسومات والكميات من النسخة المؤكدة، ولا يزال التحقق التصنيعي مطلوبًا قبل الإنتاج.',
  },
];

/**
 * 결과로부터 **현재 단계를 판정한다** — 사용자가 고르지 않는다.
 * ⚠ 「게이트를 통과했다」와 「치수가 확정됐다」는 다르다. 추정값(assumed)이 남아 있으면
 *   게이트를 통과해도 여전히 **초안**이다 — 그걸 상세라고 부르면 추정을 확정으로 파는 셈이다.
 */
export function stageOf(r: {
  designOk?: boolean | null;
  gateErrors?: unknown[];
  assumptions?: unknown[];
  provenance?: { assumed?: number } | null;
  confirmed?: boolean;
}): DesignStage {
  if (r.confirmed) return 'make';
  const gateFail = (r.gateErrors ?? []).length > 0;
  const estimated = (r.assumptions ?? []).length > 0 || (r.provenance?.assumed ?? 0) > 0;
  if (gateFail || estimated || r.designOk !== true) return 'draft';
  return 'detail';
}

/** 진행 표시용 인덱스(0-based). */
export const stageIndex = (s: DesignStage) => DESIGN_STAGES.findIndex((x) => x.id === s);

/**
 * 확정 스냅샷 — 확정 시점의 **입력·결과를 통째로** 잡아 둔다.
 * ⚠ 참조만 들고 있으면 다음 수정이 같은 객체를 바꿔 확정본이 조용히 달라진다.
 *   그래서 깊은 복사를 한다(작은 JSON 이라 비용보다 안전이 크다).
 */
export type DesignSnapshot<T> = { at: number; label: string; stage: DesignStage; data: T };
export function snapshot<T>(label: string, stage: DesignStage, data: T, now: number): DesignSnapshot<T> {
  return { at: now, label, stage, data: JSON.parse(JSON.stringify(data)) as T };
}
