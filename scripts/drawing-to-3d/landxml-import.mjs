/**
 * landxml-import.mjs — LandXML 1.x 도로 선형 임포터(코퍼스 R2-③, 260719).
 *
 * <Alignment><CoordGeom> 의 Line/Curve(arc) 체인 → 엔진 토목 선형 입력({ips, curves})
 * 변환: IP=인접 탄젠트(Line) 무한직선 교점(결정론), R=Curve radius. 검산: 복원 요소장
 * 합 ↔ Alignment length 대조(±0.5%). <Profile><ProfAlign> PVI/ParaCurve 종단도 판독.
 *
 * 정직: clothoid/spiral 등 arc 외 crvType·Line 비인접 Curve = unsupported 보고(값 날조
 * 없음). 좌표계는 파일 원값 그대로(원점 이동 없음 — CRS 해석은 후속 트랙 명시).
 */

import { readFileSync } from 'node:fs';

const num = (s) => parseFloat(s);

function parseXY(text) {
  const p = text.trim().split(/\s+/).map(num);
  return [p[0], p[1]]; // LandXML: Northing Easting 순서 유무는 소스별 — 원값 쌍 그대로(명시)
}

/** 무한직선 교점(각 직선=점+방향). 평행=null. */
function lineIntersect(p1, d1, p2, d2) {
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(det) < 1e-12) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / det;
  return [p1[0] + d1[0] * t, p1[1] + d1[1] * t];
}

/**
 * LandXML 텍스트 → { alignments:[{name,lengthDeclared,ips,curves,checks,unsupported}], profiles }
 */
export function parseLandXml(text) {
  const alignments = [];
  const profiles = [];
  // 단위 → mm 스케일(엔진=mm): meter=1000 · foot=304.8 · 미검출=1(원값, 명시)
  const unitM = text.match(/linearUnit="([^"]+)"/);
  const scale = unitM ? ({ meter: 1000, metre: 1000, foot: 304.8, USSurveyFoot: 304.800609601 }[unitM[1]] ?? 1) : 1;
  const S = (v) => (Number.isFinite(v) ? +(v * scale).toFixed(3) : v);
  for (const am of text.matchAll(/<Alignment\b([^>]*)>([\s\S]*?)<\/Alignment>/g)) {
    const attrs = am[1];
    const body = am[2];
    const name = (attrs.match(/name="([^"]*)"/) ?? [])[1] ?? '';
    const lengthDeclared = num((attrs.match(/length="([^"]*)"/) ?? [])[1] ?? 'NaN');
    const staStart = num((attrs.match(/staStart="([^"]*)"/) ?? [])[1] ?? '0');

    // CoordGeom 요소 순서 파싱(Line | Curve)
    const geo = (body.match(/<CoordGeom>([\s\S]*?)<\/CoordGeom>/) ?? [])[1] ?? '';
    const elems = [];
    const unsupported = [];
    for (const em of geo.matchAll(/<(Line|Curve|Spiral)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      const kind = em[1];
      const eattrs = em[2];
      const ebody = em[3];
      const start = parseXY((ebody.match(/<Start>([\s\S]*?)<\/Start>/) ?? [, ''])[1]);
      const end = parseXY((ebody.match(/<End>([\s\S]*?)<\/End>/) ?? [, ''])[1]);
      if (kind === 'Line') {
        elems.push({ kind, start, end, length: num((eattrs.match(/length="([^"]*)"/) ?? [])[1] ?? 'NaN') });
      } else if (kind === 'Curve' && /crvType="arc"/.test(eattrs)) {
        elems.push({
          kind, start, end,
          radius: num((eattrs.match(/radius="([^"]*)"/) ?? [])[1] ?? 'NaN'),
          length: num((eattrs.match(/length="([^"]*)"/) ?? [])[1] ?? 'NaN'),
        });
      } else {
        unsupported.push({ kind, why: kind === 'Spiral' ? 'clothoid v1 범위 외(정직)' : 'arc 외 crvType' });
      }
    }

    // Line-Curve-Line 체인 → IP/R (엔진 civil alignment 입력)
    const ips = [];
    const curves = [];
    if (elems.length && elems[0].kind === 'Line') ips.push(elems[0].start);
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      if (e.kind === 'Curve') {
        const prev = elems[i - 1], next = elems[i + 1];
        if (prev?.kind === 'Line' && next?.kind === 'Line') {
          const d1 = [prev.end[0] - prev.start[0], prev.end[1] - prev.start[1]];
          const d2 = [next.end[0] - next.start[0], next.end[1] - next.start[1]];
          const ip = lineIntersect(prev.start, d1, next.start, d2);
          if (ip) { ips.push(ip); curves.push({ ip: ips.length - 1, R: e.radius }); }
          else unsupported.push({ kind: 'Curve', why: '탄젠트 평행 — IP 미정' });
        } else {
          unsupported.push({ kind: 'Curve', why: 'Line 비인접(복합 곡선) v1 범위 외' });
        }
      }
    }
    const lastLine = [...elems].reverse().find((e) => e.kind === 'Line');
    if (lastLine) ips.push(lastLine.end);

    // 검산(생성≠검증): 선언 요소장 합 ↔ Alignment length
    const sum = elems.reduce((s, e) => s + (Number.isFinite(e.length) ? e.length : 0), 0);
    const lenOk = Number.isFinite(lengthDeclared) ? Math.abs(sum - lengthDeclared) <= Math.max(0.5, lengthDeclared * 0.005) : null;
    alignments.push({
      name, staStart: S(staStart), lengthDeclaredMm: S(lengthDeclared),
      ips: ips.map((p) => [S(p[0]), S(p[1])]),
      curves: curves.map((c) => ({ ip: c.ip, R: S(c.R) })),
      unitScaleToMm: scale,
      checks: { elemCount: elems.length, elemLengthSumMm: S(+sum.toFixed(3)), lengthMatch: lenOk },
      unsupported,
    });

    // 종단(Profile) — PVI/ParaCurve
    for (const pm of body.matchAll(/<ProfAlign\b[^>]*>([\s\S]*?)<\/ProfAlign>/g)) {
      const pvis = [];
      for (const vm of pm[1].matchAll(/<(PVI|ParaCurve)\b([^>]*)>([\s\S]*?)<\/\1>|<(PVI)\b[^>]*>([^<]*)<\/PVI>/g)) {
        const kind = vm[1] ?? vm[4];
        const val = (vm[3] ?? vm[5] ?? '').trim();
        const [sta, elev] = val.split(/\s+/).map(num);
        if (!Number.isFinite(sta) || !Number.isFinite(elev)) continue;
        pvis.push({ kind: kind === 'ParaCurve' ? 'paracurve' : 'pvi', staMm: S(sta), elevMm: S(elev), ...(kind === 'ParaCurve' ? { curveLengthMm: S(num((vm[2].match(/length="([^"]*)"/) ?? [])[1] ?? 'NaN')) } : {}) });
      }
      profiles.push({ alignment: name, pvis });
    }
  }
  return {
    alignments, profiles,
    note: 'LandXML→엔진 선형(ips/curves) 변환 — clothoid·복합곡선=unsupported 정직 보고. 좌표=원값(CRS 해석 후속). 종단(PVI)=판독만(템플릿 소비 후속 명시).',
  };
}

export function parseLandXmlFile(path) {
  return parseLandXml(readFileSync(path, 'utf8'));
}
