/**
 * feaSheets — **FEA 결과를 표(엑셀/CSV)로** 내보낸다 (260801, 격차 항목 O3).
 *
 * ## 왜 별도 모듈인가 — 그리고 왜 「내보내기」가 위험한가
 * 숫자만 뽑아 내보내면 **맥락이 사라진다.** 이 저장소의 FEA 출력에는
 * 「이 값이 얼마나 믿을 만한가」가 함께 들어 있다:
 * ```
 *   raiser.grade      certification-candidate | engineering | screening
 *   raiser.applied    곡률 응력집중부를 정밀 재해석했는가 (false면 보어 피크는 과소평가)
 *   converged         반복 솔버가 수렴했는가
 *   method            linear-fem-tet | beam-theory
 * ```
 * 이걸 빼고 `maxStress = 123 MPa` 만 시트에 적으면, 파일을 받은 사람은 **스크리닝
 * 추정값을 인증급 해석 결과로 읽는다.** 그래서 이 모듈은 **한계를 별도 시트로 강제**한다.
 *
 * ⚠ 「요약 시트만 뽑기」 옵션을 두지 않는다. 한계를 뺄 수 있게 하면 반드시 빠진다.
 *
 * 표 생성만 담당한다 — 실제 xlsx 직렬화는 이미 있는 `src/lib/tabular-export.ts`
 * (`sheetsToXlsxBuffer`)가 한다. **있는 것을 다시 만들지 않는다.**
 */
import type { TabularRow } from '@/lib/tabular-export';
import type { FeaPackageOutput } from '../analysis/feaPackage';

/** 등급을 사람이 읽는 한 줄로. **등급 이름만 적으면 무슨 뜻인지 아무도 모른다.** */
const GRADE_NOTE: Record<string, string> = {
  'certification-candidate': '경계적합 격자(gmsh) 정밀 해석 — 인증 후보급',
  engineering: '옥트리-스냅 격자 정밀 해석 — 엔지니어링급(실측 A5 Kt 오차 ~5.6%)',
  screening: '스크리닝 — 곡률 응력집중부가 **과소평가**된다. 설계 판단에 그대로 쓰지 말 것',
};

export interface FeaSheetSet {
  /** 시트명 → 행 목록. `sheetsToXlsxBuffer` 에 그대로 넘긴다. */
  sheets: Record<string, TabularRow[]>;
}

/**
 * FEA 결과 → 시트 3장(요약 · 한계 · 재료).
 *
 * ⚠ 「한계」 시트는 **항상** 생성된다. 문제가 없어도 「검출된 문제 없음」을 적는다 —
 *   빈 시트와 「없음」은 다르고, 빈 시트는 「검사 안 함」으로 읽힌다.
 */
export function feaResultSheets(out: FeaPackageOutput): FeaSheetSet {
  const r = out.result;
  const grade = out.raiser?.grade ?? (out.raiser ? 'screening' : null);

  const summary: TabularRow[] = [
    { 항목: '최대 von Mises 응력', 값: round(r.maxStress), 단위: 'MPa' },
    { 항목: '안전율 (항복/최대응력)', 값: round(r.safetyFactor), 단위: '—' },
    { 항목: '최대 변위', 값: round(r.maxDisplacement), 단위: 'mm' },
    { 항목: '재료', 값: out.material.label, 단위: '—' },
    { 항목: '항복강도', 값: out.material.yieldStrength, 단위: 'MPa' },
    { 항목: '적용 하중', 값: round(out.loadN), 단위: 'N' },
    { 항목: '하중 근거', 값: out.loadNote, 단위: '—' },
    { 항목: '해석 방법', 값: r.method, 단위: '—' },
    { 항목: '요소 수', 값: r.elementCount, 단위: '개' },
    { 항목: '자유도 수', 값: r.dofCount, 단위: '개' },
  ];

  /**
   * ★ 한계 시트 — 이 파일의 존재 이유.
   * 숫자를 받는 사람이 **무엇을 믿으면 안 되는지**를 같은 파일 안에서 보게 한다.
   */
  const limits: TabularRow[] = [];
  limits.push({
    구분: '수렴',
    상태: r.converged ? '수렴함' : '**수렴하지 않음**',
    설명: r.converged ? '반복 솔버가 허용오차 내로 수렴했다.' : '수렴하지 않은 해다 — 값을 신뢰할 수 없다.',
  });
  if (grade) {
    limits.push({
      구분: '해석 등급',
      상태: grade,
      설명: GRADE_NOTE[grade] ?? '알 수 없는 등급 — 확인 필요',
    });
  }
  if (out.raiser) {
    limits.push({
      구분: '곡률 응력집중부',
      상태: out.raiser.detected ? (out.raiser.applied ? '검출·정밀 재해석 적용' : '검출·재해석 **미적용**') : '검출 안 됨',
      설명: out.raiser.detected && !out.raiser.applied
        ? '보어·필렛 피크 응력이 과소평가된다. 그 부위 판단에 이 값을 쓰지 말 것.'
        : (out.raiser.detected ? `격자: ${out.raiser.meshMode ?? '—'}` : '해당 형상에 곡률 응력집중부가 없다.'),
    });
    if (out.raiser.gmshError) {
      limits.push({ 구분: '정밀 메셔', 상태: '미사용', 설명: `gmsh 미사용 사유: ${out.raiser.gmshError}` });
    }
  }
  limits.push({
    구분: '해석 가정',
    상태: '선형 등방 탄성',
    설명: '소성·접촉·좌굴·이방성을 반영하지 않는다. 항복 근처 값은 보수적으로 볼 것.',
  });
  if (limits.length === 0) {
    // 도달하지 않지만, 규약을 코드로 남긴다 — 빈 시트는 「검사 안 함」으로 읽힌다.
    limits.push({ 구분: '—', 상태: '검출된 한계 없음', 설명: '검사는 수행됐고 걸린 항목이 없다.' });
  }

  const material: TabularRow[] = [
    { 물성: '탄성계수 E', 값: out.material.youngsModulus, 단위: 'GPa' },
    { 물성: '푸아송비 ν', 값: out.material.poissonRatio, 단위: '—' },
    { 물성: '항복강도', 값: out.material.yieldStrength, 단위: 'MPa' },
    { 물성: '밀도', 값: out.material.density, 단위: 'g/cm³' },
    { 물성: '열팽창계수 α', 값: out.material.alpha, 단위: '1/K' },
    { 물성: '강도 근거', 값: out.material.strengthNote, 단위: '—' },
  ];

  return { sheets: { 요약: summary, 한계: limits, 재료: material } };
}

function round(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN;
}
