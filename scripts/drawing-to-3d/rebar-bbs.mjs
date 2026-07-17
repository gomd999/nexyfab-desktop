/**
 * rebar-bbs.mjs — 옹벽 배근 물량표(BBS, Wave 3 v1, 260717)
 *
 * 정직 경계: 배근(dia·간격)은 **입력 원칙**(자동 설계 아님 — 확정=구조기술자).
 * 이 모듈은 입력 배근 × 형상(단일 소스 alignment/retainingWall)에서 결정론 물량만 산출.
 * 미포함(전부 명시): 정착·이음·갈고리·스페이서·개구(암거 분절) 공제 — 총연장 기준 근사.
 * 단중 = KS D 3504 공칭(kg/m, 공표 표준값).
 */

export const KSD3504_UNIT_KG_M = { 10: 0.560, 13: 0.995, 16: 1.560, 19: 2.250, 22: 3.040, 25: 3.980, 29: 5.040, 32: 6.230 };

const num = (v) => Number(v);
const okBar = (b) => b && Number.isFinite(num(b.dia)) && KSD3504_UNIT_KG_M[num(b.dia)] != null && num(b.spacingMm) >= 50 && num(b.spacingMm) <= 600;

/**
 * @param rw retainingWall(m 단위: H·stemThickness·baseWidth·baseThickness·length)
 * @param rebar { stemVert:{dia,spacingMm}, stemHor:{dia,spacingMm}, baseMain:{dia,spacingMm}, baseDist:{dia,spacingMm}, coverMm? }
 * @returns { ok, errors, rows, totalKg, notes } — rows: {loc,dia,spacingMm,count,lenM,totalM,unitKgM,kg}
 */
export function rebarBBS(rw, rebar) {
  const errors = [];
  if (!rw || !(num(rw.length) > 0)) return { ok: false, errors: ['retainingWall 형상 없음'], rows: [], totalKg: 0, notes: [] };
  const need = ['stemVert', 'stemHor', 'baseMain', 'baseDist'];
  for (const k of need) if (!okBar(rebar?.[k])) errors.push(`rebar.${k} 필요: {dia(D10~32 KS), spacingMm(50~600)} — 배근=입력 원칙(자동 설계 아님)`);
  if (errors.length) return { ok: false, errors, rows: [], totalKg: 0, notes: [] };
  const cover = Number.isFinite(num(rebar.coverMm)) ? num(rebar.coverMm) : 75; // KDS 흙에 접하는 면 관례 기본(명시)
  const Lmm = num(rw.length) * 1000, Hmm = num(rw.H) * 1000, tS = num(rw.stemThickness) * 1000;
  const bW = num(rw.baseWidth) * 1000, tB = num(rw.baseThickness) * 1000;
  const rows = [];
  const add = (loc, b, count, lenMm) => {
    const unit = KSD3504_UNIT_KG_M[num(b.dia)];
    const lenM = lenMm / 1000, totalM = count * lenM;
    rows.push({ loc, dia: num(b.dia), spacingMm: num(b.spacingMm), count, lenM: +lenM.toFixed(2), totalM: +totalM.toFixed(1), unitKgM: unit, kg: +(totalM * unit).toFixed(1) });
  };
  // 벽체 수직 주근(배면 1면 기준 — 면수 반영은 입력 몫, 명시): 본수=연장/간격+1, 길이=벽고+저판두께−피복2
  add('벽체 수직 주근(배면 1면)', rebar.stemVert, Math.ceil(Lmm / num(rebar.stemVert.spacingMm)) + 1, Hmm + tB - 2 * cover);
  // 벽체 수평 배력(1면): 단수=ceil((벽고−피복)/간격), 길이=연장
  add('벽체 수평 배력(1면)', rebar.stemHor, Math.ceil((Hmm - cover) / num(rebar.stemHor.spacingMm)), Lmm);
  // 저판 주근(폭방향): 본수=연장/간격+1, 길이=저판폭−피복2
  add('저판 주근(폭방향)', rebar.baseMain, Math.ceil(Lmm / num(rebar.baseMain.spacingMm)) + 1, bW - 2 * cover);
  // 저판 배력(연장방향): 단수=ceil((저판폭−피복2)/간격), 길이=연장
  add('저판 배력(연장방향)', rebar.baseDist, Math.ceil((bW - 2 * cover) / num(rebar.baseDist.spacingMm)), Lmm);
  const totalKg = +rows.reduce((s, r) => s + r.kg, 0).toFixed(1);
  return {
    ok: true, errors: [], rows, totalKg,
    notes: [
      `피복 ${cover}mm(흙접면 관례 기본 — 입력으로 대체 가능) · 벽체 t${Math.round(tS)}`,
      '미포함: 정착·이음·갈고리·스페이서·전단(스터럽)·개구(암거 분절) 공제 — 총연장 기준 근사',
      '배근 확정·상세(이음 위치·정착장)는 구조기술자 검토 필요(본 표=입력 배근의 물량 산출)',
      '단중=KS D 3504 공칭(kg/m)',
    ],
  };
}

// ── self-test: 폐형 앵커 ─────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('rebar-bbs.mjs');
if (isMain) {
  let pass = 0, fail = 0;
  const check = (nm, ok, note = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK' : 'FAIL'} ${nm}${note ? ' — ' + note : ''}`); };
  const rw = { H: 3, stemThickness: 0.3, baseWidth: 2, baseThickness: 0.4, length: 100 };
  const rb = { stemVert: { dia: 16, spacingMm: 200 }, stemHor: { dia: 13, spacingMm: 250 }, baseMain: { dia: 16, spacingMm: 200 }, baseDist: { dia: 13, spacingMm: 250 } };
  const r = rebarBBS(rw, rb);
  // 수기 검산: 수직근 본수 = 100000/200+1 = 501, 길이 = 3000+400−150 = 3250mm → 501×3.25×1.56 = 2540.1kg
  check('수직 주근 본수 501', r.rows[0].count === 501, String(r.rows[0].count));
  check('수직 주근 중량 2540.1kg', Math.abs(r.rows[0].kg - 2540.1) < 0.5, String(r.rows[0].kg));
  // 수평 배력 단수 = ceil((3000−75)/250)=12, 길이 100m → 12×100×0.995 = 1194kg
  check('수평 배력 1194kg', Math.abs(r.rows[1].kg - 1194) < 0.5, String(r.rows[1].kg));
  // 저판 주근 = 501본 × (2000−150)/1000 × 1.56 = 1446.4kg
  check('저판 주근 1446.4kg', Math.abs(r.rows[2].kg - 1446.4) < 0.6, String(r.rows[2].kg));
  // 저판 배력 단수 = ceil(1850/250)=8 → 8×100×0.995=796kg
  check('저판 배력 796kg', Math.abs(r.rows[3].kg - 796) < 0.5, String(r.rows[3].kg));
  check('총계=행 합', Math.abs(r.totalKg - r.rows.reduce((s, q) => s + q.kg, 0)) < 0.2, String(r.totalKg));
  // 게이트: 배근 미입력=정직 거부
  const g = rebarBBS(rw, { stemVert: { dia: 16, spacingMm: 200 } });
  check('배근 누락=입력 원칙 게이트', !g.ok && g.errors.length === 3);
  const g2 = rebarBBS(rw, { ...rb, stemVert: { dia: 15, spacingMm: 200 } });
  check('비 KS 호칭(D15) 거부', !g2.ok);
  console.log(`rebar-bbs self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
