'use client';

/**
 * Split-screen notes panel.
 *
 * Lightweight scratch-pad pinned to the left of the 3D viewport when
 * `splitMode === 'side-notes'`. Engineers/planners use it for:
 *   - design constraints to keep visible while modeling
 *   - calculation scratch (formulas, tolerances)
 *   - reference URLs / spec snippets
 *
 * Storage: localStorage `nexyfab.notesPanel.{userId|anon}.text`.
 * Per-user-key so multiple accounts on one browser don't share notes.
 *
 * Why localStorage instead of cloud:
 *   - Notes are private + ephemeral. Don't want to surface them in admin.
 *   - First-launch experience must not require a network roundtrip.
 *   - Will graduate to per-project cloud notes if user demand appears.
 */

import { useEffect, useRef, useState } from 'react';

type LangKey = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
const langMap: Record<string, LangKey> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};
const dict: Record<LangKey, { title: string; placeholder: string; saved: string }> = {
  ko: { title: '메모',           placeholder: '설계 제약·계산·참고 링크를 적어두세요…',          saved: '저장됨' },
  en: { title: 'Notes',         placeholder: 'Jot down constraints, calcs, reference links…',  saved: 'Saved' },
  ja: { title: 'メモ',           placeholder: '設計制約・計算・参考リンクをメモ…',                saved: '保存済み' },
  zh: { title: '便签',           placeholder: '记录设计约束、计算、参考链接…',                    saved: '已保存' },
  es: { title: 'Notas',         placeholder: 'Anota restricciones, cálculos, enlaces…',         saved: 'Guardado' },
  ar: { title: 'ملاحظات',        placeholder: 'سجّل القيود والحسابات والروابط…',                  saved: 'محفوظ' },
};

interface Props {
  userId: string | null | undefined;
  lang?: string;
  onClose: () => void;
}

export default function SplitNotesPanel({ userId, lang = 'en', onClose }: Props) {
  const t = dict[langMap[lang] ?? 'en'];
  const [text, setText] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const storageKey = `nexyfab.notesPanel.${userId ?? 'anon'}.text`;

  useEffect(() => {
    try { setText(localStorage.getItem(storageKey) ?? ''); }
    catch { /* localStorage unavailable */ }
  }, [storageKey]);

  // Debounced persist — 500ms after the last keystroke. Avoids hammering
  // localStorage during fast typing while still being effectively realtime.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, text);
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 800);
      } catch { /* ignore */ }
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [text, storageKey]);

  return (
    <aside
      style={{
        position: 'absolute', top: 0, left: 0, bottom: 0,
        width: 320, zIndex: 20,
        background: 'rgba(13,17,23,0.92)',
        borderRight: '1px solid #30363d',
        display: 'flex', flexDirection: 'column',
        backdropFilter: 'blur(4px)',
      }}
    >
      <header
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderBottom: '1px solid #30363d',
          fontSize: 12, fontWeight: 700, color: '#c9d1d9',
        }}
      >
        <span>📝 {t.title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, color: '#3fb950',
            opacity: savedFlash ? 1 : 0, transition: 'opacity 0.2s',
          }}>{t.saved}</span>
          <button
            onClick={onClose}
            style={{
              fontSize: 12, color: '#8b949e', background: 'none',
              border: 'none', cursor: 'pointer', padding: 4,
            }}
            aria-label="Close"
          >×</button>
        </span>
      </header>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t.placeholder}
        style={{
          flex: 1, padding: '12px',
          background: 'transparent', color: '#e6edf3',
          border: 'none', resize: 'none', outline: 'none',
          fontFamily: 'monospace', fontSize: 13, lineHeight: 1.5,
        }}
        spellCheck={false}
      />
    </aside>
  );
}
