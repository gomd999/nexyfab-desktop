/**
 * reproject-diff.mjs — D1 판독 역투영 diff(260719). 도면 경로 전용.
 *
 * 추출 intent 를 정투영 실루엣으로 되그려 원본 도면 잉크와 대조:
 *   ① 잉크 연결요소 → 뷰 후보(외곽 컴포넌트 bbox) ② intent 뷰 종횡비로 후보 선택
 *   ③ 실루엣 아웃라인 표본점의 잉크 지지율(support) + 축별 스케일 잔차(왜곡)
 * 낮으면 신뢰도 강등 + 되묻기 문구 — 판독을 "그럴듯함"에서 "재투영 검증됨"으로.
 *
 * 정직 한계(명시): 균일 배율 오류(전 치수 ×k)는 bbox 맞춤이 흡수 — 인쇄 치수문자
 * 잔차는 T3(DXF 치수 엔티티 결정론 판독)의 몫. 사진/음영 이미지는 대상 외(도면만).
 * 코어는 의존성 0(그레이스케일 버퍼 입력) — 웹=클라 캔버스 ImageData, CLI/테스트=sharp 로더.
 */

const SUPPORT_MIN = 0.6;      // 아웃라인 표본 잉크 지지율 하한
const RESIDUAL_MAX = 0.08;    // 축별 스케일 괴리 상한(8%)
const INK_THRESHOLD = 160;    // 그레이 < 160 = 잉크
const DILATE_R = 3;           // 지지 판정 반경(px) — 선폭·AA 여유

/** 잉크 마스크 + 반경 r 팽창 지지 마스크. gray={data,width,height} (0=검정). */
function inkMasks(gray) {
  const { data, width: w, height: h } = gray;
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ink[i] = data[i] < INK_THRESHOLD ? 1 : 0;
  const sup = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink[y * w + x]) continue;
      const x0 = Math.max(0, x - DILATE_R), x1 = Math.min(w - 1, x + DILATE_R);
      const y0 = Math.max(0, y - DILATE_R), y1 = Math.min(h - 1, y + DILATE_R);
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) sup[yy * w + xx] = 1;
    }
  }
  return { ink, sup, w, h };
}

/** 잉크 연결요소(4방향) bbox — 최소 40px 변만(문자 글리프 배제). */
function components({ ink, w, h }) {
  const lab = new Int32Array(w * h);
  const out = [];
  const stack = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (!ink[i] || lab[i]) continue;
    next++;
    let bx0 = w, bx1 = 0, by0 = h, by1 = 0, area = 0;
    stack.length = 0; stack.push(i); lab[i] = next;
    while (stack.length) {
      const q = stack.pop();
      const qx = q % w, qy = (q / w) | 0;
      area++;
      if (qx < bx0) bx0 = qx; if (qx > bx1) bx1 = qx;
      if (qy < by0) by0 = qy; if (qy > by1) by1 = qy;
      if (qx > 0 && ink[q - 1] && !lab[q - 1]) { lab[q - 1] = next; stack.push(q - 1); }
      if (qx < w - 1 && ink[q + 1] && !lab[q + 1]) { lab[q + 1] = next; stack.push(q + 1); }
      if (qy > 0 && ink[q - w] && !lab[q - w]) { lab[q - w] = next; stack.push(q - w); }
      if (qy < h - 1 && ink[q + w] && !lab[q + w]) { lab[q + w] = next; stack.push(q + w); }
    }
    // 장축 ≥40(문자 글리프 배제) + 단축 ≥8(얇은 정면 뷰 허용 — D2 260719b: 40/40이 박판
    // 정면도를 걸러 멀티뷰 대조가 불가능했음)
    if (Math.max(bx1 - bx0, by1 - by0) >= 40 && Math.min(bx1 - bx0, by1 - by0) >= 8) out.push({ x0: bx0, y0: by0, x1: bx1, y1: by1, area });
  }
  return out;
}

/** intent → 뷰별 실루엣(mm): outline 세그먼트/원 목록 + 외형 치수. */
function silhouettes(intent) {
  const p = intent;
  const views = [];
  const rect = (w, h) => ({ kind: 'rect', w, h });
  switch (p.type) {
    case 'flange': {
      const circles = [{ cx: 0, cy: 0, r: p.outerDia / 2 }, { cx: 0, cy: 0, r: p.boreDia / 2 }];
      views.push({ view: 'top', w: p.outerDia, h: p.outerDia, circles, boltRing: { n: p.boltCount, bcd: p.bcd, r: p.boltHoleD / 2 } });
      views.push({ view: 'front', w: p.outerDia, h: p.thickness, ...rect(p.outerDia, p.thickness) });
      break;
    }
    case 'plate_with_holes':
      views.push({ view: 'top', w: p.width, h: p.depth, ...rect(p.width, p.depth), holes: (p.holes ?? []).map((o) => ({ cx: o.x - p.width / 2, cy: o.y - p.depth / 2, r: o.d / 2 })) });
      views.push({ view: 'front', w: p.width, h: p.thickness, ...rect(p.width, p.thickness) });
      break;
    case 'base_plate': {
      const m = Math.max(12, p.boltDia * 1.5);
      const cs = [[m, m], [p.width - m, m], [m, p.depth - m], [p.width - m, p.depth - m]]
        .map(([x, y]) => ({ cx: x - p.width / 2, cy: y - p.depth / 2, r: p.boltDia / 2 }));
      views.push({ view: 'top', w: p.width, h: p.depth, ...rect(p.width, p.depth), holes: cs });
      break;
    }
    case 'stepped_plate':
      views.push({ view: 'top', w: p.width, h: p.depth, ...rect(p.width, p.depth) });
      break;
    case 'l_bracket':
      views.push({ view: 'top', w: p.legA, h: p.width, ...rect(p.legA, p.width) });
      break;
    case 'bent_sheet':
      views.push({ view: 'top', w: p.length, h: p.webWidth, ...rect(p.length, p.webWidth) });
      break;
    default:
      return null; // 그 외 어휘=대상 외(정직 UNSUPPORTED — 강등도 하지 않음)
  }
  return views;
}

/** 실루엣 아웃라인 표본점(mm, 뷰 중심 원점). */
function samplePoints(sil) {
  const pts = [];
  const push = (x, y) => pts.push([x, y]);
  if (sil.kind === 'rect') {
    const { w, h } = sil;
    const step = Math.max(w, h) / 160;
    for (let x = -w / 2; x <= w / 2; x += step) { push(x, -h / 2); push(x, h / 2); }
    for (let y = -h / 2; y <= h / 2; y += step) { push(-w / 2, y); push(w / 2, y); }
  }
  for (const c of sil.circles ?? []) {
    for (let a = 0; a < 360; a += 2) push(c.cx + c.r * Math.cos(a * Math.PI / 180), c.cy + c.r * Math.sin(a * Math.PI / 180));
  }
  for (const c of sil.holes ?? []) {
    for (let a = 0; a < 360; a += 6) push(c.cx + c.r * Math.cos(a * Math.PI / 180), c.cy + c.r * Math.sin(a * Math.PI / 180));
  }
  return pts;
}
/** 볼트 서클(시작각 미지 — 후보각 중 최대 지지 채택, 결정론). */
function boltRingPoints(ring, startDeg) {
  const pts = [];
  for (let k = 0; k < ring.n; k++) {
    const th = (startDeg + k * 360 / ring.n) * Math.PI / 180;
    const cx = (ring.bcd / 2) * Math.cos(th), cy = (ring.bcd / 2) * Math.sin(th);
    for (let a = 0; a < 360; a += 6) pts.push([cx + ring.r * Math.cos(a * Math.PI / 180), cy + ring.r * Math.sin(a * Math.PI / 180)]);
  }
  return pts;
}

function supportRatio(pts, box, masks) {
  const { sup, w, h } = masks;
  const sx = (box.x1 - box.x0) / ptsW(pts), sy = (box.y1 - box.y0) / ptsH(pts);
  let hit = 0;
  for (const [mx, my] of pts) {
    const px = Math.round(box.x0 + (mx - ptsMinX(pts)) * sx);
    const py = Math.round(box.y0 + (my - ptsMinY(pts)) * sy);
    if (px >= 0 && py >= 0 && px < w && py < h && sup[py * w + px]) hit++;
  }
  return pts.length ? hit / pts.length : 0;
}
// 표본군 외형(메모 없이 단순 — 표본 수백 개 규모)
const ptsMinX = (pts) => Math.min(...pts.map((p) => p[0]));
const ptsMinY = (pts) => Math.min(...pts.map((p) => p[1]));
const ptsW = (pts) => Math.max(...pts.map((p) => p[0])) - ptsMinX(pts);
const ptsH = (pts) => Math.max(...pts.map((p) => p[1])) - ptsMinY(pts);

/**
 * D1 메인: 그레이 버퍼 × intent → 역투영 대조 리포트.
 * @param gray { data:Uint8Array(그레이 0~255), width, height }
 * @returns { verdict:'OK'|'DEMOTE'|'UNSUPPORTED'|'NO_VIEW', support, scaleResidualPct,
 *            view, confidenceFactor, reasons[], askBack? }
 */
export function reprojectDiff(gray, intent) {
  const sils = silhouettes(intent);
  if (!sils) return { verdict: 'UNSUPPORTED', confidenceFactor: 1, reasons: [`${intent.type}: 역투영 실루엣 모델 없음(대상 외 — 강등 없음)`] };
  const masks = inkMasks(gray);
  const comps = components(masks);
  if (!comps.length) return { verdict: 'NO_VIEW', confidenceFactor: 0.5, reasons: ['도면에서 뷰 외곽 컴포넌트를 찾지 못함(사진/저대비?)'], askBack: '도면(선화) 이미지가 맞는지 확인해 주세요 — 뷰 외곽을 찾지 못했습니다.' };

  // 뷰 후보 선택: 종횡비 적합(≤12%) 후보 중 **최대 bbox**(외곽=최외곽 컴포넌트 —
  // 동심 형상에서 보어/내곽 원이 동률로 잡히는 것 방지). 적합 없으면 괴리 최소.
  let best = null;
  for (const sil of sils) {
    const target = sil.w / sil.h;
    for (const c of comps) {
      const bboxArea = (c.x1 - c.x0) * (c.y1 - c.y0);
      const asp = (c.x1 - c.x0) / Math.max(1, c.y1 - c.y0);
      const score = Math.abs(Math.log(asp / target));
      const fit = score <= 0.12;
      const better = !best ? true
        : fit && !best.fit ? true
          : fit === best.fit ? (fit ? bboxArea > best.bboxArea : score < best.score)
            : false;
      if (better) best = { score, fit, bboxArea, c, sil };
    }
  }
  const { c, sil } = best;
  const bw = c.x1 - c.x0, bh = c.y1 - c.y0;
  const sx = bw / sil.w, sy = bh / sil.h;
  const scaleResidual = Math.abs(sx - sy) / Math.max(sx, sy);

  // 아웃라인 지지율(볼트 서클은 시작각 후보 중 최대 — 결정론)
  let pts = samplePoints(sil);
  let support = supportRatio(pts, c, masks);
  if (sil.boltRing?.n > 0) {
    const base = pts;
    let bestRing = 0;
    for (const s0 of [0, 90, 180 / sil.boltRing.n]) {
      const rp = boltRingPoints(sil.boltRing, s0);
      const r = supportRatio([...base, ...rp], c, masks);
      if (r > bestRing) bestRing = r;
    }
    support = bestRing;
  }

  const reasons = [];
  if (support < SUPPORT_MIN) reasons.push(`아웃라인 지지율 ${(support * 100).toFixed(0)}% < ${SUPPORT_MIN * 100}% — 추출 형상이 도면 잉크와 어긋남`);
  if (scaleResidual > RESIDUAL_MAX) reasons.push(`축별 스케일 괴리 ${(scaleResidual * 100).toFixed(1)}% > ${RESIDUAL_MAX * 100}% — 가로/세로 치수 비율 불일치`);

  // D2 멀티뷰 모순(260719b): 도면 뷰들은 동일 축척 관례 — 주 뷰 스케일로 보조 뷰의 기대
  // 크기(w·s × h·s)를 역산해, 폭이 맞는 컴포넌트의 높이가 어긋나면 공유 치수 모순=거부.
  // 폭 매칭 컴포넌트가 없으면 해당 뷰 미검증(정직 노트 — 오탐 방지, 강등 없음).
  const crossViews = [];
  {
    const s = (sx + sy) / 2;
    for (const sv of sils) {
      if (sv === sil) continue;
      const expW = sv.w * s, expH = sv.h * s;
      let m = null;
      for (const c2 of comps) {
        if (c2 === c) continue;
        const bw2 = c2.x1 - c2.x0, bh2 = c2.y1 - c2.y0;
        if (Math.abs(bw2 - expW) / expW <= 0.15 && (!m || Math.abs(bw2 - expW) < Math.abs((m.x1 - m.x0) - expW))) m = c2;
      }
      if (!m) { crossViews.push({ view: sv.view, checked: false, note: '폭 매칭 컴포넌트 없음 — 미검증(정직)' }); continue; }
      const bh2 = m.y1 - m.y0;
      const devH = Math.abs(bh2 - expH) / expH;
      const impliedMm = +(bh2 / s).toFixed(1);
      crossViews.push({ view: sv.view, checked: true, expectedMm: sv.h, impliedMm, devPct: +(devH * 100).toFixed(1) });
      if (devH > 0.2) reasons.push(`멀티뷰 모순(${sv.view}): 공유 축척 기준 관측 ${impliedMm}mm ↔ 추출 ${sv.h}mm (${(devH * 100).toFixed(0)}% 괴리)`);
    }
  }
  const demote = reasons.length > 0;
  return {
    verdict: demote ? 'DEMOTE' : 'OK',
    view: sil.view,
    support: +support.toFixed(3),
    scaleResidualPct: +(scaleResidual * 100).toFixed(1),
    crossViews,
    region: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 },
    confidenceFactor: demote ? 0.5 : 1,
    reasons,
    ...(demote ? { askBack: `추출 치수를 도면에 되그려보니 맞지 않습니다(${reasons.join(' · ')}). 주요 치수(${sil.view === 'top' ? '외형 가로×세로' : '외형×두께'})를 확인해 주세요.` } : {}),
    note: '균일 배율 오류는 대상 외(치수문자 잔차=T3 DXF 판독) — 명시',
  };
}

/** PNG 바이트 → 그레이 버퍼(CLI/테스트 로더 — sharp 동적, 코어는 무의존). */
export async function loadGrayPng(bytesOrPath) {
  const sharp = (await import('sharp')).default;
  const { readFileSync } = await import('node:fs');
  const input = typeof bytesOrPath === 'string' ? readFileSync(bytesOrPath) : bytesOrPath;
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

// CLI: node reproject-diff.mjs <drawing.png> <intent.json|@file>
if (process.argv[1]?.replaceAll('\\', '/').endsWith('reproject-diff.mjs') && process.argv[2]) {
  const { readFileSync } = await import('node:fs');
  const gray = await loadGrayPng(process.argv[2]);
  const arg = process.argv[3] ?? '';
  const intent = JSON.parse(arg.startsWith('@') ? readFileSync(arg.slice(1), 'utf8') : arg);
  console.log(JSON.stringify(reprojectDiff(gray, intent), null, 1));
}
