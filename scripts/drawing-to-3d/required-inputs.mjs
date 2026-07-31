/**
 * required-inputs.mjs — **무엇을 주면 무엇이 판정되는가** (260802).
 *
 * ## 왜 필요한가 — 실측
 * 5도메인 54템플릿을 재 보니 **판정 152 · 입력대기 30 · 판정불가 55** 였다.
 * 입력대기 30건의 정체가 결정적이다:
 * ```
 * lighting 5 · ventilation 5 · electrical 5 · water 5 · fire 5   ← interior 25건
 * ```
 * **인테리어 9템플릿 중 5개가 같은 5개 값을 기다린다.** 다섯을 한 번 받으면 **25건이
 * 한꺼번에 판정된다.** `mech` 의 판정불가 33건 중 15건도 `seismicG` **하나**다.
 *
 * 즉 지금 막혀 있는 것은 **검토가 없어서가 아니라 값이 안 와서**다. 그런데 사용자는
 * **무엇을 주면 무엇이 켜지는지 알 방법이 없었다.**
 *
 * ## ⚠ 새 판정을 만들지 않는다
 * 각 검토가 **자기 `needInputs` 로 선언한 것**을 모으기만 한다. 여기서 필드를 추측하거나
 * 기본값을 제안하면, 그 값으로 판정이 나가고 **근거가 우리 추측이 된다.**
 *
 * ## 무엇을 순회하는가
 * **`needInputs` 선언 자체**를 순회한다. 판정 버킷(`collectJudgments`)만 보면 판정 노드가
 * 아닌 자리(예: 검토 루트의 거부)가 통째로 빠진다 — 실측으로 3템플릿을 놓치고 있었다.
 */

/**
 * 어셈블리의 안전검토 트리에서 **필요 입력을 필드별로 집계**한다.
 *
 * @param tree `auditDomainSafety(assembly, params)` 결과(검사 트리 원본)
 * @returns `{ fields: [{ field, kind, unlocks, checks[] }], totalWaiting }` — 없으면 `null`
 *
 * ⚠ `null` 은 **「기다리는 입력이 없다」**이지 「검토가 없다」가 아니다.
 *   호출측이 그 둘을 뭉개지 않게 빈 배열이 아니라 null 로 돌려준다.
 */
/**
 * 필드 이름이 **파라미터 키**인가 **설계 선언 경로**인가.
 *
 * ⚠ 둘을 뭉개면 안내가 틀린다. `seismicG` 는 검토 입력창에 넣는 값이지만,
 *   `parts[].params.holes[].fit` 은 **모델에 선언**해야 하는 것이라 주는 곳이 다르다.
 */
const isDesignPath = (f) => /[[\].]/.test(f);

/**
 * 검사 트리 전체에서 **`needInputs` 선언을 직접 순회**한다.
 *
 * ⚠ 처음엔 `collectJudgments` 의 버킷(`input`·`unjudged`)만 썼다. 그러면 **판정 노드가
 *   아닌 자리의 요구를 통째로 놓친다** — 실측: `building/water_tank`·`elevator_shaft`·
 *   `gable_house` 는 **루트**에서 `seismic.R`·`wind.V0` 를 요구하는데, 루트는 `label` 만
 *   있고 `labelKo`/`name` 이 없어 판정 수집기의 이름 판정에서 탈락한다. 세 템플릿의 요구가
 *   사용자에게 한 글자도 안 나가고 있었다.
 * ⚠ 그렇다고 판정 규칙을 여기서 다시 짜는 것은 아니다 — **묻는 질문이 다르다.**
 *   판정 수집기는 「무엇이 판정됐나」, 여기는 「무엇을 요구하고 있나」다.
 */
function walkNeedInputs(node, out = [], depth = 0) {
  if (node == null || typeof node !== 'object' || depth > 8) return out;
  if (Array.isArray(node)) {
    for (const x of node) walkNeedInputs(x, out, depth + 1);
    return out;
  }
  const reqs = Array.isArray(node.needInputs) ? node.needInputs : [];
  if (reqs.length) {
    const label = String(node.labelKo ?? node.name ?? node.label ?? '?');
    const fields = reqs
      .map((r) => (r && typeof r === 'object' ? (r.field ?? r.name) : r))
      .map((f) => String(f ?? '').trim())
      .filter((f) => f && f !== '?');
    if (fields.length) out.push({ label, fields });
  }
  for (const [k, x] of Object.entries(node)) {
    if (k === 'needInputs' || k === 'refs' || k === 'inputsEcho' || k === 'provenance') continue;
    if (x && typeof x === 'object') walkNeedInputs(x, out, depth + 1);
  }
  return out;
}

export function collectRequiredInputs(tree) {
  if (!tree) return null;
  /**
   * ★ 260802 실측 — **`verdict:'INPUT'` 만 모으면 절반 이상을 놓친다.**
   * 54템플릿에서 입력대기 30 · 판정불가 55 였는데, 판정불가 55 중 **35건이
   * 「계산기가 없다」가 아니라 「값이 없다」**였다(자기 `needInputs` 로 필드를 선언하고 있다):
   * ```
   * seismicG 16 · fit 12 · zoning 3 · wind 1 · 좌굴 제원 2 · 살 선언 1
   * ```
   * 값을 넣어 실제로 확인했다 — `seismicG` **하나로 판정 +15**, zoning 3개로 +3,
   * 올바른 경로의 `fit` 으로 +12. 그러니 **verdict 종류가 아니라 「요구했는가」**로 모은다.
   * ⚠ 요구하지 않은 판정불가(참고값·적용범위 밖)는 **넣지 않는다** —
   *   줄 수 없는 것을 「주면 켜진다」고 하면 그게 과고지다.
   */
  let waiting;
  try { waiting = walkNeedInputs(tree?.result ?? tree); } catch { return null; }
  if (!waiting.length) return null;


  /** 필드 → 그 필드를 기다리는 검토들. **한 필드가 여러 검토를 켜는 것**이 요점이다. */
  const byField = new Map();
  for (const item of waiting) {
    const label = String(item?.label ?? '?');
    for (const f of item?.fields ?? []) {
      const key = String(f);
      if (key === '?') continue;   // 이름 없는 것은 세지 않는다 — 사용자가 줄 수 없다
      if (!byField.has(key)) byField.set(key, new Set());
      byField.get(key).add(label);
    }
  }
  if (!byField.size) return null;

  const fields = [...byField.entries()]
    .map(([field, set]) => ({
      field,
      /** `param`=검토 입력값 · `design`=모델에 선언할 것. **주는 곳이 다르다.** */
      kind: isDesignPath(field) ? 'design' : 'param',
      unlocks: set.size,
      checks: [...set].sort(),
    }))
    // 많이 켜는 것부터 — 사용자가 **무엇부터 줄지** 정할 수 있어야 한다.
    .sort((a, b) => b.unlocks - a.unlocks || a.field.localeCompare(b.field));

  return { fields, totalWaiting: waiting.length };
}

/**
 * 사람이 읽을 한 줄.
 *
 * ⚠ **한 어셈블리 안에서는 필드마다 1건인 경우가 많다** — 「많이 여는 순」이 의미를 가지려면
 *   보통 여러 템플릿을 가로질러 봐야 한다(실측: `lighting`·`ventilation`·`electrical`·
 *   `water`·`fire` 5개가 인테리어 5템플릿에서 반복돼 25건을 만든다).
 *   그래서 여기서는 **부풀리지 않고** 실제 건수 그대로 적는다.
 */
export function requiredInputsSummaryKo(ri) {
  if (!ri) return null;
  const names = ri.fields.slice(0, 5).map((f) => (f.unlocks > 1 ? `${f.field}(${f.unlocks}건)` : f.field));
  const more = ri.fields.length > 5 ? ` 외 ${ri.fields.length - 5}개` : '';
  return `입력 대기 ${ri.totalWaiting}건 — 아래 값을 주면 그만큼 판정됩니다: ${names.join(' · ')}${more}`;
}
