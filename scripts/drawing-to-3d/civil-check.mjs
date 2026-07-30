/**
 * civil-check.mjs — 토목 구조 **형상 비례 검토** (260802).
 *
 * ## 왜 만들었나 — 실측
 * 5도메인 판정 커버리지를 재 보니 `civil` 만 **판정 0개**였다(템플릿 3종 전부).
 * 파고드니 「검토가 없다」가 아니라 **안전검토 계층이 없다**는 뜻이었다:
 * ```
 * retaining_wall_run  reachedVerification {ok:true, decisive:true}  label null
 * box_culvert         reachedVerification {ok:true, decisive:false} label null
 * ```
 * 계산기(`retaining_wall_stability`·`box_culvert_frame`)는 도달하는데,
 * `runDomainSafetyCheck` 디스패치에 **`civil` 분기가 아예 없었다**(나머지 5도메인은 있다).
 *
 * ## ⚠ 계산기와 **중복하지 않는다**
 * 전도·활동·지지력·라멘 단면력은 **이미 계산기가 한다.** 여기서 또 하면 두 값이 갈리고,
 * 갈리면 어느 쪽이 맞는지 아무도 모른다. 여기서는 **계산기가 안 보는 것**만 본다 —
 * 하중 없이 **형상만으로 판정되는 비례**다.
 *
 * ## 무엇을 판정하는가
 *  · 옹벽 저판 폭 / 벽고 — 통상 0.5~0.7H (전도·활동의 **선결 조건**)
 *  · 저판 두께 / 벽고 — 통상 H/12 이상
 *  · 앞굽 길이 / 저판 폭 — 통상 1/3 이하(뒷굽이 저항 모멘트를 만든다)
 *  · 암거 벽두께 / 내공 — 통상 1/12 이상
 *
 * ## 지어내지 않는 것
 *  · 이 비례들은 **예비 설계 관례**이며 법정 기준이 아니다. 그렇게 적는다.
 *  · 비례가 맞아도 **하중을 못 버티면 무의미하다** — 계산기 결과가 최종이다.
 *  · 지반 조건·배면 경사·지하수위는 선언되지 않았다(미검토로 이름을 남긴다).
 */

const r2 = (v) => +Number(v).toFixed(2);

/** 비례 한 건 — 범위 안이면 적합, 밖이면 검토. 합·불이 아니라 **예비 비례**임을 명시한다. */
function ratioCheck(labelKo, value, lo, hi, why) {
  const ok = value >= lo && (hi == null || value <= hi);
  return {
    labelKo: `${labelKo} = ${r2(value)}`,
    pass: ok,
    detail: [
      hi == null ? `통상 ${lo} 이상` : `통상 ${lo} ~ ${hi}`,
      ok ? '예비 비례 범위 안이다.' : `**범위 밖이다** — ${why}`,
    ],
    note: '예비 설계 관례 비례이며 **법정 기준이 아니다.** 최종 판정은 계산기(안정·단면력) 결과가 한다.',
  };
}

/**
 * 토목 형상 비례 검토. `retainingWall`·`boxCulvert` 메타가 없으면 **null**(해당 없음).
 * ⚠ 「해당 없음」은 「이상 없음」이 아니다 — 호출측이 그렇게 적지 않게 null 로 돌려준다.
 */
export function civilCheck(assembly) {
  const rw = assembly?.retainingWall;
  const bc = assembly?.boxCulvert;
  if (!rw && !bc) return null;

  const checks = {};
  const notChecked = [];

  if (rw) {
    const H = Number(rw.H), bw = Number(rw.baseWidth), bt = Number(rw.baseThickness), toe = Number(rw.toeLength);
    if (H > 0 && bw > 0) {
      checks.baseWidthRatio = ratioCheck('저판 폭 / 벽고 B/H', bw / H, 0.5, 0.7,
        bw / H < 0.5 ? '저판이 좁으면 전도·활동에 불리하다(계산기 결과를 반드시 확인할 것).'
          : '저판이 넓으면 안전하지만 물량이 커진다 — 최적화 여지가 있다.');
    }
    if (H > 0 && bt > 0) {
      checks.baseThicknessRatio = ratioCheck('저판 두께 / 벽고 t/H', bt / H, 1 / 12, null,
        '저판이 얇으면 저판 자체가 휨으로 파괴될 수 있다.');
    }
    if (bw > 0 && toe >= 0) {
      checks.toeRatio = ratioCheck('앞굽 / 저판 폭', toe / bw, 0, 1 / 3,
        '앞굽이 길면 뒷굽이 짧아져 **배면토의 저항 모멘트가 줄어든다.**');
    }
    notChecked.push(
      {
        labelKo: '전도·활동·지지력 (계산기 담당)',
        messageKo: '이 항목들은 **`retaining_wall_stability` 계산기가 판정**한다. 여기서 중복 판정하지 않는다 — '
          + '두 곳에서 계산하면 값이 갈리고, 갈리면 어느 쪽이 맞는지 알 수 없다.',
      },
      {
        labelKo: '지반 조건·배면 경사·지하수위',
        messageKo: '**선언되지 않았다.** 지하수위가 올라가면 수압이 더해져 비례가 맞아도 위험해진다.',
      },
    );
  }

  if (bc) {
    const iw = Number(bc.innerWidth), ih = Number(bc.innerHeight), t = Number(bc.wallThk);
    const span = Math.max(iw, ih);
    if (span > 0 && t > 0) {
      checks.wallThicknessRatio = ratioCheck('벽두께 / 내공(큰 쪽) t/L', t / span, 1 / 12, null,
        '벽·슬래브가 얇으면 라멘 단면력에 못 견딘다(단면력은 계산기가 산출한다).');
    }
    if (iw > 0 && ih > 0) {
      // 내공 종횡비 — 극단이면 라멘 거동이 아니라 벽체 거동에 가까워진다.
      checks.innerAspect = ratioCheck('내공 종횡비 (긴변/짧은변)', Math.max(iw, ih) / Math.min(iw, ih), 1, 3,
        '종횡비가 크면 라멘 해석의 전제(강절 골조)에서 멀어진다 — 별도 검토가 필요하다.');
    }
    notChecked.push({
      labelKo: '라멘 단면력·배근 (계산기 담당)',
      messageKo: '**`box_culvert_frame` 계산기가 단면력을 산출**한다(합·불 판정이 아니라 산출값). '
        + '배근·단면 검토는 그 값을 받아 구조기술사가 한다.',
    });
  }

  return {
    ok: true,
    label: rw && bc ? '토목 형상 비례 검토 (옹벽·암거)' : rw ? '옹벽 형상 비례 검토' : '암거 형상 비례 검토',
    checks,
    basis: {
      ...(rw ? { H: rw.H, baseWidth: rw.baseWidth, baseThickness: rw.baseThickness, length: rw.length } : {}),
      ...(bc ? { innerWidth: bc.innerWidth, innerHeight: bc.innerHeight, wallThk: bc.wallThk } : {}),
    },
    notChecked,
    refs: ['예비 설계 관례 비례(법정 기준 아님)', 'KDS 11 80 05 계열(옹벽) — 최종 판정은 계산기'],
    disclaimer: '개념 검토(비법정) — **형상 비례만.** 하중·지반 조건에 대한 판정은 계산기와 구조기술사의 몫이다.',
  };
}
