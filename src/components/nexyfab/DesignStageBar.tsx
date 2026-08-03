/**
 * 설계 단계 바 — **초안 → 상세 → 제작**. 채팅형이지만 **순서가 보여야 한다.**
 *
 * ## 왜 공용 컴포넌트인가
 * 랜딩 채팅(`ChatHero`)과 설계 화면(`/nexyfab/design`)이 **같은 파이프라인**을 쓴다.
 * 화면마다 따로 그리면 라벨·순서·판정 기준이 갈리고, 사용자는 두 화면에서 다른 말을 듣는다.
 * 이 세션에 **같은 단일소스 결손으로 일곱 번 틀렸다** — 표시 계층에서 여덟 번째를 만들지 않는다.
 *
 * ⚠ 단계는 밖에서 **판정해서** 넘긴다(`stageOf`). 이 컴포넌트는 그리기만 한다 —
 *   여기서 판정하면 화면마다 다른 규칙이 생긴다.
 */
'use client';

import React from 'react';
import { DESIGN_STAGES, type DesignStage, stageIndex } from '@/lib/designStage';

/** 화면 언어 코드(`kr`·`cn`) → 사전 ISO(`ko`·`zh`). 매핑을 안 하면 조용히 영어가 된다. */
const ISO: Record<string, string> = { kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar' };

export function DesignStageBar({
  stage, lang, accent = '#38bdf8', compact = false,
}: { stage: DesignStage; lang: string; accent?: string; compact?: boolean }) {
  const cur = stageIndex(stage);
  const iso = ISO[lang] ?? 'en';
  const s = DESIGN_STAGES[cur];
  const label = (x: (typeof DESIGN_STAGES)[number]) => (x as unknown as Record<string, string>)[iso] ?? x.en;

  return (
    <div style={{ marginBottom: compact ? 6 : 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: compact ? 0 : 5 }}>
        {DESIGN_STAGES.map((x, i) => (
          <React.Fragment key={x.id}>
            {i > 0 && <span style={{ flex: 1, height: 1, background: i <= cur ? accent : 'rgba(148,163,184,0.28)' }} />}
            <span
              title={iso === 'ko' ? x.pendingKo : x.pendingEn}
              style={{
                fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999, whiteSpace: 'nowrap',
                color: i === cur ? '#0b1020' : i < cur ? accent : '#6e7681',
                background: i === cur ? accent : 'transparent',
                border: `1px solid ${i <= cur ? accent : 'rgba(148,163,184,0.28)'}`,
              }}
            >
              {/* 지나온 단계에 ✓ — 「어디까지 왔는지」가 색만으로는 덜 읽힌다 */}
              {i < cur ? '✓ ' : ''}{label(x)}
            </span>
          </React.Fragment>
        ))}
      </div>
      {!compact && (
        /**
         * ⚠ **지금 무엇이 아직 확정 안 됐는지**를 적는다. 「초안」이라고만 하면 사용자는
         *   무엇을 더 말해야 하는지 모른다 — 그게 「알아서 진행한다」로 느껴지는 이유다.
         */
        <div style={{ fontSize: 11, color: '#8b949e', lineHeight: 1.5 }}>
          {iso === 'ko' ? s.pendingKo : s.pendingEn}
        </div>
      )}
    </div>
  );
}
