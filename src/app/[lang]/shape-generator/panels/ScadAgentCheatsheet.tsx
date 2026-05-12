'use client';

// W2 — Capability cheatsheet for the SCAD agent panel.
//
// 75+ tools is too many to surface as a flat menu. Instead we group
// representative example prompts by category (primitives, assemblies,
// drawings, etc.). Clicking an example fills the input box so the
// user only edits the parts that matter.
//
// Three-column compact layout: category header → 3-5 prompts per
// category. Hidden by default behind a "💡 What can I ask?" button so
// it doesn't clutter the chat view.

import React, { useEffect, useState } from 'react';

const dict = {
  ko: {
    open: '💡 무엇을 시킬 수 있나요?',
    close: '닫기',
    title: '예시 프롬프트',
    categories: [
      {
        name: '단순 부품',
        examples: [
          '30mm 정육면체',
          '지름 40mm 높이 60mm 원기둥',
          '반지름 25mm 구',
          'M8 50mm 볼트',
          'M10 육각너트',
          '외경 30 내경 20 길이 100 파이프',
        ],
      },
      {
        name: '어셈블리 (다부품)',
        examples: [
          'NEMA17 모터 마운트 + M3 볼트 4개',
          '잇수 20+30 모듈 2 평기어 트레인',
          'L자 브래킷 16개 4×4 그리드 50mm 간격',
          '간단한 토이카 (박스 차체 + 휠 4개)',
          'T자형 파이프 조인트 외경 30',
        ],
      },
      {
        name: '정밀 B-rep (NURBS)',
        examples: [
          '외부 STEP 파일 가져와서 4개 마운트 볼트로 결합',
          'M8 helical 나사봉 50mm (진짜 나선)',
          '벽 두께 2mm 케이스 120×80×40 위에 r=2 fillet',
          '트랜스폼 스윕 곡면 (단면 사각형, 직선 50mm)',
        ],
      },
      {
        name: '제조 검증',
        examples: [
          '이 마운트 위치도 ⌀0.05 데이텀 A,B,C',
          '잇수 20+30 모듈 2 기어, 중심거리 50mm 맞나?',
          '강철 100N 하중 안전한가?',
          '100mm 채널, 50mm/150mm에서 90°, 1.5mm 강판 펴면?',
        ],
      },
      {
        name: '도면 / 시각 검증',
        examples: [
          '정면+상면+우측면 도면, A4 자동 치수',
          'SVG로 정면뷰 내보내기',
          '비례 맞나 시각 확인',
          'STEP으로 깨끗하게 export',
        ],
      },
      {
        name: '세션 / 협업',
        examples: [
          'step 2로 돌려',
          '체크포인트 보여줘',
          '지금 누가 같이 보고 있나?',
          'M5 볼트 핸들 잠궈',
        ],
      },
    ],
  },
  en: {
    open: '💡 What can I ask?',
    close: 'Close',
    title: 'Example prompts',
    categories: [
      {
        name: 'Simple parts',
        examples: [
          '30mm cube',
          'cylinder 40mm dia, 60mm tall',
          '25mm radius sphere',
          'M8 50mm bolt',
          'M10 hex nut',
          'pipe OD 30 ID 20 length 100',
        ],
      },
      {
        name: 'Assemblies (multi-part)',
        examples: [
          'NEMA17 motor mount + 4 M3 bolts',
          'spur gear train, teeth 20+30, module 2',
          '4×4 grid of 16 L-brackets, 50mm spacing',
          'simple toy car (box body + 4 wheels)',
          'T-joint pipe, OD 30',
        ],
      },
      {
        name: 'Precision B-rep (NURBS)',
        examples: [
          'import STEP and combine with 4 mounting bolts',
          'M8 helical threaded rod 50mm (real helix)',
          'wall 2mm enclosure 120×80×40 with r=2 fillet',
          'sweep with rect cross-section, 50mm straight path',
        ],
      },
      {
        name: 'Manufacturing checks',
        examples: [
          'add position ⌀0.05 to this mount, datums A,B,C',
          'check teeth 20+30 module 2 at center 50mm',
          'is steel safe under 100N load?',
          '100mm channel, 90° bends at 50mm/150mm, 1.5mm sheet',
        ],
      },
      {
        name: 'Drawings / visual',
        examples: [
          'front+top+right view drawing, A4, auto-dim',
          'export front view as SVG',
          'visually verify proportions',
          'export clean STEP file',
        ],
      },
      {
        name: 'Session / collab',
        examples: [
          'revert to step 2',
          'show checkpoints',
          'who is in this session?',
          'lock the M5 bolt handle',
        ],
      },
    ],
  },
};

// Intentional: ja/zh/es/ar fall back to EN for the cheatsheet (24+
// example prompts × 4 langs is too much translation churn for the
// audience size). Light components (Inspector, Timeline, Presence,
// AssemblyTree, MobileNotice) ship full 6-language dicts.
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'en', cn: 'en', zh: 'en', es: 'en', ar: 'en',
};

export interface ScadAgentCheatsheetProps {
  lang: string;
  /** Called when user clicks an example. The receiver should put it in
   *  the input box so the user can tweak before sending. */
  onPick: (prompt: string) => void;
}

export default function ScadAgentCheatsheet({ lang, onPick }: ScadAgentCheatsheetProps) {
  const [open, setOpen] = useState(false);
  const t = dict[langMap[lang] ?? 'en'];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '6px 10px',
          fontSize: 11, fontWeight: 700,
          borderRadius: 6,
          border: '1px solid #30363d',
          background: 'transparent',
          color: '#9ca3af',
          cursor: 'pointer',
        }}
      >
        {t.open}
      </button>
    );
  }

  return (
    <div style={{
      padding: 10,
      background: '#0d1117',
      border: '1px solid #30363d',
      borderRadius: 8,
      maxHeight: 320,
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{t.title}</span>
        <button
          onClick={() => setOpen(false)}
          style={{
            padding: '3px 8px', fontSize: 10,
            borderRadius: 4, border: '1px solid #30363d',
            background: 'transparent', color: '#9ca3af',
            cursor: 'pointer',
          }}
        >
          {t.close}
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {t.categories.map(cat => (
          <div key={cat.name}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#58a6ff',
              marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {cat.name}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {cat.examples.map(ex => (
                <button
                  key={ex}
                  onClick={() => { onPick(ex); setOpen(false); }}
                  style={{
                    padding: '4px 6px',
                    textAlign: 'left',
                    fontSize: 11,
                    borderRadius: 4,
                    border: '1px solid transparent',
                    background: 'transparent',
                    color: '#c9d1d9',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = '#161b22';
                    e.currentTarget.style.borderColor = '#30363d';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.borderColor = 'transparent';
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
