/**
 * 검토 입력(`verifyParams`) 폼 필드 — **형상에서 알 수 없는 값만** 받는다 (260731b).
 *
 * ⚠ 이 폼이 없던 동안 `verifyParams` 는 **API 로만 닿을 수 있었다**. 라우트에도 MCP 에도
 * 배선돼 있고 라이브 도달도 실측했는데, 웹 UI 가 `{assembly}` 만 보내서 웹 사용자는
 * 영원히 「입력 대기」만 받았다 — **API 로만 닿는 입력은 사실상 없는 입력이다.**
 * 실측(51종): R 을 주면 실판정 146 → 154, 전부 주면 168(같은 형상·같은 코드).
 *
 * ⚠ 값을 **지어내지 않는다** — 기본값을 넣어 두면 사용자가 확인하지 않은 값으로 판정이
 * 나간다. 빈칸은 빈칸으로 보내고(키 자체를 뺀다), 검사가 「입력 대기」로 고지한다.
 */
export const VERIFY_FIELDS: Array<{ key: string; labelKey: string; min?: number; max?: number; step?: number }> = [
  { key: 'seismicR', labelKey: 'vpR', min: 1, max: 8, step: 0.5 },
  { key: 'windV0', labelKey: 'vpV0', min: 10, max: 80, step: 1 },
  { key: 'As_mm2', labelKey: 'vpAs', min: 0, step: 100 },
  { key: 'coverageLimitPct', labelKey: 'vpBcr', min: 0, max: 100, step: 1 },
  { key: 'farLimitPct', labelKey: 'vpFar', min: 0, max: 2000, step: 10 },
  { key: 'greenRatioMinPct', labelKey: 'vpGreen', min: 0, max: 100, step: 1 },
];

/**
 * 폼 문자열 → `verifyParams` 객체. **빈칸·비수치는 키를 만들지 않는다** —
 * `0` 이나 기본값으로 바꿔 보내면 사용자가 주지 않은 값으로 판정이 나간다.
 */
export function buildVerifyParams(vp: Record<string, string>): Record<string, unknown> {
  const num = (k: string) => {
    const v = Number(vp[k]);
    return vp[k] != null && String(vp[k]).trim() !== '' && Number.isFinite(v) ? v : null;
  };
  const R = num('seismicR'); const V0 = num('windV0'); const As = num('As_mm2');
  const bcr = num('coverageLimitPct'); const far = num('farLimitPct'); const green = num('greenRatioMinPct');
  const zoning: Record<string, number> = {};
  if (bcr !== null) zoning.coverageLimitPct = bcr;
  if (far !== null) zoning.farLimitPct = far;
  if (green !== null) zoning.greenRatioMinPct = green;
  return {
    ...(R !== null ? { seismic: { R } } : {}),
    ...(V0 !== null ? { wind: { V0 } } : {}),
    ...(As !== null && As > 0 ? { As_mm2: As } : {}),
    ...(Object.keys(zoning).length ? { zoning } : {}),
  };
}
