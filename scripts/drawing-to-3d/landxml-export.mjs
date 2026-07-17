/**
 * landxml-export.mjs — 토목 선형 → LandXML 1.2 (Wave 1 실무 호환, 260717)
 *
 * 실무 도로·선형 SW(Civil3D·OpenRoads·국내 도로설계 SW)의 교환 표준.
 * 전 수치 = alignment 단일 소스(요소열·curveTable) 그대로 — 재계산·근사 없음:
 *   line 요소 → <Line>, arc 요소 → <Curve>(반경·중심 원값),
 *   클로소이드(정밀 폴리라인 전개, spiral 태그) → <Spiral spiType="clothoid">
 *     (TS/SC/CS/ST 좌표 = 요소열 실좌표, PI = 진입·진출 접선 교점 폐형).
 * 좌표: LandXML 관례 = "Northing Easting"(Y X) 순서, 단위 m.
 *   로컬 좌표계(원점=선형 시점) — 실좌표는 assembly.origin {E,N} 오프셋(DXF §F 동일 규약).
 * 종단: profile.design → <ProfAlign> PVI 열. 지반선 파생치는 측량 성과가 아니므로
 *   LandXML 로 내보내지 않음(날조 방지 — 명시 주석).
 */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(6); // m, µm 정밀도

/** alignment(+profile, origin) → LandXML 문자열. 선형 없으면 null. */
export function landxmlAlignment(assembly, { name = 'ALIGN-1', project = 'nexyfab' } = {}) {
  const al = assembly.alignment;
  if (!al?.elements?.length || !(al.totalMm > 0)) return null;
  const oE = Number(assembly.origin?.E) || 0; // mm
  const oN = Number(assembly.origin?.N) || 0;
  const NE = (p) => `${f3((p[1] + oN) / 1000)} ${f3((p[0] + oE) / 1000)}`; // "N E"
  const geo = [];
  const els = al.elements;
  let i = 0;
  while (i < els.length) {
    const el = els[i];
    if (el.type === 'arc') {
      const p0 = [el.c[0] + el.R * Math.cos(el.a0), el.c[1] + el.R * Math.sin(el.a0)];
      const p1 = [el.c[0] + el.R * Math.cos(el.a1), el.c[1] + el.R * Math.sin(el.a1)];
      geo.push(`<Curve rot="${el.ccw ? 'ccw' : 'cw'}" radius="${f3(el.R / 1000)}" length="${f3(el.len / 1000)}">
<Start>${NE(p0)}</Start><Center>${NE(el.c)}</Center><End>${NE(p1)}</End></Curve>`);
      i++;
      continue;
    }
    if (el.spiral != null) {
      // 같은 IP 의 연속 스파이럴 미세선분 묶음 → 1 <Spiral>
      const ip = el.spiral;
      let j = i;
      while (j < els.length && els[j].type === 'line' && els[j].spiral === ip) j++;
      const run = els.slice(i, j);
      const isEntry = j < els.length && els[j].type === 'arc'; // 다음이 원호=진입, 아니면 진출
      const ct = (al.curveTable ?? []).find((q) => q.ip === ip);
      const R = ct?.R ?? 0;
      const Ls = (ct?.Ls ?? run.reduce((s, q) => s + q.len, 0));
      const A = [run[0].p0[0], run[0].p0[1]];
      const B = [run[run.length - 1].p1[0], run[run.length - 1].p1[1]];
      // PI = 양단 접선의 교점(폐형 2×2)
      const b0 = (run[0].brgDeg * Math.PI) / 180, b1 = (run[run.length - 1].brgDeg * Math.PI) / 180;
      const d0 = [Math.cos(b0), Math.sin(b0)], d1 = [Math.cos(b1), Math.sin(b1)];
      const den = d0[0] * (-d1[1]) - d0[1] * (-d1[0]);
      let PI = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      if (Math.abs(den) > 1e-9) {
        const t = ((B[0] - A[0]) * (-d1[1]) - (B[1] - A[1]) * (-d1[0])) / den;
        PI = [A[0] + d0[0] * t, A[1] + d0[1] * t];
      }
      const arcNear = els[isEntry ? j : i - 1];
      const rot = arcNear?.ccw ? 'ccw' : 'cw';
      geo.push(`<Spiral length="${f3(Ls / 1000)}" radiusStart="${isEntry ? 'INF' : f3(R / 1000)}" radiusEnd="${isEntry ? f3(R / 1000) : 'INF'}" rot="${rot}" spiType="clothoid">
<Start>${NE(A)}</Start><PI>${NE(PI)}</PI><End>${NE(B)}</End></Spiral>`);
      i = j;
      continue;
    }
    geo.push(`<Line length="${f3(el.len / 1000)}"><Start>${NE(el.p0)}</Start><End>${NE(el.p1)}</End></Line>`);
    i++;
  }
  // 종단 계획선(PVI) — profile.design 만(지반 파생선 제외: 측량 성과 아님)
  let profile = '';
  const dsg = assembly.profile?.design;
  if (Array.isArray(dsg) && dsg.length >= 2) {
    const pvis = dsg.map((q) => `<PVI>${f3(q.staMm / 1000)} ${f3(q.elevMm / 1000)}</PVI>`).join('');
    profile = `<Profile name="${esc(name)}-PF"><ProfAlign name="design">${pvis}</ProfAlign></Profile>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" language="ko" readOnly="false">
<Units><Metric linearUnit="meter" areaUnit="squareMeter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="pascal" angularUnit="decimal degrees" directionUnit="decimal degrees"/></Units>
<Project name="${esc(project)}"/>
<Application name="nexyfab drawing-to-3d" desc="deterministic alignment export (single source; local coords${oE || oN ? '' : ' — set assembly.origin{E,N} for real-world'}); ground profile intentionally omitted (derived, not survey)"/>
<Alignments><Alignment name="${esc(name)}" length="${f3(al.totalMm / 1000)}" staStart="0.000000">
<CoordGeom>${geo.join('\n')}</CoordGeom>
${profile}</Alignment></Alignments>
</LandXML>`;
}

// ── self-test: 요소 매핑 무결(수 대조·연장 폐형·스파이럴 쌍) ──────────────────
const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('landxml-export.mjs');
if (isMain) {
  const { buildAssemblyTemplate } = await import('./domain-assemblies.mjs');
  let pass = 0, fail = 0;
  const check = (nm, ok, note = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK' : 'FAIL'} ${nm}${note ? ' — ' + note : ''}`); };
  // ① 직선+원곡선+클로소이드 혼합
  const asm = buildAssemblyTemplate('civil', 'retaining_wall_alignment', {
    ips: [[0, 0], [400000, 0], [800000, 300000], [1300000, 300000]],
    curves: [{ ip: 1, R: 200000, Ls: 60000 }, { ip: 2, R: 150000 }],
  });
  const xml = landxmlAlignment(asm);
  const nLine = (xml.match(/<Line /g) ?? []).length;
  const nCurve = (xml.match(/<Curve /g) ?? []).length;
  const nSpiral = (xml.match(/<Spiral /g) ?? []).length;
  check('요소 수: Curve 2·Spiral 2(IP1 진입·진출)·Line 3', nCurve === 2 && nSpiral === 2 && nLine === 3, `L${nLine}/C${nCurve}/S${nSpiral}`);
  // 연장 폐형: length 속성 합 = totalMm
  const lens = [...xml.matchAll(/length="([\d.]+)"/g)].map((m) => +m[1]);
  const sum = lens.slice(1).reduce((s, v) => s + v, 0); // [0]=Alignment 자체 length
  check('연장 폐형(요소 합=전체)', Math.abs(sum - asm.alignment.totalMm / 1000) < 0.002, `${sum.toFixed(3)} vs ${(asm.alignment.totalMm / 1000).toFixed(3)}m`);
  check('스파이럴 radius INF 쌍(진입 INF→R·진출 R→INF)', /radiusStart="INF"/.test(xml) && /radiusEnd="INF"/.test(xml));
  check('PVI 2점(기본 일정고)', (xml.match(/<PVI>/g) ?? []).length === 2);
  // ② origin 오프셋 반영
  const asm2 = { ...asm, origin: { E: 200000000, N: 450000000 } };
  const xml2 = landxmlAlignment(asm2);
  check('origin{E,N} 오프셋(첫 Start N≥450000)', /<Start>45\d{4,}\./.test(xml2));
  console.log(`landxml self-test: ${pass}/${pass + fail}`);
  if (fail) process.exit(1);
}
