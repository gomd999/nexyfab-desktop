/**
 * gen-sketch.mjs — **사진/스케치 → 3D 경로용 평가셋** 생성기 (260731).
 *
 * ## 왜 만들었나
 * `intent-from-image`(사진·스케치 → CAD intent)는 **정확도를 잰 적이 한 번도 없다.**
 * 있는 테스트는 전부 배선·파싱(모의 LLM)이다 — 실제 이미지를 주고 결과를 대조한 적이 없다.
 *
 * ## ⚠️ 이것이 무엇의 대리물인지 — 과장하지 않는다
 * 정답이 붙은 **실제 부품 사진**은 없다. 그래서 파라미터를 아는 **합성 픽토리얼**을 만든다.
 * 대상 프롬프트(`imageIntentFromSketch.v1`)가 입력으로 명시한 것 중
 * 「CAD render · sketch · hand drawing」에는 해당하고, **「photo」에는 해당하지 않는다.**
 *   · 이 수치가 말하는 것   — 렌더/스케치 입력에서 형상·비율·치수를 얼마나 읽는가.
 *   · 이 수치가 말 못하는 것 — 실제 사진(그림자·재질·배경·원근)에서의 성능.
 * 실사진 성능을 이 숫자로 주장하면 안 된다.
 *
 * ## 두 체제를 나눠 만든다 — 프롬프트가 그렇게 나눠 지시하기 때문
 * ```
 *   dim   변형: 치수 표기 있음  → 프롬프트: "use them verbatim"   → 절대 mm 채점 가능
 *   plain 변형: 치수 표기 없음  → 프롬프트: "infer ... and NOTE the assumption"
 *                                → 절대 mm 은 원리상 알 수 없다. **비율**과 **가정 고지**를 본다.
 * ```
 * ⚠ `plain` 에서 절대 치수를 채점하면 **원리적으로 불가능한 것을 요구**하는 것이다.
 *   그건 모델이 아니라 채점자가 틀린 것이다.
 *
 * ## 치수 표기 크기
 * 치수선은 **14.4px 이상**으로 그린다 — 그 이하는 판독 0% 로 실측됐다
 * (`src/lib/drawing/dimensionLegibility.ts`). 알면서 못 읽을 크기로 그리면
 * 「사진 경로가 나쁘다」가 아니라 「우리가 안 읽히게 그렸다」를 재게 된다.
 *
 * usage: node gen-sketch.mjs [count=24] [seed=7]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire('C:/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new/package.json');
const sharp = require('sharp');
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, 'sketchdata');
mkdirSync(OUT, { recursive: true });

/* ── 결정론 난수 (seed 고정 — 평가셋이 실행마다 바뀌면 비교가 안 된다) ── */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const step = (r, lo, hi, st) => lo + Math.round(r() * ((hi - lo) / st)) * st;

/* ── 아이소메트릭 투영 ────────────────────────────────────────────────────
 * 표준 등각: 수평축이 ±30°. 주평면의 원은 단축/장축 = tan30° = 0.5774 인 타원이 된다.
 * ⚠ 비율이 틀리면 모델이 읽는 **비율 정답 자체가 틀어진다** — 채점 대상이므로 정확히 둔다. */
const C30 = Math.cos(Math.PI / 6), S30 = Math.sin(Math.PI / 6);
const ISO_MINOR = Math.tan(Math.PI / 6);
const P = (x, y, z) => [(x - y) * C30, (x + y) * S30 - z];

/** 점 목록 → SVG polygon points 문자열 (오프셋 적용) */
const poly = (pts, ox, oy, fill) =>
  `<polygon points="${pts.map(([x, y]) => `${(x + ox).toFixed(1)},${(y + oy).toFixed(1)}`).join(' ')}" fill="${fill}" stroke="#111" stroke-width="2.2" stroke-linejoin="round"/>`;

/** 수평면의 원 → 등각 타원 */
const isoEllipse = (cx, cy, r, ox, oy, fill) =>
  `<ellipse cx="${(cx + ox).toFixed(1)}" cy="${(cy + oy).toFixed(1)}" rx="${(r * C30).toFixed(1)}" ry="${(r * C30 * ISO_MINOR).toFixed(1)}" fill="${fill}" stroke="#111" stroke-width="2.2"/>`;

/**
 * 치수 표기 — 지시선 + 숫자.
 * ⚠ 실측 하한(14.4px)보다 짧아지면 **그리지 않고 호출측에 알린다.** 안 읽히는 표기를
 *   그려 놓고 「못 읽었다」고 채점하면, 재는 것이 판독력이 아니라 우리 렌더러가 된다.
 */
function callout(x1, y1, x2, y2, label, canvas = null) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 14.4) return { svg: '', drawn: false };
  /**
   * ⚠ 캔버스를 벗어나면 **그리지도 라벨하지도 않는다.** 잘린 숫자를 그려 놓고
   *   「못 읽었다」로 채점하면 재는 것이 판독력이 아니라 우리 배치 실수다.
   *   (실제로 lBracket 두께 표기가 오른쪽 끝에서 잘려 있었다.)
   */
  if (canvas) {
    const pad = 34; // 숫자 폭·높이 여유
    const xs = [x1, x2], ys = [y1, y2];
    if (Math.min(...xs) < pad || Math.max(...xs) > canvas.w - pad
      || Math.min(...ys) < pad || Math.max(...ys) > canvas.h - pad) return { svg: '', drawn: false };
  }
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return {
    drawn: true,
    svg: `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#c2410c" stroke-width="1.8"/>`
      + `<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3" fill="#c2410c"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3" fill="#c2410c"/>`
      + `<text x="${mx.toFixed(1)}" y="${(my - 8).toFixed(1)}" font-size="19" font-family="monospace" fill="#c2410c" text-anchor="middle">${label}</text>`,
  };
}

const FACE = { top: '#f4f4f2', left: '#dcdcd6', right: '#c9c9c2' };

/**
 * 프로파일을 y 방향으로 밀어낸 **속찬 형상**을 면 목록으로 만든다.
 *
 * ⚠ 처음엔 앞·뒤 프로파일과 윗면 몇 장만 그렸다가 **uChannel 이 속이 비쳐 보였다** —
 *   압출 측면(각 변이 만드는 사각면)을 안 그렸기 때문이다. 그림이 형상으로 안 보이면
 *   재는 것은 모델의 판독력이 아니라 **우리 그림 실력**이다.
 * ⚠ 화가 알고리즘: 등각 투영의 시선축은 (1,1,1) 이므로 `x+y+z` 가 클수록 앞이다.
 *   먼 면부터 그린다 — 순서를 틀리면 뒷면이 앞면을 덮는다.
 *
 * @param profile [[x,z], …] 닫힌 다각형(스케일 적용 완료)
 * @param D 압출 길이(스케일 적용 완료)
 */
function extrudeFaces(profile, D) {
  const v = (x, y, z) => P(x, y, z);
  const out = [];
  const push = (pts3, fill) => {
    const depth = pts3.reduce((a, [x, y, z]) => a + x + y + z, 0) / pts3.length;
    out.push({ pts: pts3.map(([x, y, z]) => v(x, y, z)), fill, depth });
  };
  push(profile.map(([x, z]) => [x, D, z]), FACE.left);            // 뒷면
  for (let i = 0; i < profile.length; i++) {
    const [x1, z1] = profile[i];
    const [x2, z2] = profile[(i + 1) % profile.length];
    // 수평 변(z 동일)이 만드는 면은 위/아래를 향한다 → 밝게. 수직 변은 옆면 → 어둡게.
    const fill = Math.abs(z2 - z1) < 1e-6 ? FACE.top : FACE.right;
    push([[x1, 0, z1], [x2, 0, z2], [x2, D, z2], [x1, D, z1]], fill);
  }
  push(profile.map(([x, z]) => [x, 0, z]), FACE.top);             // 앞면
  out.sort((a, b) => a.depth - b.depth);                          // 먼 것부터
  return out.map((f) => [f.pts, f.fill]);
}

/* ── 형상별 GT 생성 + 픽토리얼 렌더 ───────────────────────────────────────
 * 대상 어휘는 `imageIntentFromSketch.v1` 화이트리스트에서 골랐다 —
 * 픽토리얼 한 장으로 **모호하지 않게** 알아볼 수 있는 것만. (구·원뿔 등 서로 헷갈리는
 * 형상은 제외 — 채점이 모델 실력이 아니라 우리 그림 실력을 재게 된다.) */
const SHAPES = {
  box: {
    gt: (r) => ({ shapeId: 'box', params: { width: step(r, 60, 200, 10), depth: step(r, 40, 140, 10), height: step(r, 20, 90, 10) } }),
    draw(p, S) {
      const { width: w, depth: d, height: h } = p;
      const [W, D, H] = [w * S, d * S, h * S];
      const v = (x, y, z) => P(x, y, z);
      return {
        faces: extrudeFaces([[0, 0], [W, 0], [W, H], [0, H]], D),
        anchors: { width: [v(0, D, 0), v(W, D, 0)], height: [v(W, D, 0), v(W, D, H)], depth: [v(W, 0, 0), v(W, D, 0)] },
      };
    },
  },
  cylinder: {
    gt: (r) => ({ shapeId: 'cylinder', params: { diameter: step(r, 30, 120, 10), height: step(r, 40, 160, 10) } }),
    draw(p, S) {
      const R = (p.diameter / 2) * S, H = p.height * S;
      return { cyl: { R, H, bore: 0 }, anchors: { diameter: 'dia', height: 'h' } };
    },
  },
  pipe: {
    gt: (r) => {
      const od = step(r, 50, 140, 10);
      return { shapeId: 'pipe', params: { outerDiameter: od, innerDiameter: od - step(r, 10, 30, 5) * 2, length: step(r, 60, 200, 10) } };
    },
    draw(p, S) {
      const R = (p.outerDiameter / 2) * S, H = p.length * S;
      return { cyl: { R, H, bore: (p.innerDiameter / 2) * S }, anchors: { outerDiameter: 'dia', length: 'h' } };
    },
  },
  washer: {
    gt: (r) => {
      const od = step(r, 30, 90, 5);
      return { shapeId: 'washer', params: { outerDiameter: od, innerDiameter: Math.round(od * 0.45 / 5) * 5, thickness: step(r, 2, 8, 1) } };
    },
    draw(p, S) {
      const R = (p.outerDiameter / 2) * S, H = p.thickness * S;
      return { cyl: { R, H, bore: (p.innerDiameter / 2) * S }, anchors: { outerDiameter: 'dia', thickness: 'h' } };
    },
  },
  lBracket: {
    gt: (r) => ({ shapeId: 'lBracket', params: { width: step(r, 60, 160, 10), height: step(r, 60, 160, 10), depth: step(r, 30, 90, 10), thickness: step(r, 5, 12, 1) } }),
    draw(p, S) {
      const { width: w, height: h, depth: d, thickness: t } = p;
      const [W, H, D, T] = [w * S, h * S, d * S, t * S];
      const v = (x, y, z) => P(x, y, z);
      // L 단면(수평 다리 + 수직 다리)을 y 방향으로 D 만큼 밀어낸 형상
      const prof = [[0, 0], [W, 0], [W, T], [T, T], [T, H], [0, H]];
      return {
        faces: extrudeFaces(prof, D),
        anchors: { width: [v(0, 0, 0), v(W, 0, 0)], height: [v(0, 0, 0), v(0, 0, H)], thickness: [v(W, 0, 0), v(W, 0, T)] },
      };
    },
  },
  uChannel: {
    gt: (r) => ({ shapeId: 'uChannel', params: { width: step(r, 50, 120, 10), height: step(r, 40, 100, 10), webThickness: step(r, 4, 10, 1), flangeThickness: step(r, 4, 10, 1), length: step(r, 100, 260, 20) } }),
    draw(p, S) {
      const { width: w, height: h, webThickness: wt, length: L } = p;
      const [W, H, T, D] = [w * S, h * S, wt * S, L * S];
      const v = (x, y, z) => P(x, y, z);
      const prof = [[0, 0], [W, 0], [W, H], [W - T, H], [W - T, T], [T, T], [T, H], [0, H]];
      return {
        faces: extrudeFaces(prof, D),
        anchors: { width: [v(0, 0, 0), v(W, 0, 0)], height: [v(0, 0, 0), v(0, 0, H)], length: [v(W, 0, 0), v(W, D, 0)] },
      };
    },
  },
};

/** 원통형(원기둥·파이프·와셔) 공통 렌더 */
function drawCyl({ R, H, bore }, ox, oy) {
  const ry = R * C30 * ISO_MINOR;
  const cxTop = 0, cyTop = -H;
  let s = '';
  // 몸통(옆면) — 위·아래 타원을 잇는 사각 + 하단 타원
  s += isoEllipse(0, 0, R, ox, oy, FACE.left);
  s += `<path d="M${(ox - R * C30).toFixed(1)},${(oy + cyTop).toFixed(1)} L${(ox - R * C30).toFixed(1)},${oy.toFixed(1)} A${(R * C30).toFixed(1)},${ry.toFixed(1)} 0 0 0 ${(ox + R * C30).toFixed(1)},${oy.toFixed(1)} L${(ox + R * C30).toFixed(1)},${(oy + cyTop).toFixed(1)} Z" fill="${FACE.right}" stroke="#111" stroke-width="2.2"/>`;
  s += isoEllipse(cxTop, cyTop, R, ox, oy, FACE.top);
  if (bore > 0) s += isoEllipse(cxTop, cyTop, bore, ox, oy, '#8f8f88');
  return s;
}

/**
 * 사진 조건 열화 — **실사진이 아니다.** 실사진과 합성 렌더 사이의 차이 중
 * 우리가 **재현할 수 있는 것만** 입힌다:
 *   원근 기울임 · 방향성 조명(밝기 기울기) · 배경 얼룩 · 센서 잡음 · 흐림 · JPEG 압축
 * 재현하지 **못하는** 것: 재질 반사·그림자·초점 흐림·잡다한 배경 물체.
 *
 * ⚠ 그러므로 이 버킷의 수치는 「사진에서의 성능」이 아니라
 *   **「이미지가 깨끗하지 않을 때 성능이 유지되는가」**다. 두 질문은 다르고,
 *   섞어 말하면 실사진 성능을 주장하는 셈이 된다.
 * ⚠ GT 는 그대로다 — 열화는 기하를 바꾸지 않는다(기울임은 ±2° 로 제한).
 */
async function photoify(pngBuf, r) {
  const shear = (r() - 0.5) * 0.06;          // 원근 대용 — 약한 전단
  const angle = (r() - 0.5) * 4;             // ±2°
  const bright = 0.88 + r() * 0.24;
  const q = 62 + Math.floor(r() * 18);
  const img = sharp(pngBuf);
  const { width, height } = await img.metadata();
  // 방향성 조명: 대각 그라디언트를 곱하기 합성
  const grad = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0%" stop-color="#ffffff" stop-opacity="0.0"/>`
    + `<stop offset="100%" stop-color="#000000" stop-opacity="0.28"/></linearGradient></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#g)"/></svg>`,
  );
  return sharp(pngBuf)
    .composite([{ input: grad, blend: 'over' }])
    .affine([[1, shear], [0, 1]], { background: '#efeeea' })
    .rotate(angle, { background: '#efeeea' })
    .modulate({ brightness: bright })
    .blur(0.7)
    .jpeg({ quality: q })
    .toBuffer()
    .then((b) => sharp(b).png().toBuffer());
}

const N = Number(process.argv[2] ?? 24);
const SEED = Number(process.argv[3] ?? 7);
const r = rng(SEED);
const names = Object.keys(SHAPES);
const manifest = [];

for (let i = 0; i < N; i++) {
  const key = names[i % names.length];
  // 짝수 인덱스 = 치수 표기 있음(dim), 홀수 = 없음(plain) — 두 체제를 같은 수로 만든다.
  const variant = i % 2 === 0 ? 'dim' : 'plain';
  const gt = SHAPES[key].gt(r);
  const name = `${key}-${String(i).padStart(2, '0')}-${variant}`;

  /**
   * 배율·위치는 **그림에서 역산**한다.
   * ⚠ 처음엔 배율과 오프셋을 고정값으로 뒀다가 **형상이 캔버스 밖으로 잘렸다.**
   *   등각 투영은 높이가 `H + (W+D)·sin30°` 로 늘어나 원본 치수와 화면 크기가 비례하지
   *   않는다. 잘린 그림으로 재면 「모델이 못 읽는다」가 아니라 **우리가 안 보여 준 것**이다.
   */
  const W = 640, Hpx = 520;
  const MARGIN = 96; // 치수 지시선·숫자가 나갈 여유(형상 바깥에 배치되므로 넉넉히)
  const bounds = (sh) => {
    if (sh.cyl) {
      const { R, H } = sh.cyl;
      const rx = R * C30, ry = rx * ISO_MINOR;
      return { x0: -rx, x1: rx, y0: -H - ry, y1: ry };
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [pts] of sh.faces) for (const [x, y] of pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, x1, y0, y1 };
  };
  // ① 단위 배율로 그려 실제 등각 크기를 잰다 → ② 캔버스에 맞는 배율을 정한다.
  const probe = bounds(SHAPES[key].draw(gt.params, 1));
  const S = Math.min((W - 2 * MARGIN) / (probe.x1 - probe.x0), (Hpx - 2 * MARGIN) / (probe.y1 - probe.y0));
  /**
   * ★260731 — **그림이 GT 를 배신하지 않게 한다.**
   *
   * 처음엔 얇은 치수를 `Math.max(8, t*S)` 로 **화면에서만** 두껍게 그렸다. 그러면
   * 그림이 보여 주는 비율과 정답 비율이 **달라진다** — 그 상태로 「모델이 얇은 피처를
   * 과소 판독한다」고 적을 뻔했다. 실제로는 우리가 다른 그림을 보여 주고 원래 숫자로
   * 채점한 것이다. **측정 도구를 먼저 의심한다**는 규약이 또 맞았다.
   *
   * 해법은 그림을 왜곡하는 게 아니라 **GT 를 그림이 표현 가능한 값으로 올리는 것**이다.
   * ⚠ 값을 올린 뒤 **그 값을 정답으로 쓴다** — 올리기 전 값으로 채점하면 같은 배신이다.
   */
  const MIN_FEATURE_PX = 10;
  for (const k of ['thickness', 'webThickness', 'flangeThickness']) {
    if (typeof gt.params[k] !== 'number') continue;
    const need = MIN_FEATURE_PX / S;
    if (gt.params[k] < need) gt.params[k] = Math.ceil(need);
  }
  const shape = SHAPES[key].draw(gt.params, S);
  const b = bounds(shape);
  const ox = (W - (b.x1 - b.x0)) / 2 - b.x0;
  const oy = (Hpx - (b.y1 - b.y0)) / 2 - b.y0;

  let body = '';
  if (shape.cyl) {
    body += drawCyl(shape.cyl, ox, oy);
  } else {
    for (const [pts, fill] of shape.faces) body += poly(pts, ox, oy, fill);
  }

  // 치수 표기 — dim 변형에만. 어느 치수를 표기했는지 GT 에 남긴다(채점 분모).
  const labeled = [];
  if (variant === 'dim') {
    const canvas = { w: W, h: Hpx };
    if (shape.cyl) {
      const { R, H } = shape.cyl;
      const rx = R * C30, ry = rx * ISO_MINOR;
      const dKey = key === 'cylinder' ? 'diameter' : 'outerDiameter';
      const hKey = key === 'washer' ? 'thickness' : (key === 'pipe' ? 'length' : 'height');
      // ⌀ 표기는 **형상 위쪽 바깥**에 — 타원 위에 겹치면 숫자와 윤곽선이 섞인다.
      const dy = oy - H - ry - 26;
      const c1 = callout(ox - rx, dy, ox + rx, dy, `⌀${gt.params[dKey]}`, canvas);
      const c2 = callout(ox + rx + 34, oy - H, ox + rx + 34, oy, `${gt.params[hKey]}`, canvas);
      if (c1.drawn) { body += c1.svg; labeled.push(dKey); }
      if (c2.drawn) { body += c2.svg; labeled.push(hKey); }
    } else {
      for (const [k, seg] of Object.entries(shape.anchors)) {
        if (!Array.isArray(seg)) continue;
        const [[x1, y1], [x2, y2]] = seg;
        const c = callout(x1 + ox, y1 + oy + 26, x2 + ox, y2 + oy + 26, String(gt.params[k]), canvas);
        if (c.drawn) { body += c.svg; labeled.push(k); }
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hpx}" viewBox="0 0 ${W} ${Hpx}">`
    + `<rect width="${W}" height="${Hpx}" fill="#fbfbf9"/>${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const meta = {
    ...gt,
    variant,
    // ⚠ `dim` 인데 표기가 하나도 안 그려졌으면 그 케이스는 사실상 `plain` 이다 — 숨기지 않는다.
    labeledParams: labeled,
    unit: 'mm',
  };
  writeFileSync(join(OUT, `${name}.png`), png);
  writeFileSync(join(OUT, `${name}.gt.json`), JSON.stringify({ ...meta, condition: 'clean' }, null, 1));
  // 같은 GT · 같은 그림에 사진 조건만 입힌 짝 — 조건 변수를 분리해 잰다.
  writeFileSync(join(OUT, `${name}-photo.png`), await photoify(png, r));
  writeFileSync(join(OUT, `${name}-photo.gt.json`), JSON.stringify({ ...meta, condition: 'photo' }, null, 1));
  manifest.push({ name, shapeId: gt.shapeId, variant, labeled: labeled.length });
}

const dims = manifest.filter((m) => m.variant === 'dim');
console.log(`생성 ${manifest.length * 2}장(깨끗 ${manifest.length} + 사진조건 ${manifest.length}) → ${OUT}`);
console.log(`  치수표기 있음(dim) ${dims.length}장 — 그중 표기가 실제로 그려진 것 ${dims.filter((m) => m.labeled > 0).length}장`);
console.log(`  치수표기 없음(plain) ${manifest.length - dims.length}장`);
for (const k of names) console.log(`   ${k.padEnd(10)} ${manifest.filter((m) => m.shapeId === k).length}장`);
