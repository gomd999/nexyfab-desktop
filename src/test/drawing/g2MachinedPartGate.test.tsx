// @vitest-environment jsdom
/**
 * g2MachinedPartGate.test.tsx — G2 게이트(기계 단품 제작도) 실행형 실증.
 *
 * REPLACEMENT_ROADMAP §5: G2 = R1(하류 재생성) + R3(실측 치수).
 * EXECUTION_PLAN Wave 4 게이트: "치수 기입된 제작도면이 PDF로 나오고,
 * 모델을 바꾸면 따라온다." — 이 파일이 그 문장을 그대로 실행한다
 * (실행하지 않은 판정은 판정이 아니다):
 *
 *   1. 실부품(L-브래킷 60×50×12 + ⌀50 보스)을 모델링하고 3뷰 시트에
 *      토포 이름 참조 치수 7종을 기입 — 전부 REAL 측정값(1e-6)으로 표시.
 *   2. 렌더된 SVG(=PDF 파이프라인의 입력)를 실제 jspdf+svg2pdf.js로
 *      벡터 PDF Blob까지 생성.
 *   3. 모델 편집(두께 12→18) 후 같은 refs가 새 값으로 재실측 — 연동.
 *   4. DXF(R12) 경로도 치수 탑재 — 한때 "치수 엔티티 미탑재"가 이
 *      게이트의 고정 한계였으나 해소됨: topologies 공급 시 실측값이
 *      DIM_<id> 레이어의 LINE+SOLID+TEXT(전개 프리미티브)로 실린다.
 *      진짜 DIMENSION 엔티티가 아닌 이유(익명 *D 블록 의존 → 블록 없는
 *      DIMENSION은 엄격 뷰어에서 공백)는 dxfExport.ts 헤더에 명시.
 *      topologies 미공급 시엔 종전과 비트 동일(하위호환) — 이 두 방향
 *      모두 아래 마지막 테스트가 실측으로 고정한다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';

// jsdom은 레이아웃 엔진이 없어 SVG geometry API(getBBox)를 구현하지 않는다.
// svg2pdf.js가 텍스트 앵커 계산에 호출하므로 테스트 한정 최소 폴리필을 댄다 —
// PDF 파이프라인(jspdf 콘텐츠 스트림·svg2pdf 트래버설)은 실물 그대로이고,
// 브라우저에선 네이티브 getBBox가 쓰인다. 좌표 정밀도만 근사, 존재는 진짜.
beforeAll(() => {
  const proto = SVGElement.prototype as unknown as {
    getBBox?: () => { x: number; y: number; width: number; height: number };
  };
  if (!proto.getBBox) {
    proto.getBBox = function getBBox() {
      return { x: 0, y: 0, width: 1, height: 1 };
    };
  }
});
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import { validateSheet } from '@/lib/drawing/sheet';
import type { Dimension } from '@/lib/drawing/dimension';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { featureToPolyhedron, type Polyhedron } from '@/lib/cad/featureMesh';
import { buildExtrudeTopo, type NamedTopology } from '@/lib/cad/topoNaming';
import { measureSheetDimension } from '@/lib/drawing/associativeUpdate';
import { exportSheetsToPdfVector } from '@/lib/drawing/svg2pdfBridge';
import { sheetToDxf } from '@/lib/drawing/dxfExport';
import { SheetRenderer } from '@/app/[lang]/shape-generator/drawing/SheetRenderer';

// ─── 실부품 fixtures ─────────────────────────────────────────────────────

/** L-브래킷: 60×50 L-프로파일 × 두께(깊이) t. 기계가공 단품의 대표형. */
function lBracket(t = 12): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 50 },
      { x: 0, y: 50 },
    ],
    depth: t,
    direction: 'one_sided',
    mode: 'add',
  };
}

/** ⌀50 원형 보스(16각 근사 — 캡 정점은 진원 위, measure가 진원성 검증). */
function boss(): ExtrudeFeature {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 16; i += 1) {
    const th = (2 * Math.PI * i) / 16;
    pts.push({ x: 25 * Math.cos(th), y: 25 * Math.sin(th) });
  }
  return { kind: 'extrude', loop: pts, depth: 30, direction: 'one_sided', mode: 'add' };
}

function vp(id: string, sourceId: string, view: 'front' | 'top', x: number): Viewport {
  return {
    id,
    sourceId,
    projection: { kind: 'standard', view },
    centerOnSheet: { x, y: 160 },
    widthOnSheet: 110,
    scale: 1,
    label: id.toUpperCase(),
  };
}

/** 제작도 치수 7종 — 전부 SOURCE-모델 안정 토포 이름 참조. */
const DIMS: ReadonlyArray<{ dim: Dimension; expect: number; label: string }> = [
  { dim: { id: 'd-width', viewportId: 'front', kind: 'linear', refs: ['f.side.5', 'f.side.1'] }, expect: 60, label: '60' },
  { dim: { id: 'd-height', viewportId: 'top', kind: 'linear', refs: ['f.side.0', 'f.side.4'] }, expect: 50, label: '50' },
  { dim: { id: 'd-thick', viewportId: 'front', kind: 'linear', refs: ['f.cap.bottom', 'f.cap.top'] }, expect: 12, label: '12' },
  { dim: { id: 'd-flange', viewportId: 'top', kind: 'linear', refs: ['f.side.0', 'f.side.2'] }, expect: 20, label: '20' },
  { dim: { id: 'd-web', viewportId: 'top', kind: 'linear', refs: ['f.side.5', 'f.side.3'] }, expect: 20, label: '20' },
  { dim: { id: 'd-angle', viewportId: 'front', kind: 'angular', refs: ['e.bottom.0-1', 'e.vert.1'] }, expect: 90, label: '90°' },
  { dim: { id: 'd-boss', viewportId: 'boss-top', kind: 'diametric', refs: ['f.cap.top'] }, expect: 50, label: '⌀50' },
];

function makeSheet(): Sheet {
  return {
    id: 'g2-sheet',
    name: 'G2 — machined L-bracket + boss',
    paperSize: 'A3',
    viewports: [
      vp('front', 'g2-bracket', 'front', 80),
      vp('top', 'g2-bracket', 'top', 210),
      vp('boss-top', 'g2-boss', 'top', 340),
    ],
    dimensions: DIMS.map((d) => d.dim),
  };
}

function maps(bracketT = 12): {
  geometry: Map<string, Polyhedron>;
  topologies: Map<string, NamedTopology>;
} {
  const b = lBracket(bracketT);
  const c = boss();
  const bPoly = featureToPolyhedron(b);
  const cPoly = featureToPolyhedron(c);
  if (!bPoly || !cPoly) throw new Error('fixture mesh failed');
  return {
    geometry: new Map([['g2-bracket', bPoly], ['g2-boss', cPoly]]),
    topologies: new Map([
      ['g2-bracket', buildExtrudeTopo(b)],
      ['g2-boss', buildExtrudeTopo(c)],
    ]),
  };
}

// ─── 게이트 실증 ─────────────────────────────────────────────────────────

describe('G2 gate — machined part drawing with REAL measured dimensions', () => {
  it('sheet IR is valid and all 7 dimensions measure OK at 1e-6', () => {
    const sheet = makeSheet();
    validateSheet(sheet); // throws on invalid IR
    const { topologies } = maps();
    for (const { dim, expect: want } of DIMS) {
      const res = measureSheetDimension(dim, sheet.viewports, topologies);
      expect(res, dim.id).not.toBeNull();
      if (!res || !res.ok) throw new Error(`${dim.id}: ${res ? res.reason + ' — ' + res.detail : 'null'}`);
      expect(res.value, dim.id).toBeCloseTo(want, 6);
    }
  });

  it('rendered drawing shows every measured value (the SVG the PDF pipeline consumes)', () => {
    const sheet = makeSheet();
    const { geometry, topologies } = maps();
    const { container } = render(
      <SheetRenderer sheet={sheet} geometry={geometry} topologies={topologies} />,
    );
    DIMS.forEach(({ dim, label }, i) => {
      const node = container.querySelector(`[data-dim-id="${dim.id}"]`);
      expect(node, dim.id).not.toBeNull();
      expect(node?.getAttribute('data-dim-measured'), dim.id).toBe('ok');
      expect(node?.querySelector('text')?.textContent, `${dim.id} (#${i})`).toBe(label);
    });
  });

  it('the dimensioned drawing exports to a REAL vector PDF (jspdf + svg2pdf.js, no mocks)', async () => {
    const sheet = makeSheet();
    const { geometry, topologies } = maps();
    const { container } = render(
      <SheetRenderer sheet={sheet} geometry={geometry} topologies={topologies} />,
    );
    const svg = container.querySelector('svg[data-testid="sheet-renderer-root"]');
    expect(svg).not.toBeNull();
    const blob = await exportSheetsToPdfVector([sheet], [svg as unknown as SVGElement]);
    expect(blob.type).toBe('application/pdf');
    // jsdom Blob에는 arrayBuffer()가 없어 FileReader로 바이트를 읽는다.
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
      r.onerror = () => reject(r.error);
      r.readAsArrayBuffer(blob);
    });
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    expect(blob.size).toBeGreaterThan(1000);
    // 콘텐츠 스트림에 실측 라벨 텍스트가 벡터 텍스트로 실렸는지(비압축 jsPDF
    // 기본 출력 기준). Latin-1 라벨만 확인 — ⌀ 등 비Latin1 글리프 한계는
    // svg2pdfBridge 헤더의 기지 항목.
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).toContain('(60)');
    expect(text).toContain('(12)');
  });

  it('model edit (thickness 12 → 18) re-measures through the SAME refs — associative', () => {
    const sheet = makeSheet();
    const { topologies } = maps(18);
    const thick = measureSheetDimension(
      DIMS[2]!.dim, sheet.viewports, topologies,
    );
    expect(thick && thick.ok && thick.value).toBe(18);
    // 나머지 치수는 두께 편집과 무관 — 값이 흔들리면 안 된다.
    const width = measureSheetDimension(DIMS[0]!.dim, sheet.viewports, topologies);
    expect(width && width.ok && width.value).toBeCloseTo(60, 9);
  });

  it('the R12 DXF path now CARRIES the measured dimensions (limitation lifted)', () => {
    // 종전 한계 고정 테스트(expect(dxf).not.toContain('DIMENSION'))의 반전.
    // 게이트 표의 "DXF 치수 R6 이월" 문구를 갱신할 것 — 이제 DXF에도
    // 실측 치수가 실린다. 형태는 진짜 DIMENSION 엔티티가 아니라 전개
    // LINE+SOLID+TEXT(사유: R12 DIMENSION은 익명 *D 블록 필수 — 블록
    // 없는 미니멀 스트림에선 공백 렌더. dxfExport.ts 헤더 참조).
    const sheet = makeSheet();
    const { topologies } = maps();

    // 하위호환: topologies 미공급이면 종전대로 치수 없음.
    expect(sheetToDxf(sheet)).not.toContain('DIM_');

    const dxf = sheetToDxf(sheet, { topologies });
    expect(dxf).toContain('ENTITIES');
    // 치수마다 전용 레이어.
    for (const { dim } of DIMS) {
      expect(dxf, dim.id).toContain(`DIM_${dim.id}`);
    }
    // 실측값이 TEXT 페이로드로 실렸는지 — 그룹코드 1('  1') 다음 줄만
    // 수집해 좌표 문자열('160' 등) 오탐을 배제한다. ⌀/°는 R12 텍스트
    // 관례인 %%c/%%d 제어코드로 이동한다.
    const lines = dxf.split('\n');
    const texts = lines.flatMap((l, i) => (l === '  1' && i + 1 < lines.length ? [lines[i + 1]!] : []));
    expect(texts).toContain('60');
    expect(texts).toContain('12');
    expect(texts).toContain('50');
    expect(texts).toContain('20');
    expect(texts).toContain('90%%d'); // 90°
    expect(texts).toContain('%%c50'); // ⌀50
    // 전부 실측 성공 픽스처 — 플레이스홀더/실패 코멘트가 없어야 한다.
    expect(dxf).not.toContain('NEXYFAB_DIM_UNMEASURED');
    expect(texts.some((t) => t.startsWith('<'))).toBe(false);
  });
});
