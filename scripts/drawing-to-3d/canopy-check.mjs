/**
 * canopy-check.mjs — 캐노피·개방형 지붕 검토 (260729d, 계획 P1-①).
 *
 * ## 왜 필요한가
 * `steel_canopy`(37부품)는 5분야 전수 실측에서 **실판정 0** 인 4종 중 하나였다.
 * `loadPathCheck` 가 "지붕 골조형이라 슬래브→보→기둥 경로의 대상이 아니다" 라고 정직하게
 * 거부하는데, **그 대신 볼 것이 아무것도 없었다.**
 *
 * 캐노피를 지배하는 것은 중력이 아니라 **풍 상향력(uplift)** 이다. 지붕면이 크고 자중이
 * 가벼우면 통째로 들린다 — 실제 사고가 가장 많은 파괴모드다. 기존 문구도 그걸 알고
 * 있었다("캐노피·경사지붕은 **풍 상향력이 지배**하는 경우가 많으니 wind.V0 를 주고
 * 풍하중 검토를 받는 편이 낫다"). **그런데 V0 를 줘도 받을 검토가 없었다.**
 *
 * ## 지어내지 않는 것
 *  · **순압력계수 Cn** — 개방형 지붕은 상·하면에 동시에 바람이 걸려 폐쇄형 계수를 쓸 수
 *    없다. 지붕 경사·차폐·풍향에 따라 달라지므로(KDS 41 12 00 개방형 조항) **입력받는다.**
 *    임의 값을 넣으면 상향력이 통째로 근거를 잃는다.
 *  · 기본풍속 V0 — 대지 위치가 정한다(조경·벽식 검토와 같은 규약).
 *  · 앵커 사양 — 소요 인발력만 내고 앵커 선정은 하지 않는다.
 *
 * ## 형상에서 나오는 것
 *  · 지붕 투영면적 · 자중(실측 질량) · 기둥 수 · 경사각 · 처마 높이
 */
import { structuralCheck } from './structural.mjs';
import { runCalculator } from '../engineering-core/registry.mjs';

const G = 9.80665;
const r2 = (v, n = 2) => +Number(v).toFixed(n);

/** 캐노피 검토. `canopyMeta` 가 없으면 **null**(해당 없음 — 에러가 아니다). */
export function canopyCheck(assembly, params = {}) {
  const cm = assembly?.canopyMeta;
  if (!cm) return null;
  const L = Number(cm.L), W = Number(cm.W), colH = Number(cm.colH);
  const pitch = Number(cm.pitchDeg) || 0;
  const cols = (assembly.parts ?? []).filter((p) => p.role === 'column' && p.unverified !== true).length;
  if (!(L > 0) || !(W > 0)) {
    return { ok: false, label: '캐노피 검토', needInputs: [{ name: 'canopyMeta.L/W', labelKo: '캐노피 길이·폭' }] };
  }

  let mass = null;
  try { mass = structuralCheck(assembly, {}); } catch { /* 아래에서 거부 처리 */ }
  const W_kN = mass?.totalMassKg > 0 ? (mass.totalMassKg * G) / 1000 : null;
  // 투영면적 = 평면 투영(경사면적이 아니다 — 풍압은 투영면에 걸린다).
  const areaM2 = (L / 1000) * (W / 1000);

  const checks = {};
  // ── 형상 자기정합 (가정 0) ────────────────────────────────────────────────
  if (Number(cm.frames) > 1) {
    const bay = L / (Number(cm.frames) - 1);
    checks.frameSpacing = {
      labelKo: '프레임 간격 = 전장 ÷ (프레임 수 − 1)',
      pass: cols >= Number(cm.frames),   // 프레임당 최소 1본
      detail: [`전장 ${L} ÷ ${cm.frames - 1}베이 = ${Math.round(bay)}mm · 기둥 ${cols}본 / 프레임 ${cm.frames}`],
      note: '기둥이 프레임 수보다 적으면 일부 프레임이 지지되지 않는다 — 순수 계수',
    };
  }

  // ── 풍 상향력 ─────────────────────────────────────────────────────────────
  const V0 = Number(params.wind?.V0) || Number(params.V0);
  const Cn = Number(params.wind?.Cn ?? params.netPressureCoef);
  if (!(V0 > 0) || !(Cn !== 0 && Number.isFinite(Cn))) {
    checks.uplift = {
      labelKo: '풍 상향력 (캐노피 지배 하중)', pass: null,
      needInputs: [
        ...(!(V0 > 0) ? [{ name: 'wind.V0', labelKo: '기본풍속 V0 (m/s) — 대지 위치가 정한다' }] : []),
        ...(!Number.isFinite(Cn) || Cn === 0 ? [{
          name: 'wind.Cn',
          labelKo: '개방형 지붕 순압력계수 Cn (상향 −) — 지붕 경사·차폐·풍향이 정한다'
            + '(KDS 41 12 00 개방형 조항). 폐쇄형 계수를 대신 쓸 수 없다',
        }] : []),
      ],
      detail: [
        `형상은 산출했다: 투영면적 ${r2(areaM2)}㎡ · 자중 ${W_kN ? r2(W_kN, 0) + 'kN' : '미산출'}`
        + ` · 경사 ${pitch}° · 기둥 ${cols}본 · 처마높이 ${colH}mm.`,
        '**풍 상향력을 검토하지 않았다 — 캐노피의 지배 하중이다.** 자중만으로 안전하다는 뜻이 아니다.',
      ],
    };
  } else {
    // 속도압 q — wind_static 이 있으면 그 산출값을 쓰고, 실패하면 정직하게 거부한다.
    let q_kNm2 = null, qSrc = null;
    try {
      const r = runCalculator('wind_static', {
        V0, H: r2(colH / 1000, 1), B: r2(L / 1000, 1), D: r2(W / 1000, 1),
        exposure: params.wind?.exposure ?? 'C', importance: params.wind?.importance ?? '1',
        structType: 'rc_moment', demandNone: 0,
      }, 'KDS');
      // ⚠ 반환 필드명을 추측하지 말 것 — `pressure.qH_Nm2`(N/㎡)다. 처음 `qz_kNm2` 로
      //   짐작했더니 값이 안 잡혀 **상향력 판정이 통째로 조용히 빠졌다**(실측으로 확인).
      const qN = Number(r.pressure?.qH_Nm2);
      q_kNm2 = qN > 0 ? qN / 1000 : NaN;
      qSrc = `wind_static(KDS 41 12 00) 속도압 qH=${qN}N/㎡`;
    } catch (e) { void e; }
    if (!(q_kNm2 > 0)) {
      checks.uplift = {
        labelKo: '풍 상향력', pass: null,
        detail: [`속도압을 산출하지 못했다(V0=${V0}) — 풍 상향력을 판정하지 않았다.`],
      };
    } else {
      const uplift_kN = Math.abs(Cn) * q_kNm2 * areaM2;
      const resist_kN = W_kN ?? 0;
      // 자중만으로 저항(앵커 미고려) — 실무는 앵커를 두지만 그 사양이 선언돼 있지 않다.
      const fs = uplift_kN > 0 ? resist_kN / uplift_kN : null;
      const need = Math.max(0, uplift_kN - resist_kN);
      checks.uplift = {
        labelKo: `풍 상향력 vs 자중 (V0=${V0}m/s · Cn=${Cn})`,
        pass: fs !== null ? fs >= 1.5 : null,
        detail: [
          `속도압 ${r2(q_kNm2, 3)}kN/㎡ × |Cn| ${Math.abs(Cn)} × 투영 ${r2(areaM2)}㎡ = 상향력 ${r2(uplift_kN, 1)}kN`,
          `자중 저항 ${r2(resist_kN, 1)}kN → FS ${fs === null ? '—' : r2(fs)} (1.5 필요 — 조경 전도와 같은 관례값, KDS 확정 기준 아님)`,
          need > 0
            ? `**자중만으로는 ${r2(need, 1)}kN 부족하다 — 앵커 소요 인발력이다**(기둥 ${cols}본 분담 시 본당 ${r2(need / Math.max(1, cols), 1)}kN).`
            : `자중이 상향력을 ${r2(resist_kN - uplift_kN, 1)}kN 상회한다 — 앵커 없이도 들리지 않는다(전도·활동은 별도).`,
        ],
        note: `${qSrc} · 투영면적 기준(경사면적 아님) · 앵커·기초 인발저항 미고려(사양 미선언) · 부분 차폐·처마 돌출 미반영`,
      };
    }
  }

  return {
    ok: true,
    label: '캐노피 검토 (풍 상향력·프레임)',
    checks,
    basis: {
      L, W, colH, pitchDeg: pitch, frames: cm.frames ?? null, columns: cols,
      projectedAreaM2: r2(areaM2), selfWeight_kN: W_kN ? r2(W_kN, 1) : null,
    },
    disclaimer: '개념 검토(비법정) — 개방형 지붕 풍압은 형상·차폐에 민감하다. 실시설계는 구조기술사 검토 필요.',
  };
}
