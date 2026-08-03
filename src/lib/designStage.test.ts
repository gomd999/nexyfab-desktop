/**
 * designStage.test.ts — **초안 → 상세 → 제작** (260803).
 *
 * ## 왜
 * 종전에는 단계가 **문구로만** 있었다. 「이 사양으로 정밀 3D를 생성할까요?」라고 묻는 시점에
 * 형상은 이미 만들어져 있어서 사용자 눈에는 **「묻고선 이미 해버렸다」**로 보였고,
 * 「확정」 버튼이 실제로 한 일은 STEP 파일 생성이라 **확정본이 어디에도 안 남았다.**
 *
 * ## 이 파일이 지키는 것
 * ① **추정이 남아 있으면 초안이다.** 게이트를 통과했다고 상세라고 부르면 추정을 확정으로 판다.
 * ② **확정 스냅샷은 깊은 복사다.** 참조만 들면 다음 수정이 확정본을 조용히 바꾼다.
 * ③ **화면이 실제로 붙였는가** — 모듈만 있고 안 쓰면 「있는데 안 닿는」 것이다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESIGN_STAGES, snapshot, stageIndex, stageOf } from './designStage';

const ui = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'ChatHero.tsx'), 'utf8');

describe('★① 단계 판정 — 결과에서 정한다', () => {
  it('게이트 에러가 있으면 초안', () => {
    expect(stageOf({ gateErrors: ['x'], designOk: false })).toBe('draft');
  });

  it('★추정 치수가 남아 있으면 게이트를 통과해도 초안이다', () => {
    expect(stageOf({ designOk: true, assumptions: ['두께는 통상값 10mm 로 봤습니다'] })).toBe('draft');
    expect(stageOf({ designOk: true, provenance: { assumed: 3 } })).toBe('draft');
  });

  it('추정이 없고 designOk 면 상세', () => {
    expect(stageOf({ designOk: true, assumptions: [], provenance: { assumed: 0 } })).toBe('detail');
  });

  it('designOk 가 아직 null 이면 초안 — 모르는 것을 상세라 하지 않는다', () => {
    expect(stageOf({ designOk: null })).toBe('draft');
    expect(stageOf({})).toBe('draft');
  });

  it('확정하면 제작 — 확정이 유일한 승격 조건이다', () => {
    expect(stageOf({ designOk: true, confirmed: true })).toBe('make');
    // 게이트가 깨져 있어도 사용자가 확정했다면 그 사실을 존중한다(경고는 별도 표시)
    expect(stageOf({ gateErrors: ['x'], confirmed: true })).toBe('make');
  });

  it('단계 순서가 초안→상세→제작이다', () => {
    expect(DESIGN_STAGES.map((s) => s.id)).toEqual(['draft', 'detail', 'make']);
    expect(stageIndex('draft')).toBe(0);
    expect(stageIndex('make')).toBe(2);
  });

  it('★각 단계가 「무엇이 아직 확정 안 됐는지」를 말한다 — 「초안」만으로는 뭘 더 말할지 모른다', () => {
    for (const s of DESIGN_STAGES) {
      expect(s.pendingKo, s.id).toBeTruthy();
      expect(s.pendingEn, s.id).toBeTruthy();
    }
    expect(DESIGN_STAGES[0].pendingKo, '초안은 추정이 있다는 사실을 말해야 한다').toMatch(/추정/);
  });

  it('6개국어 라벨을 갖는다 — 사이트가 6언어다', () => {
    for (const s of DESIGN_STAGES) {
      for (const L of ['ko', 'en', 'zh', 'ja', 'es', 'ar'] as const) {
        expect((s as unknown as Record<string, string>)[L], `${s.id}.${L}`).toBeTruthy();
      }
    }
  });
});

describe('★② 확정 스냅샷은 원본과 끊어져 있다', () => {
  it('원본을 바꿔도 스냅샷이 안 변한다 — 참조만 들면 확정본이 조용히 달라진다', () => {
    const src = { parts: [{ id: 'a', w: 100 }] };
    const snap = snapshot('확정', 'detail', src, 1);
    src.parts[0].w = 999;
    expect(snap.data.parts[0].w).toBe(100);
  });

  it('시각·라벨·단계를 함께 남긴다 — 무엇을 언제 확정했는지가 답이다', () => {
    const snap = snapshot('확정', 'detail', { x: 1 }, 12345);
    expect(snap).toMatchObject({ at: 12345, label: '확정', stage: 'detail' });
  });
});

const design = readFileSync(join(process.cwd(), 'src', 'app', '[lang]', 'nexyfab', 'design', 'DesignInner.tsx'), 'utf8');
const bar = readFileSync(join(process.cwd(), 'src', 'components', 'nexyfab', 'DesignStageBar.tsx'), 'utf8');

describe('★③ 두 화면이 **같은** 단계 체계를 쓴다', () => {
  it('★단계 바가 공용 컴포넌트다 — 화면마다 따로 그리면 다른 말을 하게 된다', () => {
    for (const [name, src] of [['ChatHero', ui], ['DesignInner', design]] as const) {
      expect(src, `${name} 가 공용 바를 안 쓴다`).toContain('DesignStageBar');
    }
    // 로컬 정의가 되살아나면 여기서 걸린다
    expect(ui).not.toMatch(/function StageBar\(/);
    expect(design).not.toMatch(/function StageBar\(/);
  });

  it('ChatHero 는 단품·조립 두 카드 모두에 붙인다', () => {
    expect((ui.match(/<DesignStageBar /g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('★DesignInner 는 생성이 끝나도 계속 보여준다 — loading 안에 숨기지 않는다', () => {
    // `{scad && (` 블록 안에 있어야 결과를 보는 내내 단계가 남는다
    const i = design.indexOf('<DesignStageBar');
    const before = design.slice(Math.max(0, i - 700), i);
    expect(before, '진행 중에만 뜨면 「지금 어디까지 왔는지」를 못 알려 준다').toContain('{scad && (');
  });

  it('두 화면 다 결과에서 판정한다 — 화면이 임의로 정하지 않는다', () => {
    expect(ui).toMatch(/stageOf\(\{/);
    expect(design).toMatch(/stageOf\(\{/);
  });

  it('★확정이 흔적을 남긴다 — 남기지 않으면 「확정」은 선언일 뿐이다', () => {
    expect(ui, 'ChatHero: 확정 시각').toMatch(/setConfirmedAt\(Date\.now\(\)\)/);
    expect(design, 'DesignInner: 확정 스냅샷').toMatch(/setConfirmedSnap\(snapshot\(/);
  });

  it('★언어 코드 매핑이 공용 바 안에 있다 — 이 앱은 kr·cn, 사전은 ko·zh 다', () => {
    expect(bar, '매핑이 없으면 한국어·중국어가 조용히 영어로 떨어진다').toMatch(/const ISO: Record<string, string>/);
    expect(bar).toMatch(/kr: 'ko'/);
    expect(bar).toMatch(/cn: 'zh'/);
  });

  it('공용 바는 그리기만 한다 — 판정을 안에서 하면 화면마다 규칙이 갈린다', () => {
    expect(bar).not.toMatch(/stageOf\(/);
  });
});
