/**
 * dxf-import.mjs — 수치지형도 DXF → 등고(contours) 인입 (260717 실무화 후속)
 *
 * 국토지리정보원 수치지형도(DXF)의 등고선(3D POLYLINE/LWPOLYLINE)을 파싱해
 * 템플릿 contours [{elevM, pts(mm 로컬)}] 로 변환 — Wave 2 surveyPoints 와 동일
 * 좌표 규약(절대 TM m + origin{E,N} m 필수, 좌표를 지어 맞추지 않음).
 *
 * 표고 소스(정직 순서): ①VERTEX z(30) ②엔티티 elevation(38) — 둘 다 0/부재 = 제외 집계.
 * 레이어: 기본 필터=등고 관례(7111 주곡선·7114 계곡선 포함 레이어명) ∪ z≠0 폴리라인.
 * 지원: POLYLINE/VERTEX/SEQEND · LWPOLYLINE. (LINE 등고는 미지원 — 집계 보고)
 */

/** DXF 텍스트 → [{layer, elevM, pts:[[x,y]m 절대]}] + 통계. */
export function parseDxfContours(text, { layerFilter = null } = {}) {
  const lines = String(text).split(/\r?\n/);
  const layerRe = layerFilter ? new RegExp(layerFilter, 'i') : /711[14]/;
  const out = [];
  const stats = { polylines: 0, used: 0, noElev: 0, lineEntitiesSkipped: 0, layers: new Set() };
  let i = 0;
  const next = () => (i < lines.length - 1 ? [lines[i++].trim(), lines[i++]] : null);
  let cur = null; // POLYLINE 수집 중
  while (i < lines.length - 1) {
    const pair = next();
    if (!pair) break;
    const [code, raw] = pair;
    const val = String(raw ?? '').trim();
    if (code !== '0') {
      if (cur && cur.kind === 'POLYLINE') {
        if (code === '8' && !cur.layer) cur.layer = val;
        else if (code === '38') cur.elev = Number(val);
      } else if (cur && cur.kind === 'VERTEX') {
        if (code === '10') cur.v[0] = Number(val);
        else if (code === '20') cur.v[1] = Number(val);
        else if (code === '30') cur.v[2] = Number(val);
      } else if (cur && cur.kind === 'LWPOLYLINE') {
        if (code === '8' && !cur.layer) cur.layer = val;
        else if (code === '38') cur.elev = Number(val);
        else if (code === '10') cur.pending = Number(val);
        else if (code === '20' && cur.pending != null) { cur.pts.push([cur.pending, Number(val)]); cur.pending = null; }
      }
      continue;
    }
    // 새 엔티티 경계
    if (cur?.kind === 'VERTEX') {
      // VERTEX 종료 → 부모 POLYLINE 에 편입
      if (Number.isFinite(cur.v[0]) && Number.isFinite(cur.v[1])) {
        cur.parent.pts.push([cur.v[0], cur.v[1]]);
        if (Number.isFinite(cur.v[2]) && cur.v[2] !== 0) cur.parent.zs.push(cur.v[2]);
      }
      cur = cur.parent;
    }
    const flush = () => {
      if (!cur || (cur.kind !== 'POLYLINE' && cur.kind !== 'LWPOLYLINE')) return;
      stats.polylines++;
      if (cur.layer) stats.layers.add(cur.layer);
      const z = cur.kind === 'POLYLINE'
        ? (cur.zs.length && cur.zs.every((q) => Math.abs(q - cur.zs[0]) < 1e-6) ? cur.zs[0] : (Number.isFinite(cur.elev) && cur.elev !== 0 ? cur.elev : null))
        : (Number.isFinite(cur.elev) && cur.elev !== 0 ? cur.elev : null);
      const layerHit = cur.layer && layerRe.test(cur.layer);
      if (cur.pts.length >= 2 && z != null && (layerHit || !layerFilter)) {
        out.push({ layer: cur.layer ?? '', elevM: z, pts: cur.pts });
        stats.used++;
      } else if (cur.pts.length >= 2 && z == null) stats.noElev++;
      cur = null;
    };
    if (val === 'VERTEX' && cur?.kind === 'POLYLINE') { cur = { kind: 'VERTEX', v: [NaN, NaN, NaN], parent: cur }; continue; }
    if (val === 'SEQEND') { flush(); continue; }
    flush();
    if (val === 'POLYLINE') cur = { kind: 'POLYLINE', layer: null, elev: NaN, pts: [], zs: [] };
    else if (val === 'LWPOLYLINE') cur = { kind: 'LWPOLYLINE', layer: null, elev: NaN, pts: [], pending: null };
    else if (val === 'LINE') stats.lineEntitiesSkipped++;
  }
  if (cur?.kind === 'VERTEX') cur = cur.parent;
  if (cur && (cur.kind === 'POLYLINE' || cur.kind === 'LWPOLYLINE')) {
    stats.polylines++;
    const z = Number.isFinite(cur.elev) && cur.elev !== 0 ? cur.elev : (cur.zs?.length ? cur.zs[0] : null);
    if (cur.pts.length >= 2 && z != null) { out.push({ layer: cur.layer ?? '', elevM: z, pts: cur.pts }); stats.used++; }
  }
  return { contours: out, stats: { ...stats, layers: [...stats.layers] } };
}

/** 절대 TM(m) 등고 → 템플릿 contours(mm 로컬) — origin{E,N}(m) 필수(정직 게이트). */
export function contoursToLocal(parsed, origin) {
  if (!(Number.isFinite(Number(origin?.E)) && Number.isFinite(Number(origin?.N)))) {
    return { ok: false, error: 'origin {E, N}(m) 필수 — 좌표계 정합 없이 로컬 변환 불가(정직 거부)', contours: [] };
  }
  const E = Number(origin.E), N = Number(origin.N);
  const contours = parsed.contours.map((c) => ({
    elevM: c.elevM,
    pts: c.pts.map(([x, y]) => [Math.round((x - E) * 1000), Math.round((y - N) * 1000)]),
  }));
  return { ok: true, contours };
}

// ── self-test: 합성 DXF 왕복(POLYLINE 3D·LWPOLYLINE 38·z0 제외·레이어 필터) ──
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('dxf-import.mjs');
if (isMain) {
  let pass = 0, fail = 0;
  const check = (nm, ok, note = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK' : 'FAIL'} ${nm}${note ? ' — ' + note : ''}`); };
  const g = (c, v) => `${c}\n${v}\n`;
  const dxf = g(999, 'synthetic contour dxf') // DXF 는 항상 코드/값 짝 — 주석도 짝(999)
    + g(0, 'POLYLINE') + g(8, 'F0017111') + g(66, 1)
    + g(0, 'VERTEX') + g(8, 'F0017111') + g(10, 200100.5) + g(20, 450200.0) + g(30, 52.0)
    + g(0, 'VERTEX') + g(8, 'F0017111') + g(10, 200150.5) + g(20, 450260.0) + g(30, 52.0)
    + g(0, 'SEQEND') + g(8, 'F0017111')
    + g(0, 'LWPOLYLINE') + g(8, '7114') + g(38, 55) + g(10, 200000) + g(20, 450000) + g(10, 200050) + g(20, 450080)
    + g(0, 'POLYLINE') + g(8, 'ROAD') + g(66, 1) // z=0 도로 — 제외 대상
    + g(0, 'VERTEX') + g(8, 'ROAD') + g(10, 1) + g(20, 2) + g(30, 0)
    + g(0, 'VERTEX') + g(8, 'ROAD') + g(10, 3) + g(20, 4) + g(30, 0)
    + g(0, 'SEQEND') + g(8, 'ROAD')
    + g(0, 'LINE') + g(8, '7111') + g(10, 0) + g(20, 0) + g(11, 1) + g(21, 1)
    + g(0, 'EOF');
  const r = parseDxfContours(dxf);
  check('등고 2건 채택(주곡선 3D z·계곡선 38)', r.contours.length === 2, JSON.stringify(r.stats));
  check('표고 52·55m', r.contours[0]?.elevM === 52 && r.contours[1]?.elevM === 55);
  check('z=0 폴리라인 제외 집계', r.stats.noElev === 1);
  check('LINE 미지원 집계', r.stats.lineEntitiesSkipped === 1);
  const loc = contoursToLocal(r, { E: 200000, N: 450000 });
  check('로컬 변환(mm)', loc.ok && loc.contours[0].pts[0][0] === 100500 && loc.contours[0].pts[0][1] === 200000);
  const noOrg = contoursToLocal(r, {});
  check('origin 누락=정직 거부', !noOrg.ok && noOrg.error.includes('origin'));
  console.log(`dxf-import self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
