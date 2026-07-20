/**
 * igesExport.ts — 메시 → IGES 5.x 텍스트 익스포트 (W5-H, 260721).
 *
 * ⚠정직 범위 선언(중요): 본 익스포트는 **B-Rep(144 Trimmed Surface)이 아니라
 * 폴리곤(와이어프레임) 표현**이다. 페이스별 폐폴리라인을 106 Copious Data
 * form 12(3D piecewise linear curve, IP=2)로 방출한다.
 *  - 근거: 144/142/128 조합의 정직한 방출·검증(트림 파라미터 공간 정합)은 이번
 *    범위에서 수립 불가 — 겉핥기 서피스 방출 대신 좌표가 검증 가능한 폴리라인만.
 *  - 106 form 12 는 IGES 5.x 기본 커브 엔티티(스펙 §4.7) — 와이어프레임 커브를
 *    읽는 CAD 에서 곡선으로 열림. **서피스/솔리드로 열리지 않음을 명시**.
 *  - 외부 CAD 실수입은 미검증(실행 근거 없음) — 검증된 것은 자기 임포터
 *    (meshIgesImport.igesToNexyfabAssembly) 좌표 라운드트립뿐.
 *  - 단위 = G섹션 unit flag 2(MM) 고정. 자기 임포터는 G섹션 단위를 읽지 않으므로
 *    (좌표를 그대로 사용) mm 좌표 입력을 전제한다.
 *
 * 80-컬럼 규약: 1..72 데이터, 73 섹션문자(S/G/D/P/T), 74..80 우측정렬 시퀀스.
 * P섹션 1..64 데이터 + 65..72 DE 백포인터. 수치는 델리미터(,) 경계에서만 개행
 * (필드 분할 금지 — 스펙 준수·외부 파서 안전).
 */

import type { PolyMesh } from './satExport';

export interface IgesWriteStats {
  entities: number;
  /** 방출 좌표 튜플 수 = Σ(페이스 정점수+1, 폐루프 반복점 포함) */
  points: number;
  lines: number;
}

export type IgesWriteResult =
  | { ok: true; text: string; stats: IgesWriteStats }
  | { ok: false; error: string };

/** IGES 수치 직렬화 — parseFloat 왕복 무손실(String), -0 정규화 */
const fnum = (v: number): string => (Object.is(v, -0) ? '0' : String(v));

const pad80 = (data: string, section: string, seq: number): string =>
  data.padEnd(72).slice(0, 72) + section + String(seq).padStart(7);

/** Hollerith 문자열(nHxxx) */
const holl = (s: string): string => `${s.length}H${s}`;

/**
 * 융합 폴리메시 → IGES 폴리라인 와이어프레임 텍스트.
 * 페이스 1개 = 106 form 12 엔티티 1개(폐루프 — 시점 반복). 폐합/매니폴드 요구 없음
 * (와이어프레임이므로 개방 메시도 좌표 사실만 방출 — 형상 주장 없음).
 */
export function writeIgesText(
  mesh: PolyMesh,
  { product = 'NexyFab shape-generator', filename = 'model.igs' }: { product?: string; filename?: string } = {},
): IgesWriteResult {
  if (!mesh.faces.length) return { ok: false, error: '페이스 0개 — 방출할 폴리라인 없음' };
  for (const v of mesh.verts) {
    if (v.length < 3 || v.some((c) => !Number.isFinite(c))) return { ok: false, error: '정점 좌표에 비유한값 — 방출 거부' };
  }
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi];
    if (f.length < 2) return { ok: false, error: `face[${fi}] 정점 ${f.length}개(<2) — 폴리라인 불성립` };
    for (const vi of f) {
      if (!Number.isInteger(vi) || vi < 0 || vi >= mesh.verts.length) return { ok: false, error: `face[${fi}] 정점 인덱스 범위 밖(${vi})` };
    }
  }

  // ── S 섹션(정직 범위 선언 포함) ──
  const sLines = [
    pad80('NexyFab IGES export - POLYLINE WIREFRAME (entity 106 form 12).', 'S', 1),
    pad80('NOT a B-Rep: faces are closed 3D polylines, no surface entities.', 'S', 2),
  ];

  // ── G 섹션 ──
  const gParams = [
    holl(','), holl(';'), holl(product), holl(filename), holl('nexyfab-iges-export'), holl('W5-H'),
    '32', '38', '6', '308', '15', holl(product), '1.0',
    '2', holl('MM'), // unit flag 2 = millimeters
    '1', '0.01',
    holl(new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 15)),
    '1e-6', '0', holl('NexyFab'), holl('Nexysys'), '11', '0',
  ].join(',') + ';';
  const gLines: string[] = [];
  {
    // 델리미터 경계 개행(필드 분할 금지)
    const toks = gParams.match(/[^,]*,|[^,]*;$/g) ?? [gParams];
    let cur = '';
    for (const t of toks) {
      if (cur.length + t.length > 72 && cur) {
        gLines.push(cur);
        cur = '';
      }
      cur += t;
    }
    if (cur) gLines.push(cur);
  }
  const g = gLines.map((l, i) => pad80(l, 'G', i + 1));

  // ── 엔티티(페이스별 106 form 12) → P 데이터 문자열 ──
  interface Ent {
    pdata: string[]; // 64컬럼 청크(델리미터 경계)
  }
  const ents: Ent[] = [];
  let points = 0;
  for (const f of mesh.faces) {
    const loop = [...f, f[0]]; // 폐루프 — 시점 반복
    points += loop.length;
    const toks: string[] = ['106', '2', String(loop.length)];
    for (const vi of loop) {
      const [x, y, z] = mesh.verts[vi];
      toks.push(fnum(x), fnum(y), fnum(z));
    }
    const joined = toks.join(',') + ';';
    const parts = joined.match(/[^,]*,|[^,]*;$/g) ?? [joined];
    const chunks: string[] = [];
    let cur = '';
    for (const t of parts) {
      if (cur.length + t.length > 64 && cur) {
        chunks.push(cur);
        cur = '';
      }
      cur += t;
    }
    if (cur) chunks.push(cur);
    ents.push({ pdata: chunks });
  }

  // ── D + P 섹션(시퀀스 상호 참조) ──
  const dLines: string[] = [];
  const pLines: string[] = [];
  let pSeq = 1;
  ents.forEach((ent, i) => {
    const dSeq = 2 * i + 1;
    const pStart = pSeq;
    for (const chunk of ent.pdata) {
      pLines.push(chunk.padEnd(64) + String(dSeq).padStart(8) + 'P' + String(pSeq).padStart(7));
      pSeq++;
    }
    const f8 = (v: string | number) => String(v).padStart(8);
    // D 1행: type, PD ptr, structure, line font, level, view, xform, label assoc, status
    dLines.push(f8(106) + f8(pStart) + f8(0) + f8(0) + f8(0) + f8(0) + f8(0) + f8(0) + '00000000'.padStart(8) + 'D' + String(dSeq).padStart(7));
    // D 2행: type, line weight, color, param line count, form(12=3D piecewise linear)
    dLines.push(f8(106) + f8(0) + f8(0) + f8(ent.pdata.length) + f8(12) + f8(' ') + f8(' ') + f8('FACE') + f8(0) + 'D' + String(dSeq + 1).padStart(7));
  });

  // ── T 섹션 ──
  const t = pad80(
    'S' + String(sLines.length).padStart(7) + 'G' + String(g.length).padStart(7) + 'D' + String(dLines.length).padStart(7) + 'P' + String(pLines.length).padStart(7),
    'T',
    1,
  );

  const text = [...sLines, ...g, ...dLines, ...pLines, t, ''].join('\n');
  return { ok: true, text, stats: { entities: ents.length, points, lines: sLines.length + g.length + dLines.length + pLines.length + 1 } };
}
