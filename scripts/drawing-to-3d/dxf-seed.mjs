/**
 * DXF 씨앗 추출기 — 입구 A Phase 2 (방법론 §9, 2026-07-16).
 *
 * 정직 원칙 그대로: 완전 자동 DWG→3D는 연구급 난제 — 여기서는 DXF(ASCII)에서
 * 치수·원·전체 범위를 **"씨앗"으로만** 추출한다(사람 검증 전제, 자동 생성 주장 금지).
 * 지원 엔티티: DIMENSION(실측값 42/텍스트 1) · CIRCLE(반지름 40) · LINE/LWPOLYLINE(범위 산정).
 * 파서는 결정론(그룹코드 페어 스캔) — AI 미사용.
 */

function pairs(text) {
  // DXF = [그룹코드 줄, 값 줄] 반복. CRLF/LF 모두 허용.
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) continue;
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

/**
 * @param {string} text DXF ASCII 원문
 * @returns {{ measurements:number[], dims:Array<{value:number,kind:string,text?:string}>, dimTexts:string[], circles:Array<{r:number,cx:number,cy:number}>, extents:{w:number,h:number}|null, entityCounts:Record<string,number> }}
 */
export function extractDxfSeed(text) {
  const P = pairs(text);
  // ENTITIES 섹션만 스캔(HEADER/TABLES의 좌표 오염 방지)
  let inEntities = false;
  let cur = null; // 현재 엔티티 {type, data:{code:[values]}}
  const entities = [];
  for (let i = 0; i < P.length; i++) {
    const [code, val] = P[i];
    if (code === 2 && val === 'ENTITIES') { inEntities = true; continue; }
    if (code === 0 && val === 'ENDSEC') { if (inEntities) inEntities = false; continue; }
    if (!inEntities) continue;
    if (code === 0) {
      if (cur) entities.push(cur);
      cur = { type: val, data: {} };
      continue;
    }
    if (cur) {
      if (!cur.data[code]) cur.data[code] = [];
      cur.data[code].push(val);
    }
  }
  if (cur) entities.push(cur);

  const measurements = [];
  const dimTexts = [];
  const circles = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const entityCounts = {};
  const num = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : null; };
  const bump = (x, y) => {
    if (x !== null) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
    if (y !== null) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  };

  const dims = []; // T3(260719): 분류된 치수 엔티티 — {value, kind, text?}
  for (const e of entities) {
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
    if (e.type === 'DIMENSION') {
      // 42 = 실측 치수값(가장 신뢰). 1 = 표시 텍스트(override 가능 — 참고로만).
      // T3: 70(형식 비트 0~2: 0=회전선형·1=정렬·3=지름·4=반지름) + 50(선형 측정각) 분류
      const t70 = num((e.data[70] ?? [])[0]);
      const base = t70 !== null ? (t70 & 7) : null;
      const rot = num((e.data[50] ?? [])[0]) ?? 0;
      const kind = base === 3 ? 'diameter'
        : base === 4 ? 'radius'
          : base === 2 || base === 5 ? 'angular'
            : base === 0 ? (Math.abs(((rot % 180) + 180) % 180 - 90) < 1 ? 'linearV' : 'linearH')
              : base === 1 ? 'aligned'
                : 'other';
      const txt = (e.data[1] ?? []).find((s) => s && s !== '<>');
      for (const s of e.data[42] ?? []) {
        const v = num(s);
        if (v !== null && v > 0) {
          measurements.push(+v.toFixed(3));
          dims.push({ value: +v.toFixed(3), kind, ...(txt ? { text: txt.slice(0, 40) } : {}) });
        }
      }
      if (txt) dimTexts.push(txt.slice(0, 40));
    } else if (e.type === 'CIRCLE') {
      const r = num((e.data[40] ?? [])[0]);
      const cx = num((e.data[10] ?? [])[0]);
      const cy = num((e.data[20] ?? [])[0]);
      if (r !== null && r > 0) circles.push({ r: +r.toFixed(3), cx: cx ?? 0, cy: cy ?? 0 });
      bump(cx !== null ? cx - (r ?? 0) : null, cy !== null ? cy - (r ?? 0) : null);
      bump(cx !== null ? cx + (r ?? 0) : null, cy !== null ? cy + (r ?? 0) : null);
    } else if (e.type === 'LINE') {
      bump(num((e.data[10] ?? [])[0]), num((e.data[20] ?? [])[0]));
      bump(num((e.data[11] ?? [])[0]), num((e.data[21] ?? [])[0]));
    } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE' || e.type === 'VERTEX') {
      const xs = e.data[10] ?? [], ys = e.data[20] ?? [];
      for (let k = 0; k < Math.max(xs.length, ys.length); k++) bump(num(xs[k] ?? null), num(ys[k] ?? null));
    }
  }

  const extents = (minX < maxX && minY < maxY)
    ? { w: +(maxX - minX).toFixed(3), h: +(maxY - minY).toFixed(3) }
    : null;
  // 치수 중복 제거·정렬(씨앗 가독성)
  const uniq = [...new Set(measurements)].sort((a, b) => a - b);
  return { measurements: uniq.slice(0, 40), dims: dims.slice(0, 80), dimTexts: dimTexts.slice(0, 20), circles: circles.slice(0, 40), extents, entityCounts };
}

// ─── T3 결정론 판독 격상(260719): DIMENSION 실측값 직사용 ──────────────────────
// 지름성 파라미터(diameter/radius 치수·원 2r 로 대조), 그 외=선형/정렬 치수로 대조.
const DIA_PARAM = /dia|Dia|D$|bcd|bore/i;

/**
 * 추출 intent 의 수치 파라미터를 DXF 치수 엔티티 실측값으로 정합(추론→판독 격상).
 * ≤tolPct 최근접 실측값이 있으면 **실측값으로 교체**(measured 기록), 없으면 unverified
 * (추론값 잔존 — 신뢰도 강등·되묻기 대상). 값 날조 없음: 교체 원값·출처 전부 보고.
 * @returns { intent, measured:[{param,from,to,kind}], unverified:[param], coverage }
 */
export function reconcileIntentWithDxf(intent, seed, { tolPct = 2 } = {}) {
  const dims = seed?.dims ?? [];
  const circleDia = (seed?.circles ?? []).map((c) => ({ value: +(2 * c.r).toFixed(3), kind: 'circle2r' }));
  const linear = dims.filter((d) => ['linearH', 'linearV', 'aligned', 'other'].includes(d.kind));
  const diaPool = [...dims.filter((d) => d.kind === 'diameter'), ...dims.filter((d) => d.kind === 'radius').map((d) => ({ value: +(2 * d.value).toFixed(3), kind: 'radius×2' })), ...circleDia];
  const out = { ...intent };
  const measured = [];
  const unverified = [];
  const params = (intent && typeof intent === 'object') ? Object.keys(intent) : [];
  for (const k of params) {
    const v = intent[k];
    if (typeof v !== 'number' || !(v > 0) || k === 'confidence' || k === 'boltCount' || k === 'teeth') continue;
    const pool = DIA_PARAM.test(k) ? [...diaPool, ...linear] : [...linear, ...diaPool];
    let best = null;
    for (const d of pool) {
      const dev = Math.abs(d.value - v) / v * 100;
      if (dev <= tolPct && (!best || dev < best.dev)) best = { ...d, dev };
    }
    if (best) {
      if (best.value !== v) { out[k] = best.value; }
      measured.push({ param: k, from: v, to: best.value, kind: best.kind });
    } else unverified.push(k);
  }
  // holes[].d — 지름 풀로 동일 정합
  if (Array.isArray(intent?.holes)) {
    out.holes = intent.holes.map((h) => {
      if (!(typeof h?.d === 'number' && h.d > 0)) return h;
      let best = null;
      for (const d of diaPool) {
        const dev = Math.abs(d.value - h.d) / h.d * 100;
        if (dev <= tolPct && (!best || dev < best.dev)) best = { ...d, dev };
      }
      if (best) { measured.push({ param: `hole(${h.x},${h.y}).d`, from: h.d, to: best.value, kind: best.kind }); return { ...h, d: best.value }; }
      unverified.push(`hole(${h.x},${h.y}).d`);
      return h;
    });
  }
  const total = measured.length + unverified.length;
  return {
    intent: out, measured, unverified,
    coverage: total ? +(measured.length / total).toFixed(3) : 0,
    note: 'DIMENSION 실측값 직사용(±' + tolPct + '%) — unverified=추론값 잔존(강등·되묻기 대상), 교체 이력 전부 보고(날조 없음)',
  };
}
