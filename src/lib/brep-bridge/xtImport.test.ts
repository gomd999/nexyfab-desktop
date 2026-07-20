/**
 * xtImport 폐형 테스트 — 합성 XT 스트림(스펙 문법 준수) + 정직 거부 경로.
 * 실물 검증=로컬 코퍼스 벤치(elbow 120×126.5×90mm·mearm 141바디 등 5파일, 라이선스=로컬 전용).
 */
import { describe, it, expect } from 'vitest';
import { parseXt, xtToNexyfabAssembly } from './xtImport';

const HEADER = [
  '**ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz**************************',
  '**PARASOLID !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~0123456789**************************',
  '**PART1;MC=x;FORMAT=text;GUISE=transmit;DATE=01-jan-2026;',
  '**PART2;SCH=SCH_3401225_34101_13006;USFLD_SIZE=0;',
  '**PART3;',
  '**END_OF_HEADER***************************************************',
].join('\n');

/** 임베디드 미니 스트림: body(255)+point(255)×2 + 종결. 프리앰블 51자 관례. */
function miniXt(points: Array<[number, number, number]>): string {
  const pre = 'TRANSMIT FILE created by modeller version 340122523'; // 51자
  const body = `12 255 1 5 0 0 0 0 0 0 1e3 1e-8 0 0 0 1 0 3 0 0 0 0 0 0 0 0`; // 23필드(d+6p+2f+3p+u+p+u+8p)
  // 스키마 델타(255)는 타입 최초 1회에만 붙는다
  const pts = points.map((p, k) => `29 ${k === 0 ? '255 ' : ''}${k + 2} ${100 + k} 0 0 0 0 ${p[0]} ${p[1]} ${p[2]}`);
  return `${HEADER}\nT51 : ${pre} SCH_3401225_34101_13006231 0 ${body} ${pts.join(' ')} 1 0 `;
}

describe('parseXt', () => {
  it('임베디드 미니 스트림에서 바디·POINT 점군을 추출한다', () => {
    const r = parseXt(miniXt([[0, 0, 0], [0.1, 0.2, 0.3]]));
    expect(r.ok).toBe(true);
    expect(r.bodies).toBe(1);
    expect(r.points).toHaveLength(2);
    expect(r.points![1]).toEqual([0.1, 0.2, 0.3]);
    expect(r.schema).toBe('SCH_3401225_34101');
  });

  it('비임베디드 스키마는 정직 거부한다(레이아웃 미상 — 날조 금지)', () => {
    const src = miniXt([[0, 0, 0]]).replace(/SCH_3401225_34101_13006/g, 'SCH_3200152_32001').replace('231 0 12', '0 12');
    const r = parseXt(src);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('비임베디드');
  });

  it('Parasolid 헤더가 아니면 거부한다', () => {
    expect(parseXt('solid cube\nfacet...').ok).toBe(false);
  });

  it('스트림 어긋남(정수 자리 실수)은 불변식으로 검출한다', () => {
    // body 필드 하나를 실수로 오염 → INT-DESYNC/불변식 오류로 정직 실패해야 함
    const bad = miniXt([[0, 0, 0]]).replace('1 0 3 0', '1 .5 3 0');
    const r = parseXt(bad);
    expect(r.ok).toBe(false);
  });
});

describe('xtToNexyfabAssembly', () => {
  it('점군 AABB 를 m→mm 환산 box 부품으로 방출한다', () => {
    const r = xtToNexyfabAssembly(miniXt([[0, 0, 0], [0.12, 0.05, 0.03]]), { name: 't' });
    expect(r.ok).toBe(true);
    const p = r.assembly!.parts[0];
    expect(p.params.width).toBeCloseTo(120, 3);
    expect(p.params.depth).toBeCloseTo(50, 3);
    expect(p.params.height).toBeCloseTo(30, 3);
    expect(r.assembly!.importedApprox).toBe(true);
    expect(r.assembly!.note).toContain('AABB');
    expect(r.stats!.bodies).toBe(1);
  });

  it('결과에 기계 판독 가능한 근사 플래그가 항상 실린다(W5-G — 조용한 박스 근사 금지)', () => {
    const r = xtToNexyfabAssembly(miniXt([[0, 0, 0], [0.12, 0.05, 0.03]]), { name: 't' });
    expect(r.ok).toBe(true);
    expect(r.assembly!.fidelity).toBe('aabb-approximation');
    expect(r.assembly!.parts[0].fidelity).toBe('aabb-approximation');
  });
});
