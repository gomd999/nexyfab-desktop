/**
 * interior-component-check.mjs — 실내 부분요소(가구·칸막이·천장) 자기정합 검토 (260729).
 *
 * ## 왜 필요했나
 * interior 도메인은 **무조건 `interiorCheck`(피난·수용인원)** 로 갔다 — building 이
 * 무조건 `loadPathCheck` 로 가던 것과 같은 고정 배선이다. 그래서 붙박이장·카운터바·
 * 칸막이벽·천장그리드가 "roomBounds{W,D} 메타 필요"로 거부됐다. 이들은 **방이 아니라
 * 부분 요소**라 roomBounds 가 없는 게 맞다 — 입력이 모자란 것이 아니라 피난 검토의
 * 대상이 아닌 것이다. "확인 못 함"과 "해당 없음"을 섞으면 소비자는 "입력을 더 주면
 * 판정된다"고 읽는다.
 *
 * ## 무엇을 검사하는가 — 전부 선언값만의 산술
 * 지어낼 값이 하나도 없다. 기어 중심거리(a=m(z₁+z₂)/2)와 같은 종류의 **자기정합**이다 —
 * 메타가 스스로 모순되면 형상과 수량표 중 하나는 반드시 틀렸다.
 *   · 칸막이벽: 벽두께 = 스터드폭 + 보드두께×2 · (스터드수−1)×피치 ≤ 길이
 *   · 천장그리드: cellsX×cellsY = cells · 타일+조명 = cells · 폭/타일폭 = cellsX · 면적
 *   · 붙박이장: 행거베이 ≤ 전체베이 · 걸레받이 < 전체높이
 *   · 카운터바: 발판높이 < 카운터높이 · 오버행 < 깊이
 *
 * ⚠ 비법정. 치수 자기정합만 본다 — 구조 안전·마감 성능·법정 기준은 이 검사의 범위가 아니다.
 */

/** 등식 자기정합 한 줄. */
function eq(labelKo, got, want, note) {
  const ok = Number.isFinite(Number(got)) && Number.isFinite(Number(want))
    && Math.abs(Number(got) - Number(want)) <= Math.max(1e-6, Math.abs(Number(want)) * 1e-9);
  return { labelKo, pass: ok, detail: [`선언 ${got} vs 계산 ${want}`], ...(note ? { note } : {}) };
}
/** 부등식(a < b) 자기정합 한 줄. */
function lt(labelKo, a, b, note) {
  return {
    labelKo, pass: Number(a) < Number(b),
    detail: [`${a} vs ${b}`], ...(note ? { note } : {}),
  };
}

function checkPartition(m) {
  const checks = {};
  if ([m.wallThk, m.studWidth, m.boardThk].every((v) => Number(v) > 0)) {
    checks.thickness = eq('벽 두께 = 스터드폭 + 보드두께×2',
      m.wallThk, Number(m.studWidth) + 2 * Number(m.boardThk),
      '어긋나면 단면도와 수량표 중 하나가 틀렸다 — 순수 산술');
  }
  if ([m.studs, m.studPitch, m.length].every((v) => Number(v) > 0) && m.studs >= 2) {
    const need = (Number(m.studs) - 1) * Number(m.studPitch);
    checks.studSpan = {
      labelKo: '스터드 배치 ((스터드수−1)×피치 ≤ 길이)',
      pass: need <= Number(m.length) + 1e-9,
      detail: [`(${m.studs}−1) × ${m.studPitch} = ${need} vs 길이 ${m.length}`],
      note: '넘으면 선언한 개수가 선언한 길이 안에 들어가지 않는다',
    };
  }
  if (m.opening && [m.opening.width, m.opening.x, m.length].every((v) => Number(v) >= 0)) {
    checks.opening = {
      labelKo: '개구부가 벽 안에 있다 (x + 폭 ≤ 길이)',
      pass: Number(m.opening.x) + Number(m.opening.width) <= Number(m.length) + 1e-9,
      detail: [`x ${m.opening.x} + 폭 ${m.opening.width} = ${Number(m.opening.x) + Number(m.opening.width)} vs 길이 ${m.length}`],
    };
    if (Number(m.opening.height) > 0 && Number(m.height) > 0) {
      checks.openingHeight = lt('개구부 높이 < 벽 높이', m.opening.height, m.height);
    }
  }
  return Object.keys(checks).length ? { ok: true, label: '칸막이벽 검토 (단면·배치 자기정합)', checks } : null;
}

function checkCeiling(m) {
  const checks = {};
  if ([m.cellsX, m.cellsY, m.cells].every((v) => Number(v) > 0)) {
    checks.cellCount = eq('셀 수 = 가로 × 세로', m.cells, Number(m.cellsX) * Number(m.cellsY));
  }
  if ([m.tiles, m.lights, m.cells].every((v) => Number(v) >= 0)) {
    checks.tileCount = eq('타일 + 조명 = 셀 수', Number(m.tiles) + Number(m.lights), Number(m.cells),
      '조명이 차지한 칸을 빼고 남은 것이 타일이다 — 어긋나면 수량표가 틀렸다');
  }
  if ([m.width, m.tileWidth, m.cellsX].every((v) => Number(v) > 0)) {
    checks.gridX = eq('가로 셀 수 = 폭 ÷ 타일폭', m.cellsX, Number(m.width) / Number(m.tileWidth));
  }
  if ([m.depth, m.tileDepth, m.cellsY].every((v) => Number(v) > 0)) {
    checks.gridY = eq('세로 셀 수 = 깊이 ÷ 타일깊이', m.cellsY, Number(m.depth) / Number(m.tileDepth));
  }
  if ([m.width, m.depth, m.ceilingAreaM2].every((v) => Number(v) > 0)) {
    checks.area = eq('천장 면적(㎡) = 폭 × 깊이', m.ceilingAreaM2, (Number(m.width) * Number(m.depth)) / 1e6);
  }
  return Object.keys(checks).length ? { ok: true, label: '천장 그리드 검토 (수량·격자 자기정합)', checks } : null;
}

function checkCloset(m) {
  const checks = {};
  if (Number(m.bays) > 0 && Number(m.hangerBays) >= 0) {
    checks.hangerBays = {
      labelKo: '행거 베이 ≤ 전체 베이', pass: Number(m.hangerBays) <= Number(m.bays),
      detail: [`행거 ${m.hangerBays} vs 전체 ${m.bays}`],
    };
  }
  if (Number(m.plinthHeight) > 0 && Number(m.height) > 0) {
    checks.plinth = lt('걸레받이 높이 < 전체 높이', m.plinthHeight, m.height);
  }
  if (Number(m.doors) > 0 && Number(m.bays) > 0) {
    checks.doors = {
      labelKo: '문 개수(참고)', pass: null,
      detail: [`문 ${m.doors} · 베이 ${m.bays} — 베이당 ${(Number(m.doors) / Number(m.bays)).toFixed(1)}짝. `
        + '여닫이/미닫이 방식이 선언돼 있지 않아 적정 여부는 판정하지 않는다(산출값만).'],
    };
  }
  return Object.keys(checks).length ? { ok: true, label: '붙박이장 검토 (치수 자기정합)', checks } : null;
}

function checkCounter(m) {
  const checks = {};
  if (Number(m.footRailHeight) > 0 && Number(m.height) > 0) {
    checks.footRail = lt('발판 봉 높이 < 카운터 높이', m.footRailHeight, m.height);
  }
  if (Number(m.overhang) > 0 && Number(m.depth) > 0) {
    checks.overhang = lt('상판 내밈 < 카운터 깊이', m.overhang, m.depth,
      '내밈이 깊이를 넘으면 지지 없이 떠 있는 상판이 된다');
  }
  if (Number(m.seatsApprox) > 0 && Number(m.length) > 0) {
    checks.seatPitch = {
      labelKo: '좌석 간격(참고)', pass: null,
      detail: [`길이 ${m.length} ÷ 좌석 ${m.seatsApprox} = ${Math.round(Number(m.length) / Number(m.seatsApprox))}mm/석 — `
        + '적정 간격은 용도·법정 기준에 따라 다르므로 판정하지 않는다(산출값만).'],
    };
  }
  return Object.keys(checks).length ? { ok: true, label: '카운터바 검토 (치수 자기정합)', checks } : null;
}

/**
 * 실내 부분요소 검토. 해당 메타가 없으면 **null**(이 검사의 대상이 아니다).
 * @param {object} assembly
 */
export function interiorComponentCheck(assembly) {
  if (!assembly || typeof assembly !== 'object') return null;
  if (assembly.partitionMeta) return checkPartition(assembly.partitionMeta);
  if (assembly.ceilingMeta) return checkCeiling(assembly.ceilingMeta);
  if (assembly.closetMeta) return checkCloset(assembly.closetMeta);
  if (assembly.counterMeta) return checkCounter(assembly.counterMeta);
  return null;
}
