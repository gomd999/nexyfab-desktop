/**
 * landscape-check.mjs — 조경 구조 체인 (Wave A · 조경 L1+L2).
 *
 * role 태깅 조경 어셈블리(pergola/timber_deck)에서:
 *   ① 목재 부재 검토 — 장선/서까래 최악 부재를 형상에서 파생(단면 b×h·스팬·장선간격)
 *      → timber_beam 계산기(KDS 41 50 10 허용응력×CD). 데크=활하중(표 3.2-1 용도),
 *      파고라 서까래=자중+입력 추가하중.
 *   ② 풍하중 전도 — 입력 풍압 × 측면 투영면적(AABB 합, 겹침 미공제=보수적)
 *      → 전도모멘트 vs 자중 저항모멘트 → FS(양방향 최소) + 바람쪽 기둥 앵커 소요인발력.
 *
 * 정직 원칙: 풍압은 입력(KDS 41 12 00 5장 산정은 지역·지형·중요도 의존 — 지어내지 않음).
 * 전도 FS 임계도 입력(기본 1.5 관례 — KDS에 파고라 전도 확정기준 없음, 옹벽은 2.0).
 * 자중=형상×밀도(결정론). 근사(AABB 투영·강체 전도) 전부 명시.
 */
import { runCalculator, loadStandards } from '../engineering-core/registry.mjs';
import { partVolume, DENSITY } from './structural.mjs';
import { partAabb } from './reconstruct.mjs';

const standards = loadStandards();
const G = 9.81;
const round = (v, n = 2) => +Number(v).toFixed(n);

function box(part) {
  const a = partAabb({ type: part.type, ...part.params });
  const { tx = 0, ty = 0, tz = 0 } = part.at ?? {};
  return {
    x0: a.min[0] + tx, y0: a.min[1] + ty, z0: a.min[2] + tz,
    x1: a.max[0] + tx, y1: a.max[1] + ty, z1: a.max[2] + tz,
    dx: a.max[0] - a.min[0], dy: a.max[1] - a.min[1], dz: a.max[2] - a.min[2],
  };
}
const massKg = (p) => partVolume(p.type, p.params) / 1e9 * (DENSITY[p.material ?? 'timber'] ?? DENSITY.timber);

/**
 * @param assembly pergola/timber_deck 어셈블리 (role: joist/beam/column/deck)
 * @param params {
 *   species='pine', grade=2, duration='tenYears', deflLimit=240,
 *   usage='residence_living' (데크 활하중 용도 — KDS 표 3.2-1), extraW_kNm=0 (서까래 추가하중),
 *   windPressure_kNm2 (풍하중 전도 검토 시 필수 — 미입력 시 전도 생략), fsLimit=1.5
 * }
 */
export function landscapeCheck(assembly, params = {}) {
  const parts = assembly?.parts ?? [];
  if (!parts.length) return { ok: false, error: 'assembly.parts 필요' };
  const joists = parts.filter((p) => p.role === 'joist');
  const columns = parts.filter((p) => p.role === 'column');
  const decks = parts.filter((p) => p.role === 'deck');

  const species = params.species ?? 'pine', grade = params.grade ?? 2;

  // ── ① 목재 부재 검토 (장선/서까래 대표 — 동일 단면 반복 가정, 형상 파생) ──
  let member = null;
  if (joists.length) {
    const jb = box(joists[0]);
    // 스팬 방향 = 장축(수평), 단면 = 폭(수평 단축) × 춤(dz)
    const spanIsX = jb.dx >= jb.dy;
    const L = spanIsX ? jb.dx : jb.dy;
    const b = spanIsX ? jb.dy : jb.dx;
    const h = jb.dz;
    // 장선 간격 = 인접 장선 중심 간 거리(형상 파생, 스팬 직각 방향)
    const centers = joists.map((j) => { const bb = box(j); return spanIsX ? (bb.y0 + bb.y1) / 2 : (bb.x0 + bb.x1) / 2; }).sort((a, c) => a - c);
    const spacing = centers.length > 1 ? (centers[centers.length - 1] - centers[0]) / (centers.length - 1) : L;
    // 하중: 자중(장선+분담 데크보드) + 활하중(데크일 때, 용도표) + 추가 입력
    const selfW = massKg(joists[0]) * G / 1000 / (L / 1000); // kN/m
    const deckW = decks.length ? decks.reduce((s, d) => s + massKg(d), 0) * G / 1000 / decks.length / (L / 1000) * 0 : 0; // 개별 분담은 아래 면하중으로
    const live = standards?.KDS?.loads?.liveLoad_kNm2?.[params.usage ?? 'residence_living'];
    const liveW = decks.length && live ? live.v * (spacing / 1000) : 0; // kN/m (데크 위 활하중 × 장선 분담폭)
    const deckSelfPerM2 = decks.length ? decks.reduce((s, d) => s + massKg(d), 0) * G / 1000 / ((box(decks[0]).dx / 1000) * (decks.length * (box(decks[0]).dy / 1000))) : 0;
    const deckSelfW = decks.length ? deckSelfPerM2 * (spacing / 1000) : 0;
    const w = round(selfW + deckSelfW + liveW + (Number(params.extraW_kNm) || 0), 3);
    let check = null;
    try {
      check = runCalculator('timber_beam', {
        species, grade, b: round(b, 0), h: round(h, 0), L: round(L, 0), w,
        duration: params.duration ?? 'tenYears', deflLimit: params.deflLimit ?? 240,
        // 조경(옥외)은 습윤 사용조건이 기본 — 표 3.1-8 CM 적용 (명시적 false로만 해제)
        wetService: params.wetService !== false,
      }, 'KDS');
    } catch (e) {
      check = e.code === 'INPUT_GATE' ? { verdict: 'INPUT', error: e.message } : { verdict: 'ERROR', error: e.message };
    }
    member = {
      id: joists[0].id ?? 'joist', count: joists.length,
      section: `${round(b, 0)}×${round(h, 0)}`, spanMm: round(L, 0), spacingMm: round(spacing, 0),
      load: { self_kNm: round(selfW, 3), deckSelf_kNm: round(deckSelfW, 3), live_kNm: round(liveW, 3), extra_kNm: Number(params.extraW_kNm) || 0, total_kNm: w, liveRef: decks.length && live ? `${live.label} ${live.v}kN/m² (KDS 41 12 00 표 3.2-1)` : '활하중 없음(비바닥)' },
      verdict: check?.verdict, checks: check?.checks ?? null, notes: check?.notes ?? null, error: check?.error ?? null,
      provenance: { geometry: ['단면 b×h', '스팬', '장선 간격', '자중'], user: ['수종·등급', '용도(활하중)', '추가하중', '하중기간'] },
    };
  }

  // ── ② 풍하중 전도 (강체 — 파고라 등 자립 구조) ─────────────────────────────
  let wind = null;
  const wp = Number(params.windPressure_kNm2);
  if (wp > 0 && columns.length) {
    const totalM = parts.reduce((s, p) => s + massKg(p), 0); // kg
    const W = totalM * G / 1000; // kN
    const x0 = Math.min(...parts.map((p) => box(p).x0)), x1 = Math.max(...parts.map((p) => box(p).x1));
    const y0 = Math.min(...parts.map((p) => box(p).y0)), y1 = Math.max(...parts.map((p) => box(p).y1));
    // 기둥 저면 지지 폭 (전도 팔길이) — 기둥 중심 범위
    const colXs = columns.map((c) => (box(c).x0 + box(c).x1) / 2), colYs = columns.map((c) => (box(c).y0 + box(c).y1) / 2);
    const baseX = (Math.max(...colXs) - Math.min(...colXs)) / 1000, baseY = (Math.max(...colYs) - Math.min(...colYs)) / 1000;
    const dir = (axis) => {
      // 투영면적: 각 부품 AABB의 (바람 직각 폭 × 높이) 합 — 겹침 미공제(보수적)
      let A = 0, Mza = 0;
      for (const p of parts) {
        const bb = box(p);
        const a = ((axis === 'x' ? bb.dy : bb.dx) / 1000) * (bb.dz / 1000);
        A += a; Mza += a * ((bb.z0 + bb.z1) / 2 / 1000);
      }
      const zc = A > 0 ? Mza / A : 0;
      const F = wp * A;
      const Mo = F * zc;
      const arm = (axis === 'x' ? baseX : baseY) / 2;
      const Mr = W * arm;
      return { areaM2: round(A), F_kN: round(F), zc_m: round(zc), Mo_kNm: round(Mo), Mr_kNm: round(Mr), FS: Mo > 0 ? round(Mr / Mo) : Infinity };
    };
    const dx = dir('x'), dy2 = dir('y');
    const worst = dx.FS <= dy2.FS ? { ...dx, dir: 'X풍' } : { ...dy2, dir: 'Y풍' };
    const fsLimit = Number(params.fsLimit) || 1.5;
    // 앵커 소요 인발력(부족 시): 바람쪽 기둥열이 부담 — T = (fsLimit·Mo − Mr) / base / (열당 기둥수)
    const base = worst.dir === 'X풍' ? baseX : baseY;
    const perSide = Math.max(1, Math.round(columns.length / 2));
    const deficit = fsLimit * worst.Mo_kNm - worst.Mr_kNm;
    const anchorT = deficit > 0 && base > 0 ? round(deficit / base / perSide) : 0;
    wind = {
      windPressure_kNm2: wp, totalWeight_kN: round(W),
      x: dx, y: dy2, worst: worst.dir, FS: worst.FS, fsLimit,
      pass: worst.FS >= fsLimit,
      anchorUpliftPerPost_kN: anchorT,
      fsNote: 'FS 임계=입력(기본 1.5 관례 — KDS에 파고라 전도 확정기준 없음·옹벽 기준은 2.0). 풍압=입력(KDS 41 12 00 5장 산정은 지역·지형 의존).',
      method: 'AABB 측면 투영(겹침 미공제=보수적) × 풍압 → 강체 전도. 앵커 인발=부족모멘트/지지폭/열당 기둥수(개산).',
    };
  } else if (columns.length) {
    wind = { skipped: true, note: 'windPressure_kNm2 미입력 — 전도 검토 생략(풍압을 지어내지 않음). KDS 41 12 00 5장 또는 프로젝트 기준으로 산정해 입력.' };
  }

  return {
    ok: true,
    member, wind,
    refs: ['KDS 41 50 10:2022 (허용응력·CD)', 'KDS 41 12 00:2022 표 3.2-1 (활하중)'],
    disclaimer: '개념 검토(비법정) — 단순지지·대표부재·강체전도 근사. CM(습윤)·CF·CL 미적용(v1). 실시설계는 구조기술사 검토 필요.',
  };
}

// --- self-test ---
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('landscape-check.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  // 데크: 활하중 주거 2.0
  const deck = buildAssemblyTemplate('landscape', 'timber_deck', {});
  const r1 = landscapeCheck(deck, { species: 'pine', grade: 2, usage: 'residence_living' });
  console.log('데크 장선:', r1.member.section, 'L=' + r1.member.spanMm, '@' + r1.member.spacingMm, '| w=' + r1.member.load.total_kNm + 'kN/m →', r1.member.verdict);
  // 파고라: 풍압 0.6 kN/m²
  const per = buildAssemblyTemplate('landscape', 'pergola', {});
  const r2 = landscapeCheck(per, { species: 'larch', grade: 1, windPressure_kNm2: 0.6 });
  console.log('파고라 서까래:', r2.member.section, '→', r2.member.verdict, '| 전도 FS:', r2.wind.FS, '(' + r2.wind.worst + ')', r2.wind.pass ? 'PASS' : 'FAIL — 앵커 ' + r2.wind.anchorUpliftPerPost_kN + 'kN/본');
  // 풍압 미입력 → 정직 생략
  const r3 = landscapeCheck(per, {});
  console.log('풍압 미입력:', r3.wind.skipped ? '생략(정직) ✓' : 'FAIL');
  const pass = r1.ok && r1.member.verdict && r2.ok && Number.isFinite(r2.wind.FS) && r3.wind.skipped;
  console.log(pass ? 'landscape-check self-test: PASS' : 'FAIL');
  if (!pass) process.exit(1);
}
