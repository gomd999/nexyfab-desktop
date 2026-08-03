/**
 * step-naming.test.ts — **STEP 파트명이 SolidWorks 에서 안 깨지는가** (260803, B10).
 *
 * ## 왜
 * GPT 가 만든 같은 제품 모델을 SOLIDWORKS 2016 에서 열었더니 파트 트리가
 * `睇쫮쐤__NX-001-_뮘퐗_넵끔` 이었다(계획서 §10.0 #5). 실무에서는 **파일 반려 사유**다.
 *
 * 실측: `replicad.exportSTEP` 은 이름을 **raw UTF-8 그대로** 쓴다 — `\X2\` 이스케이프가 없다.
 * 그래서 한글을 그대로 넣으면 SolidWorks 가 CP949 로 읽어 깨진다.
 * **GPT 가 틀린 것을 우리가 맞히는 지점**이라 회귀로 고정한다.
 *
 * ⚠ 이 파일은 커널(OCCT wasm)을 부르지 않는 **순수 인코딩 검사**만 한다.
 *   실제 방출은 무겁고 종료 시 wasm 소멸자 경고가 나므로 별도 실측으로 확인했다:
 *   desk_stand 25부품 → PRODUCT 25개 · 비ASCII 잔존 0 · 연속 3회 호출 프로세스 생존.
 */

import { describe, expect, it } from 'vitest';
import { stepSafeName } from './to-step.mjs';

const enc = stepSafeName as unknown as (s: unknown) => string;

describe('★ISO 10303-21 인코딩 — 비ASCII 는 \\X2\\…\\X0\\', () => {
  it('ASCII 는 건드리지 않는다 — 전부 이스케이프하면 사람이 못 읽는다', () => {
    expect(enc('hinge_pin_1')).toBe('hinge_pin_1');
    expect(enc('PART-12 (M5x12)')).toBe('PART-12 (M5x12)');
  });

  it('한글은 UTF-16 코드유닛 4자리 hex 로 감싼다', () => {
    // '판재' = U+D310 U+C7AC
    expect(enc('판재')).toBe('\\X2\\D310C7AC\\X0\\');
  });

  it('★혼합 문자열은 비ASCII 구간만 감싼다 — 구간이 끊기면 닫고 다시 연다', () => {
    expect(enc('base_판재_1')).toBe('base_\\X2\\D310C7AC\\X0\\_1');
  });

  it('공백으로 갈린 한글은 두 구간이 된다', () => {
    expect(enc('베이스 판재')).toBe('\\X2\\BCA0C774C2A4\\X0\\ \\X2\\D310C7AC\\X0\\');
  });

  it('작은따옴표는 STEP 문자열 규칙대로 두 번 쓴다', () => {
    expect(enc("it's")).toBe("it''s");
  });

  it('역슬래시는 이중화한다 — 안 하면 이스케이프 시퀀스로 오독된다', () => {
    expect(enc('a\\b')).toBe('a\\\\b');
  });

  it('BMP 밖 문자는 서러게이트 쌍 그대로 — 규격이 그렇게 정의한다', () => {
    // U+1F600 → D83D DE00
    expect(enc('a😀b')).toBe('a\\X2\\D83DDE00\\X0\\b');
  });

  it('빈 값·null 에 죽지 않는다', () => {
    expect(enc('')).toBe('');
    expect(enc(null)).toBe('');
    expect(enc(undefined)).toBe('');
  });

  it('★결과에 비ASCII 가 남지 않는다 — 이것이 깨짐 방지의 본질이다', () => {
    for (const s of ['베이스 판재', 'ヒンジピン', '底板', 'قاعدة', 'placa base']) {
      const out = enc(s);
      expect([...out].every((c) => c.charCodeAt(0) < 128), `${s} → ${out}`).toBe(true);
    }
  });
});
