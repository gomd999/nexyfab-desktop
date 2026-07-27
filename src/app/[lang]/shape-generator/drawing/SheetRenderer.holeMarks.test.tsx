/**
 * 뷰 **안에** 구멍 원 그리기 (260728).
 *
 * 260727 §5-5 는 이것을 featureMesh 내부 루프 공사로 보고 "사용자 결정"으로 남겼다
 * (ADR-017 면 이름 · `buildExtrudeTopo` 의 링 2개 전제 · `expectedVolume` 계약이
 * gross→net 으로 뒤집힘). 그런데 **메시가 필요 없다** — 구멍의 지름·존재·깊이는 hole
 * 게이트가 커널 부피로 이미 검증했고, 검증된 값을 도면에 표기하는 데에 투영 기하가
 * 필요하지 않다. 주석 레이어로 내면 위 세 가지를 전부 건드리지 않는다.
 *
 * 여기서 고정하는 것:
 *  - 원이 **뷰포트 안**의 옳은 자리에 옳은 크기로 그려진다(렌더러가 이미 쓰는 tx/ty/s 재사용).
 *  - 지정한 뷰포트에만 그려진다(다른 뷰에 새지 않는다).
 *  - holeMarks 가 없으면 출력이 종전과 **완전히 동일**하다(하위호환).
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SheetRenderer } from './SheetRenderer';
import type { Sheet } from '@/lib/drawing/sheet';
import type { Polyhedron } from '@/lib/cad/featureMesh';

/** 100×80×10 판 (XY 프로파일 × Z 두께) — top 뷰가 X×Y 를 보여준다. */
function plate(): Polyhedron {
  const v = (x: number, y: number, z: number) => ({ x, y, z });
  return {
    vertices: [
      v(0, 0, 0), v(100, 0, 0), v(100, 80, 0), v(0, 80, 0),
      v(0, 0, 10), v(100, 0, 10), v(100, 80, 10), v(0, 80, 10),
    ],
    faces: [
      { vertices: [0, 1, 2, 3], normal: { x: 0, y: 0, z: -1 } },
      { vertices: [4, 5, 6, 7], normal: { x: 0, y: 0, z: 1 } },
      { vertices: [0, 1, 5, 4], normal: { x: 0, y: -1, z: 0 } },
      { vertices: [2, 3, 7, 6], normal: { x: 0, y: 1, z: 0 } },
      { vertices: [1, 2, 6, 5], normal: { x: 1, y: 0, z: 0 } },
      { vertices: [0, 3, 7, 4], normal: { x: -1, y: 0, z: 0 } },
    ],
  };
}

function sheetWith(holeMarks?: Sheet['holeMarks']): Sheet {
  return {
    id: 's1',
    name: 'hole marks',
    paperSize: 'A4',
    viewports: [
      { id: 'top', sourceId: 'plate', projection: { kind: 'standard', view: 'top' }, centerOnSheet: { x: 100, y: 150 }, widthOnSheet: 60, scale: 1, label: 'TOP' },
      { id: 'front', sourceId: 'plate', projection: { kind: 'standard', view: 'front' }, centerOnSheet: { x: 100, y: 60 }, widthOnSheet: 60, scale: 1, label: 'FRONT' },
    ],
    ...(holeMarks ? { holeMarks } : {}),
  };
}

const render = (sheet: Sheet): string =>
  renderToStaticMarkup(
    <SheetRenderer sheet={sheet} geometry={new Map([['plate', plate()]])} />,
  );

describe('SheetRenderer — 뷰 안의 구멍 원', () => {
  it('지정한 뷰포트에 원이 그려지고, 다른 뷰에는 새지 않는다', () => {
    const svg = render(sheetWith([
      { viewportId: 'top', xMm: 20, yMm: 20, diameterMm: 10, tag: 'h1' },
      { viewportId: 'top', xMm: 80, yMm: 60, diameterMm: 10, tag: 'h2' },
    ]));
    expect(svg).toContain('data-testid="sheet-renderer-hole-top-h1"');
    expect(svg).toContain('data-testid="sheet-renderer-hole-top-h2"');
    expect(svg).not.toContain('sheet-renderer-hole-front-');
    // 뷰포트 그룹이 개수를 보고한다(레이어가 실제로 붙었는지 한눈에)
    expect(svg).toContain('data-holes="2"');
    expect(svg).toContain('data-holes="0"'); // front 뷰
  });

  it('원의 반지름이 뷰포트 축척을 따른다 — 같은 뷰의 두 지름 비가 지름 비와 같다', () => {
    const svg = render(sheetWith([
      { viewportId: 'top', xMm: 25, yMm: 40, diameterMm: 10, tag: 'small' },
      { viewportId: 'top', xMm: 75, yMm: 40, diameterMm: 20, tag: 'big' },
    ]));
    const rOf = (tag: string): number => {
      const g = svg.split(`sheet-renderer-hole-top-${tag}`)[1] ?? '';
      const m = g.match(/r="([\d.]+)"/);
      expect(m, `radius for ${tag}`).not.toBeNull();
      return parseFloat(m![1]);
    };
    expect(rOf('big') / rOf('small')).toBeCloseTo(2, 6);
  });

  it('중심이 뷰포트 안쪽에 놓인다 — 같은 판의 두 구멍이 x 순서를 유지한다', () => {
    const svg = render(sheetWith([
      { viewportId: 'top', xMm: 10, yMm: 40, diameterMm: 8, tag: 'left' },
      { viewportId: 'top', xMm: 90, yMm: 40, diameterMm: 8, tag: 'right' },
    ]));
    const cxOf = (tag: string): number => {
      const g = svg.split(`sheet-renderer-hole-top-${tag}`)[1] ?? '';
      return parseFloat(g.match(/cx="([\d.]+)"/)![1]);
    };
    expect(cxOf('left')).toBeLessThan(cxOf('right'));
  });

  it('holeMarks 가 없으면 출력이 종전과 완전히 동일하다 (하위호환)', () => {
    expect(render(sheetWith())).toBe(render(sheetWith([])));
  });
});
