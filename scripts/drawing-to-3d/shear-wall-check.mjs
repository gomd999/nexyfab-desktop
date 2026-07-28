/**
 * shear-wall-check.mjs — 벽식 구조 횡력 검토 (260729).
 *
 * ## 왜 이제야
 * `shear_wall` 계산기(전단벽 횡강성·분담, KDS 14 20 22 §4.9 원문식까지 구현)는
 * **어디서도 호출되지 않았다.** 그러는 사이 building 도메인의 벽식 3종(물탱크·승강로·
 * 박공집)은 라멘 전용 `loadPathCheck` 로 넘어가 "해당 없음"으로 침묵했다.
 * 있는 검사가 노는 동안 적용 대상이 검토를 못 받는 구조였다 — `stairCheck` 와 같은 자리.
 *
 * ## 지어내지 않는 것과 파생하는 것
 *  파생한다(형상에 있다):
 *   · 벽 길이 lw · 두께 t · 높이 h — 부재 치수 그대로
 *   · 방향(X/Y) — 긴 변이 향하는 축. 전단벽은 강축으로만 저항하므로 **방향별로 나눠 본다**
 *   · 총중량 W — structuralCheck 의 실측 질량
 *   · 전체높이 hn — 벽 상단 − 벽 하단
 *  거부한다(형상에서 알 수 없다):
 *   · 반응수정계수 R — 구조시스템이 정한다
 *   · 기본풍속 V0 — 대지 위치가 정한다
 *   둘 다 없으면 층전단력이 없고, 층전단력이 없으면 분담을 계산할 수 없다.
 *
 * ## 밑면전단에 쓰는 근사와 그 정당성
 * seismic_static 은 층별 heightsM·weightsKN 을 받는다. 벽식은 층 구분이 선언돼 있지 않아
 * **전 질량을 전체높이 한 점에 집중**시켜 넣는다. ⚠ 이 근사는 **밑면전단 V 에는 영향이
 * 없다** — V = Cs·W 이고 Cs 는 주기 T(=Ct·hn^x)와 총중량만으로 정해지기 때문이다.
 * 영향을 받는 것은 층별 Fx 분포뿐이라, 그 분포는 **산출하지도 보고하지도 않는다.**
 *
 * ⚠ 비법정 개산. 강막(rigid diaphragm) 가정이고 비틀림·개구부 저감·연결보는 보지 않는다.
 */
import { structuralCheck } from './structural.mjs';
import { runCalculator } from '../engineering-core/registry.mjs';

const G = 9.80665;

/** 회전을 반영한 수평 치수. rz 90°/270° 면 width↔depth 가 바뀐다. */
function planDims(p) {
  const w = Number(p.params?.width), d = Number(p.params?.depth);
  if (!(w > 0) || !(d > 0)) return null;
  const rz = ((Number(p.at?.rz ?? 0) % 180) + 180) % 180;
  const swap = Math.abs(rz - 90) < 1;
  return swap ? { dx: d, dy: w } : { dx: w, dy: d };
}

/**
 * 벽식 횡력 검토. 벽이 없으면 **null**(해당 없음 — 에러가 아니다).
 * @param {object} assembly
 * @param {{seismic?:{R:number,zone?:string,siteClass?:string,importance?:string},wind?:{V0:number,exposure?:string},fck?:number}} params
 */
export function shearWallCheck(assembly, params = {}) {
  const parts = (assembly?.parts ?? []).filter((p) => p.role === 'wall' && p.unverified !== true);
  if (!parts.length) return null; // 벽이 없다 = 이 검토 대상이 아니다

  // 횡력저항 요소 = **가장 높은 벽과 같은 높이로 서는 벽**. 층별 조각벽(박공 삼각·문틀
  // 상부 등)은 전 높이를 관통하지 않으므로 캔틸레버 전단벽으로 세지 않는다.
  // (임의 임계가 아니라 "최대 높이와 같다"는 동치 판정이다)
  const withH = parts.map((p) => ({ p, h: Number(p.params?.height), dims: planDims(p) }))
    .filter((x) => x.h > 0 && x.dims);
  if (!withH.length) {
    return { ok: false, label: '벽식 횡력 검토', needInputs: [{ name: 'wall.params', labelKo: '벽 길이·두께·높이' }] };
  }
  const maxH = Math.max(...withH.map((x) => x.h));
  const lateral = withH.filter((x) => x.h >= maxH - 1e-6);
  const partial = withH.length - lateral.length;

  const baseZ = Math.min(...lateral.map((x) => Number(x.p.at?.tz ?? 0)));
  const hnM = (baseZ + maxH) / 1000; // 벽 상단 높이 m

  // 방향별 분리 — 전단벽은 강축(긴 변)으로만 저항한다.
  const byDir = { X: [], Y: [] };
  for (const x of lateral) {
    const { dx, dy } = x.dims;
    const dir = dx >= dy ? 'X' : 'Y';
    byDir[dir].push({ id: x.p.id ?? x.p.type, lw_mm: Math.max(dx, dy), t_mm: Math.min(dx, dy), h_mm: x.h });
  }

  // ── 층전단력 확보 (없으면 정직 거부) ───────────────────────────────────────
  let mass = null;
  try { mass = structuralCheck(assembly, {}); } catch { /* 질량 실패는 아래에서 거부로 처리 */ }
  const W_kN = mass?.totalMassKg > 0 ? (mass.totalMassKg * G) / 1000 : null;

  const sources = [];
  const sp = params.seismic;
  if (W_kN && sp && Number(sp.R) > 0) {
    try {
      const seis = runCalculator('seismic_static', {
        zone: sp.zone ?? 'I', siteClass: sp.siteClass ?? 'S4', importance: sp.importance ?? 'grade2',
        R: Number(sp.R), structType: sp.structType ?? 'rc_moment',
        ...(Number(sp.S) > 0 ? { S: Number(sp.S) } : {}),
        heightsM: [+hnM.toFixed(2)], weightsKN: [+W_kN.toFixed(1)],
      }, 'KDS');
      sources.push({ kind: '지진(KDS 41 17 00 등가정적)', V_kN: seis.storyShear_kN[0], detail: seis });
    } catch (e) { sources.push({ kind: '지진', error: String(e?.message ?? e).slice(0, 120) }); }
  }
  const wp = params.wind;
  if (wp && Number(wp.V0) > 0) {
    try {
      const xs = lateral.map((x) => Number(x.p.at?.tx ?? 0));
      const ys = lateral.map((x) => Number(x.p.at?.ty ?? 0));
      const B = (Math.max(...xs) - Math.min(...xs)) / 1000 || hnM;
      const D = (Math.max(...ys) - Math.min(...ys)) / 1000 || hnM;
      const r = runCalculator('wind_static', {
        V0: Number(wp.V0), H: +hnM.toFixed(1), B: +Math.max(B, 1).toFixed(1), D: +Math.max(D, 1).toFixed(1),
        exposure: wp.exposure ?? 'C', importance: wp.importance ?? '1', structType: 'rc_moment', demandNone: 0,
      }, 'KDS');
      sources.push({ kind: '풍(KDS 41 12 00)', V_kN: r.baseShear_kN, detail: r });
    } catch (e) { sources.push({ kind: '풍', error: String(e?.message ?? e).slice(0, 120) }); }
  }

  const usable = sources.filter((s) => Number(s.V_kN) > 0);
  if (!usable.length) {
    return {
      ok: false, label: '벽식 횡력 검토 (전단벽 강성·분담)',
      needInputs: [
        { name: 'seismic.R', labelKo: '반응수정계수 R (1~8) — 구조시스템이 정하는 값이라 형상에서 알 수 없다' },
        { name: 'wind.V0', labelKo: '기본풍속 V0 (m/s) — 대지 위치가 정하는 값이라 형상에서 알 수 없다' },
      ],
      messageKo: `전단벽 ${lateral.length}장(X ${byDir.X.length}·Y ${byDir.Y.length})을 형상에서 찾았고 총중량 `
        + `${W_kN ? W_kN.toFixed(0) + 'kN' : '미산출'}·전체높이 ${hnM.toFixed(1)}m 도 산출했습니다. `
        + '다만 층전단력이 없으면 분담을 계산할 수 없습니다 — R 또는 V0 중 하나만 주면 검토가 돕니다. '
        + '**"횡력에 안전하다"는 뜻이 아닙니다.**',
      ...(sources.length ? { attempted: sources.map((s) => `${s.kind}: ${s.error ?? '산출 실패'}`) } : {}),
    };
  }
  // 지진·풍 둘 다 있으면 **큰 쪽이 지배**한다(둘 다 보고한다 — 감추지 않는다).
  const governing = usable.reduce((a, b) => (b.V_kN > a.V_kN ? b : a));

  const checks = {};
  for (const dir of ['X', 'Y']) {
    const walls = byDir[dir];
    if (!walls.length) {
      checks[`dir${dir}`] = {
        labelKo: `${dir}방향 전단벽`, pass: null,
        detail: [`${dir}방향으로 선 전단벽이 없다 — 이 방향 횡력저항 요소를 확인해야 한다(판정하지 않음)`],
      };
      continue;
    }
    try {
      const r = runCalculator('shear_wall', {
        walls: walls.slice(0, 20).map((w) => ({ lw_mm: w.lw_mm, t_mm: w.t_mm, h_mm: w.h_mm })),
        storyShear_kN: +governing.V_kN.toFixed(1),
        ...(Number(params.fck) > 0 ? { fck: Number(params.fck) } : {}),
      }, 'KDS');
      const rows = r.walls ?? r.rows ?? [];
      const bad = rows.filter((x) => x.pass === false);
      checks[`dir${dir}`] = {
        labelKo: `${dir}방향 전단벽 ${walls.length}장 — 강성 분담·개략 전단`,
        pass: bad.length === 0,
        detail: rows.slice(0, 6).map((x, i) => `${walls[i]?.id ?? '#' + (i + 1)}: 분담 ${(x.share * 100).toFixed(1)}% · Vi ${x.Vi_kN}kN vs φVc ${x.phiVc_kN}kN (ratio ${x.ratio})`),
        note: `층전단 ${governing.V_kN.toFixed(1)}kN(${governing.kind} 지배) · 강막 가정 · 비틀림·개구부 저감 미고려`,
      };
    } catch (e) {
      checks[`dir${dir}`] = { labelKo: `${dir}방향 전단벽`, pass: null, detail: [`계산 실패: ${String(e?.message ?? e).slice(0, 100)}`] };
    }
  }
  if (partial) {
    checks.partialWalls = {
      labelKo: '전 높이 미관통 벽', pass: null,
      detail: [`${partial}장은 최대 높이(${maxH}mm)에 못 미쳐 캔틸레버 전단벽으로 세지 않았다 — 박공 조각·개구부 상부 등. 이들의 횡력 기여는 판정하지 않는다`],
    };
  }
  return {
    ok: true,
    label: '벽식 횡력 검토 (전단벽 강성·분담)',
    checks,
    basis: {
      lateralWalls: lateral.length, dirX: byDir.X.length, dirY: byDir.Y.length,
      totalWeight_kN: W_kN ? +W_kN.toFixed(1) : null, hn_m: +hnM.toFixed(2),
      storyShear_kN: +governing.V_kN.toFixed(1), governing: governing.kind,
      all: usable.map((s) => `${s.kind} ${s.V_kN.toFixed(1)}kN`),
      note: '밑면전단 V=Cs·W 는 총중량·전체높이로 정해지므로 질량 집중 근사가 V 에 영향을 주지 않는다(층별 Fx 분포는 산출하지 않음).',
    },
  };
}
