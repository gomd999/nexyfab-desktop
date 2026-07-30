/**
 * tolerance-stack.mjs — **공차 누적(stack-up)** 검토 (260801j).
 *
 * ## 왜 필요한가
 * 끼워맞춤(`fit-check`)은 **핀 하나와 구멍 하나**를 본다. 그런데 실제로 조립이 안 맞는
 * 이유는 대개 **여러 치수가 한 방향으로 쌓여서**다 — 판 두께 + 스페이서 + 와셔 + 단차가
 * 각각은 규격 안인데 합치면 목표 틈새를 먹어 버린다. 그걸 보는 검토가 없었다.
 *
 * ## ⚠ 체인은 **선언받는다** — 형상에서 추정하지 않는다
 * 「어느 면에서 어느 면까지가 한 체인인가」는 설계 의도다. 부품이 닿아 있다고 해서 그 둘이
 * 같은 치수 체인에 있는 것이 아니다. 추정한 체인으로 낸 누적값은 **그럴듯하지만 무의미**하고,
 * 그런 숫자가 문서에 실리면 안 실리느니만 못하다. 그래서 `assembly.tolChains` 선언이
 * 없으면 **null**(해당 없음)을 돌려준다 — 「이상 없음」이 아니다.
 *
 * ## 무엇을 내는가 — 두 값을 **함께** 낸다
 *  · **최악조건(worst-case)**: 모든 치수가 동시에 한계에 있다고 본다. 항상 안전하지만 보수적.
 *  · **RSS(제곱합근)**: 통계적 합성. 훨씬 좁게 나오지만 **가정이 붙는다**(아래).
 * 어느 쪽이 옳은지는 **생산 방식**이 정하므로 우리가 고르지 않는다 — 둘 다 보이고,
 * 결론이 갈리는지를 밝힌다(조적 세장비·볼트 연단거리에서 쓴 것과 같은 규약).
 *
 * ## RSS 가 성립하려면 (전부 가정이다 — 고지한다)
 *  ① 각 치수가 **독립**이다(같은 공정에서 나온 치수는 상관될 수 있다)
 *  ② 각 치수가 공차 범위 안에서 **정규분포·중심 정렬**이다
 *  ③ 공차 폭이 **±3σ** 다(공정능력 Cp=1 가정)
 * 실제 공정이 치우쳐 있으면 RSS 는 **낙관적**이다. 그래서 RSS 만 통과하는 경우를
 * PASS 가 아니라 **CHECK**(공정 관리 전제)로 낸다.
 */

const r3 = (v) => +Number(v).toFixed(3);

/** 링크 한 개를 `{ nominal, plus, minus, dir }` 로 정규화. 못 읽으면 사유를 담아 돌려준다. */
function normLink(link, n) {
  const tag = `links[${n}]`;
  const nominal = Number(link?.nominal);
  if (!Number.isFinite(nominal)) return { error: `${tag}: nominal 이 수가 아니다` };
  // dir: +1 = 목표 틈새를 늘리는 방향, −1 = 줄이는 방향. 선언이 없으면 +1 로 두지 않는다 —
  // 방향을 우리가 정하면 부호 하나로 결론이 뒤집힌다.
  const dir = link?.dir;
  if (dir !== 1 && dir !== -1) return { error: `${tag}: dir 이 +1 또는 −1 로 선언되지 않았다(방향을 추정하지 않는다)` };
  let plus = Number(link?.plus);
  let minus = Number(link?.minus);
  if (link?.tol != null && !Number.isFinite(plus) && !Number.isFinite(minus)) {
    const t = Number(link.tol);
    if (!(t > 0)) return { error: `${tag}: tol 이 양수가 아니다` };
    plus = t; minus = t;   // 대칭 공차 ±t
  }
  if (!Number.isFinite(plus) || !Number.isFinite(minus)) {
    return { error: `${tag}: 공차가 없다 — plus/minus 또는 대칭 tol 을 선언할 것` };
  }
  if (plus < 0 || minus < 0) return { error: `${tag}: plus/minus 는 크기(양수)로 적는다` };
  if (plus === 0 && minus === 0) return { error: `${tag}: 공차가 0 이다 — 공차 없는 치수는 체인에 넣지 않는다` };
  return { label: String(link?.labelKo ?? link?.label ?? tag), nominal, plus, minus, dir };
}

/**
 * 공차 누적 검토.
 * @param {object} assembly `tolChains: [{ id, labelKo, links[], target:{nominal,min,max} }]`
 * @returns null(선언 없음 — 해당 없음) 또는 검토 결과
 */
export function toleranceStackCheck(assembly) {
  const chains = assembly?.tolChains;
  if (!Array.isArray(chains) || !chains.length) return null;

  const checks = {};
  let judged = 0;

  for (const [ci, ch] of chains.entries()) {
    const key = String(ch?.id ?? `chain${ci}`);
    const name = String(ch?.labelKo ?? ch?.label ?? key);
    const links = Array.isArray(ch?.links) ? ch.links : [];
    if (links.length < 2) {
      checks[key] = {
        labelKo: `${name} — 판정하지 않았다(링크가 ${links.length}개다)`,
        pass: null,
        needInputs: [{ name: `tolChains[${ci}].links`, labelKo: '체인을 이루는 치수 2개 이상' }],
        detail: ['누적은 **둘 이상이 쌓일 때** 성립한다. 하나뿐이면 그건 치수 공차이지 누적이 아니다.'],
      };
      continue;
    }
    const norm = links.map(normLink);
    const bad = norm.filter((x) => x.error);
    if (bad.length) {
      checks[key] = {
        labelKo: `${name} — 판정하지 않았다(선언을 읽지 못했다)`,
        pass: null,
        detail: bad.map((x) => x.error),
      };
      continue;
    }

    // 공칭 합 — dir 부호를 그대로 반영한다.
    const nom = norm.reduce((s, l) => s + l.dir * l.nominal, 0);
    /**
     * 최악조건: 각 링크가 **결과를 가장 크게/작게 만드는 쪽**으로 동시에 치우쳤다고 본다.
     * dir=+1 이면 plus 가 상한을, dir=−1 이면 minus 가 상한을 만든다(부호가 뒤집힌다).
     */
    const wcHi = norm.reduce((s, l) => s + (l.dir > 0 ? l.plus : l.minus), 0);
    const wcLo = norm.reduce((s, l) => s + (l.dir > 0 ? l.minus : l.plus), 0);
    /**
     * RSS: 각 링크의 **반폭**을 σ 척도로 합성한다. 비대칭 공차는 중심이 공칭과 다르므로
     * 중심 이동을 공칭에 반영하고 반폭으로 합성한다 — 그러지 않으면 비대칭이 조용히 사라진다.
     */
    const shift = norm.reduce((s, l) => s + l.dir * (l.plus - l.minus) / 2, 0);
    const half = norm.map((l) => (l.plus + l.minus) / 2);
    const rssHalf = Math.sqrt(half.reduce((s, h) => s + h * h, 0));
    const rssHi = shift + rssHalf, rssLo = -shift + rssHalf;

    const target = ch?.target ?? {};
    const tMin = Number(target.min), tMax = Number(target.max);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || !(tMax >= tMin)) {
      checks[key] = {
        labelKo: `${name} — 누적은 냈으나 **판정하지 않았다**(허용 범위 미선언)`,
        pass: null,
        needInputs: [{ name: `tolChains[${ci}].target`, labelKo: '결과 치수의 허용 범위 {min, max}' }],
        detail: [
          `공칭 ${r3(nom)}mm · 최악조건 ${r3(nom - wcLo)} ~ ${r3(nom + wcHi)}mm · `
          + `RSS ${r3(nom - rssLo)} ~ ${r3(nom + rssHi)}mm`,
          '**무엇을 만족해야 하는지가 선언되지 않아** 합·불을 낼 수 없다 — 수치만 낸다.',
        ],
      };
      continue;
    }

    judged += 1;
    const wcOk = nom - wcLo >= tMin && nom + wcHi <= tMax;
    const rssOk = nom - rssLo >= tMin && nom + rssHi <= tMax;
    checks[key] = {
      labelKo: `${name} — 누적 ${r3(nom - wcLo)}~${r3(nom + wcHi)}mm (허용 ${r3(tMin)}~${r3(tMax)}mm)`,
      verdict: wcOk ? 'PASS' : rssOk ? 'CHECK' : 'FAIL',
      pass: wcOk ? true : rssOk ? null : false,
      detail: [
        `링크 ${norm.length}개 · 공칭 합 ${r3(nom)}mm`,
        `**최악조건** ${r3(nom - wcLo)} ~ ${r3(nom + wcHi)}mm (폭 ${r3(wcHi + wcLo)}mm)`,
        `**RSS** ${r3(nom - rssLo)} ~ ${r3(nom + rssHi)}mm (폭 ${r3(rssHi + rssLo)}mm)`,
        wcOk
          ? '**최악조건으로도 만족한다** — 어느 개체를 뽑아도 들어간다.'
          : rssOk
            ? '**최악조건은 벗어나고 RSS 는 만족한다** — 통계적으로는 대부분 들어가지만 '
              + '**일부 개체는 안 들어간다.** 공정능력 관리와 선별이 전제되며, 아래 가정이 깨지면 이 결론도 깨진다.'
            : '**RSS 로도 벗어난다** — 공차를 조이거나 링크를 줄여야 한다.',
        // 어느 링크가 지배하는지 알려 준다 — 「어디를 조여야 하는가」가 실제 질문이다.
        `지배 링크(반폭 큰 순): ${norm.map((l, i) => ({ l, h: half[i] })).sort((a, b) => b.h - a.h).slice(0, 3)
          .map(({ l, h }) => `${l.label} ±${r3(h)}`).join(' · ')}`,
      ],
      note: 'RSS 는 ①독립 ②정규·중심정렬 ③공차폭=±3σ 가정이다. 공정이 치우쳐 있으면 **낙관적**이다.',
    };
  }

  return {
    ok: true,
    label: '공차 누적 검토 (stack-up)',
    checks,
    basis: { chains: chains.length, judged },
    notChecked: [
      {
        labelKo: '체인 구성 자체',
        messageKo: '**어느 치수가 한 체인에 속하는지는 선언받은 그대로** 썼다. 형상에서 추정하지 않는다 — '
          + '부품이 닿아 있다고 같은 체인이 아니고, 추정한 체인으로 낸 누적값은 그럴듯하지만 무의미하다.',
      },
      {
        labelKo: '공정능력(Cp·Cpk)·치우침',
        messageKo: 'RSS 는 공차폭이 ±3σ 이고 중심이 정렬됐다고 본다. **실제 공정 데이터는 선언되지 않았다** — '
          + '치우친 공정에서는 RSS 가 실제보다 좁게 나온다.',
      },
      {
        labelKo: '기하공차(GD&T)·조립 순서',
        messageKo: '평행도·직각도·위치도는 치수 공차와 별도로 쌓인다. 조립 순서·체결 토크에 따른 변형도 미반영이다.',
      },
      {
        labelKo: '온도',
        messageKo: '재질별 열팽창이 다르면 온도에서 누적이 달라진다 — 상온 기준이다.',
      },
    ],
    refs: ['최악조건 누적(산술합)', 'RSS 누적(제곱합근 — 통계 가정 명시)'],
    disclaimer: '개념 검토(비법정) — 선언된 체인 기준. 체인 구성·공정능력은 설계자가 정한다.',
  };
}
