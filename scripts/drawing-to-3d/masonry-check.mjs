/**
 * masonry-check.mjs — 조적 벽체 검토 (260801b).
 *
 * ## 왜 필요한가
 * `masonry_wall` 템플릿을 만들어 놓고 **판정을 하나도 붙이지 않았다.** 벽식 횡력 검토로
 * 디스패치돼 「전단벽이 아니다」로 거부됐고, 그게 맞다 — 조적은 전단벽이 아니다.
 * 그런데 그 상태로 두면 블록 99장을 쌓은 벽에 아무 검토도 없다.
 *
 * ## 무엇을 판정하는가 — 형상이 답을 가진 것만
 *  · **세장비**(높이/두께) — 조적 벽의 좌굴·전도를 지배하는 지표. 형상에서 바로 나온다.
 *  · **줄눈 두께** — KCS 41 34 02 계열 관례 8~13mm. 형상에 선언돼 있다.
 *  · **인방 지지길이** — 개구 상부 보가 양단에 얼마나 걸쳐 있는가. 형상에서 나온다.
 *  · **블록 규격 정합** — 선언 블록 치수가 KS F 4002 계열인지(정합, 합·불 아님).
 *
 * ## 지어내지 않는 것
 *  · **압축·전단 내력** — 조적 프리즘 강도(f'm)·모르타르 배합이 선언돼 있지 않다.
 *    세장비가 적합해도 하중을 못 버티면 무의미하다 — 안 했다고 적는다.
 *  · **보강 여부**(보강조적/무보강) — 철근 배치가 선언되지 않았다. 세장비 한계가
 *    보강 여부로 달라지므로, **두 기준을 함께 보고** 어느 쪽에 걸리는지 밝힌다.
 *  · **인방 단면 강도** — 개구 폭·상재하중이 필요하다(상재하중 미선언).
 *
 * ## 기준
 * KDS 41 34 00(조적구조) 계열 — 무보강 조적 벽의 세장비(h/t) 한계는 널리 **20**,
 * 보강 조적은 **30** 을 쓴다. ⚠ 원문 표 절점을 직접 파싱한 값이 아니라 통용 기준이므로
 * 그렇게 적는다(지어낸 값은 아니지만 「원문 확인」과 구별해야 한다).
 */

const r1 = (v) => +Number(v).toFixed(1);

/**
 * 조적 벽체 검토. `masonryWall` 메타가 없으면 **null**(해당 없음 — 에러가 아니다).
 * @param {object} assembly `masonryWall` 메타를 가진 어셈블리
 * @param {object} params `masonry.reinforced` (선택 — 없으면 두 기준 대조)
 */
export function masonryCheck(assembly, params = {}) {
  const m = assembly?.masonryWall;
  if (!m) return null;
  const H = Number(m.H), T = Number(m.T), L = Number(m.L);
  if (!(H > 0) || !(T > 0)) {
    return { ok: false, label: '조적 벽체 검토', needInputs: [{ name: 'masonryWall.H/T', labelKo: '벽 높이·두께' }] };
  }
  const checks = {};

  // ── ① 세장비 ──────────────────────────────────────────────────────────────
  const sr = H / T;
  const LIM_UNREINF = 20, LIM_REINF = 30;
  const reinforced = params.masonry?.reinforced;
  const lim = reinforced === true ? LIM_REINF : reinforced === false ? LIM_UNREINF : null;
  checks.slenderness = lim !== null
    ? {
      labelKo: `벽 세장비 h/t = ${r1(sr)} (한계 ${lim} — ${reinforced ? '보강조적' : '무보강조적'})`,
      pass: sr <= lim,
      detail: [`높이 ${H}mm ÷ 두께 ${T}mm = ${r1(sr)}`],
    }
    : {
      // ⚠ 보강 여부를 우리가 정하지 않는다 — 두 기준을 함께 보고 결론이 갈리는지 본다.
      labelKo: `벽 세장비 h/t = ${r1(sr)} — 보강 여부 미선언(두 기준 대조)`,
      verdict: sr <= LIM_UNREINF ? 'PASS' : sr <= LIM_REINF ? 'CHECK' : 'FAIL',
      pass: sr <= LIM_UNREINF ? true : sr <= LIM_REINF ? null : false,
      detail: [
        `높이 ${H}mm ÷ 두께 ${T}mm = **${r1(sr)}** · 무보강 한계 ${LIM_UNREINF} · 보강 한계 ${LIM_REINF}`,
        sr <= LIM_UNREINF
          ? '**두 기준 모두 만족한다** — 보강 여부를 몰라도 결론이 갈리지 않는다.'
          : sr <= LIM_REINF
            ? '**결론이 보강 여부에 달렸다** — 보강조적이면 적합, 무보강이면 미달이다. '
              + '`masonry.reinforced` 를 선언해야 확정된다.'
            : '**어느 기준으로도 미달이다** — 두께를 늘리거나 중간 지지(횡보강·부축벽)가 필요하다.',
      ],
      note: 'KDS 41 34 00 계열 통용 한계값 — 원문 표 절점을 직접 파싱한 값이 아니다. 상하 지지조건(핀·고정)은 미반영.',
    };

  // ── ② 줄눈 두께 ───────────────────────────────────────────────────────────
  const joint = Number(m.joint);
  if (joint > 0) {
    const LO = 8, HI = 13;
    checks.jointThickness = {
      labelKo: `줄눈 두께 ${joint}mm (관례 ${LO}~${HI}mm)`,
      pass: joint >= LO && joint <= HI,
      detail: [
        joint < LO ? `**${LO}mm 미만이다** — 모르타르가 충분히 채워지지 않아 부착이 약해진다.`
          : joint > HI ? `**${HI}mm 초과다** — 줄눈이 두꺼우면 압축강도가 떨어지고 침하가 커진다.`
            : '관례 범위 안이다.',
      ],
      note: 'KCS 41 34 02 계열 관례값 — 프로젝트 시방 확인 필요.',
    };
  }

  // ── ③ 인방 지지길이 ───────────────────────────────────────────────────────
  const opW = Number(m.openingW) || 0;
  if (opW > 0) {
    const lintel = (assembly.parts ?? []).find((p) => p.role === 'beam' && /lintel/i.test(String(p.id ?? '')));
    if (lintel) {
      const lw = Number(lintel.params?.width);
      const bearing = (lw - opW) / 2;   // 양단 걸침 길이
      const NEED = Math.max(100, opW * 0.1);   // 관례: 개구 폭의 10% 이상, 최소 100mm
      checks.lintelBearing = {
        labelKo: `인방 지지길이 양단 ${r1(bearing)}mm (개구 ${opW}mm)`,
        pass: bearing >= NEED,
        detail: [
          `인방 전장 ${lw}mm − 개구 ${opW}mm = 양단 합 ${r1(lw - opW)}mm → 편단 ${r1(bearing)}mm`,
          `필요 ${r1(NEED)}mm(개구 폭의 10% 또는 최소 100mm 중 큰 값 — 관례)`,
          bearing >= NEED ? '지지길이가 확보된다.' : '**지지길이 부족** — 인방 단부가 조적을 파괴하며 밀려 내려앉을 수 있다.',
        ],
        note: '지지길이 관례 기준이며 원문 표 절점이 아니다. **인방 단면 강도는 상재하중 미선언으로 미검토.**',
      };
    } else {
      checks.lintelBearing = {
        labelKo: '인방 지지길이 — 판정하지 않았다(인방 부재가 형상에 없다)', pass: null,
        needInputs: [{ name: "parts[role='beam', id~lintel]", labelKo: '개구 상부 인방 부재' }],
        detail: [`개구 ${opW}mm 가 선언됐는데 **인방이 형상에 없다** — 개구 상부 조적은 자립하지 못한다.`],
      };
    }
  }

  // ── ④ 블록 규격 정합 (형상 자기정합) ──────────────────────────────────────
  const bl = Number(m.blockL), bh = Number(m.blockH);
  if (bl > 0 && bh > 0) {
    const KS = [[390, 190], [190, 90], [390, 100], [390, 150]];
    const near = KS.some(([a, b]) => Math.abs(bl - a) <= 5 && Math.abs(bh - b) <= 5);
    checks.blockSpec = {
      labelKo: `블록 규격 ${bl}×${bh}mm — KS F 4002 계열 정합 (형상 자기정합, 안전 판정 아님)`,
      kind: 'self-consistency',
      ok: near,
      detail: [
        near ? 'KS F 4002 기본블록 계열 치수와 일치한다(±5mm).'
          : `KS F 4002 계열(390×190 · 190×90 등)과 다르다 — 특수 규격이면 **수급 가능성**을 확인해야 한다.`,
        `단 ${m.rows}단 × 열 ${m.cols} · 블록 ${m.blocks}장` + (m.skipped ? ` · 상한 초과 미생성 ${m.skipped}장` : ''),
      ],
    };
  }

  return {
    ok: true,
    label: '조적 벽체 검토 (세장비·줄눈·인방)',
    checks,
    basis: { H, T, L, joint, rows: m.rows, blocks: m.blocks, openingW: opW },
    notChecked: [
      {
        labelKo: '조적 압축·전단 내력 (KDS 41 34 00)',
        messageKo: '**조적 프리즘 강도 f′m·모르타르 배합·상재하중이 선언되지 않아** 내력을 판정할 수 없다. '
          + '세장비가 적합해도 **하중을 못 버티면 무의미하다.**',
      },
      {
        labelKo: '보강 여부 (세장비 한계를 정한다)',
        messageKo: '무보강 20 과 보강 30 이 다르다. `masonry.reinforced` 가 선언되면 위 판정이 확정된다.',
      },
      {
        labelKo: '인방 단면 강도',
        messageKo: '개구 상부 상재하중이 선언되지 않아 인방 휨·전단은 검토하지 않았다(지지길이만 봤다).',
      },
    ],
    refs: ['KDS 41 34 00 (조적구조 — 세장비)', 'KCS 41 34 02 계열 (줄눈 두께 관례)', 'KS F 4002 (콘크리트 기본블록)'],
    disclaimer: '개념 검토(비법정) — 형상 파생 치수 기준. 내력·보강 설계는 미검토. 실시설계는 구조기술사 검토 필요.',
  };
}
