'use client';

/**
 * 스튜디오 AI 도크 — 우하단 접이식 챗. 랜딩 챗과 같은 스레드 저장소(nf_chat_threads_v1)를
 * 사용해 대화가 랜딩 사이드바에도 이어진다("별도 창 없음" 해소 + 왕복 컨텍스트).
 * 현재 설계(intent 이름·파츠 수)를 메시지에 컨텍스트로 첨부 — eng-chat action 파이프 재사용.
 * v1 정직 범위: 대화+계산 실행(카드 요약). 형상 직접 편집 명령은 각 패널의 말로-수정 사용 안내.
 */

import { useEffect, useRef, useState } from 'react';
import { designLoc } from './designI18n';
import Md from '@/components/nexyfab/Md';

type DockMsg = { role: 'user' | 'assistant'; content: string; calc?: { verdict?: string; notes?: string[] } & Record<string, unknown>; calcId?: string };
type DockThread = { id: string; title: string; domain: string; at: number; updated: number; badge?: string | null; msgs: DockMsg[] };
const THREADS_KEY = 'nf_chat_threads_v1';
const DOMAIN_MAP: Record<string, string> = { mech: 'mechanical', rack: 'mechanical', civil: 'civil', building: 'architecture', landscape: 'landscape', interior: 'interior' };

function loadAll(): DockThread[] {
  try { return (JSON.parse(localStorage.getItem(THREADS_KEY) ?? '[]') as DockThread[]).filter((t) => Array.isArray(t.msgs)); } catch { return []; }
}
function saveAll(list: DockThread[]) {
  try { localStorage.setItem(THREADS_KEY, JSON.stringify(list.slice(0, 50))); } catch { /* quota */ }
}

export default function StudioChatDock({ lang, domainSlug, intentName, partCount, pickedPart, onPartEdit }: { lang: string; domainSlug?: string | null; intentName?: string | null; partCount?: number | null; pickedPart?: string | null; onPartEdit?: (instruction: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<DockMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<number | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatDomain = DOMAIN_MAP[domainSlug ?? ''] ?? 'mechanical';
  const t = (copy: Parameters<typeof designLoc>[1]) => designLoc(lang, copy);

  // 스레드 동기화(랜딩과 공유) — 도크 전용 스레드 1개를 만들고 이어감
  useEffect(() => {
    if (!msgs.length) return;
    const list = loadAll();
    let id = threadIdRef.current;
    if (!id) {
      id = 'ts' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      threadIdRef.current = id;
      const first = msgs.find((m) => m.role === 'user');
      list.unshift({ id, title: '🛠 ' + (first?.content ?? 'Studio').slice(0, 24), domain: chatDomain, at: Date.now(), updated: Date.now(), msgs });
    } else {
      const th = list.find((t) => t.id === id);
      if (th) { th.msgs = msgs; th.updated = Date.now(); th.badge = [...msgs].reverse().find((m) => m.calc?.verdict)?.calc?.verdict ?? null; }
    }
    saveAll(list);
  }, [msgs, chatDomain]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const ctx = intentName ? `${t({ ko: `[현재 설계: ${intentName}${partCount ? ` · 파츠 ${partCount}` : ''}] `, en: `[current design: ${intentName}${partCount ? ` · parts ${partCount}` : ''}] `, ja: `[現在の設計: ${intentName}${partCount ? ` · 部品 ${partCount}` : ''}] `, zh: `[当前设计：${intentName}${partCount ? ` · 部件 ${partCount}` : ''}] `, es: `[diseño actual: ${intentName}${partCount ? ` · piezas ${partCount}` : ''}] `, ar: `[التصميم الحالي: ${intentName}${partCount ? ` · أجزاء ${partCount}` : ''}] ` })}` : '';
    // 🎯 픽킹 편집(260719 #6): 뷰어에서 부품 선택 상태면 도크 메시지=그 부품만 수정(edit-part)
    if (pickedPart && onPartEdit) {
      setMsgs((m) => [...m, { role: 'user', content: `🎯 ${pickedPart}: ${text}` }]);
      setBusy(true);
      try {
        await onPartEdit(text);
        setMsgs((m) => [...m, { role: 'assistant', content: t({ ko: `🎯 ${pickedPart} 수정 적용 — 뷰어·검증 갱신됨`, en: `🎯 ${pickedPart} edited — viewer and checks updated`, ja: `🎯 ${pickedPart}を編集しました — ビューアーと検証を更新`, zh: `🎯 已编辑 ${pickedPart} — 已更新预览和校验`, es: `🎯 ${pickedPart} editado — visor y comprobaciones actualizados`, ar: `🎯 تم تعديل ${pickedPart} — تم تحديث العرض والفحوصات` }) }]);
      } catch (e) {
        setMsgs((m) => [...m, { role: 'assistant', content: '⚠️ ' + (e instanceof Error ? e.message : String(e)) }]);
      } finally {
        setBusy(false);
      }
      return;
    }
    setMsgs((m) => [...m, { role: 'user', content: text }]);
    setBusy(true);
    try {
      const res = await fetch('/api/eng-chat/action/', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: ctx + text, domain: chatDomain, history: msgs.slice(-6) }),
      });
      const j = (await res.json().catch(() => ({}))) as { type?: string; reply?: string; id?: string; input?: Record<string, unknown>; error?: string };
      if (!res.ok) { setMsgs((m) => [...m, { role: 'assistant', content: '⚠️ ' + (j.error ?? 'error') }]); return; }
      setMsgs((m) => [...m, { role: 'assistant', content: String(j.reply ?? '') }]);
      if (j.type === 'calc' && j.id) {
        try {
          const r2 = await fetch('https://nexyfab-eng-api.gomd999.workers.dev/v1/demo/calc/' + j.id, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: j.input ?? {} }),
          });
          const calc = (await r2.json()) as DockMsg['calc'];
          setMsgs((m) => {
            const copy = m.slice();
            for (let i = copy.length - 1; i >= 0; i--) { if (copy[i].role === 'assistant') { copy[i] = { ...copy[i], calc, calcId: j.id }; break; } }
            return copy;
          });
        } catch { /* 카드 실패 — reply만 유지 */ }
      }
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  };

  return (
    <div style={{ position: 'fixed', right: 18, bottom: 18, zIndex: 60 }}>
      {open && (
        <div style={{ width: 340, height: 440, marginBottom: 10, borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column',
          background: 'var(--nx-panel, #fff)', border: '1px solid var(--nx-border, #dfe3e8)', boxShadow: '0 12px 40px rgba(0,0,0,0.25)' }}>
          <div style={{ padding: '10px 12px', fontSize: 12.5, fontWeight: 800, borderBottom: '1px solid var(--nx-border, #dfe3e8)', display: 'flex', justifyContent: 'space-between' }}>
            <span>💬 {t({ ko: 'AI 어시스턴트', en: 'AI Assistant', ja: 'AIアシスタント', zh: 'AI 助手', es: 'Asistente de IA', ar: 'مساعد الذكاء الاصطناعي' })} <span style={{ fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>{t({ ko: '— 랜딩 대화와 이어짐', en: '', ja: '— ランディングの会話と連携', zh: '— 与首页对话关联', es: '— conectado con el chat inicial', ar: '— مرتبط بمحادثة الصفحة الرئيسية' })}</span></span>
            <button type="button" onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>✕</button>
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!msgs.length && (
              <div style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)', lineHeight: 1.6 }}>
                {t({ ko: '설계 질문·계산 요청을 하세요. 현재 설계 정보가 자동으로 첨부됩니다.\n예: "이 보 처짐 검토해줘", "말뚝 지지력 계산"', en: 'Ask design questions or run calculations — current design context is attached.', ja: '設計について質問したり計算を実行できます。現在の設計情報が自動で添付されます。', zh: '可以提问设计问题或运行计算，当前设计信息会自动附加。', es: 'Haz preguntas de diseño o ejecuta cálculos; el contexto actual se adjunta automáticamente.', ar: 'اطرح أسئلة التصميم أو شغّل الحسابات؛ ستُرفق معلومات التصميم الحالية تلقائياً.' })}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: '7px 10px', borderRadius: 10,
                fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? 'var(--nx-accent, #2563eb)' : 'var(--nx-hover, #eef1f4)', color: m.role === 'user' ? '#fff' : 'inherit' }}>
                {m.role === 'assistant' ? <Md text={m.content} /> : m.content}
                {m.role === 'assistant' && m.content && (
                  <button type="button"
                    onClick={() => { void navigator.clipboard?.writeText(m.content).then(() => { setCopied(i); setTimeout(() => setCopied(null), 1200); }).catch(() => {}); }}
                    style={{ display: 'block', marginTop: 5, padding: '2px 8px', borderRadius: 6, fontSize: 10.5, cursor: 'pointer', border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'var(--nx-text-3, #6b7684)' }}>
                    {copied === i ? t({ ko: '복사됨 ✓', en: 'Copied ✓', ja: 'コピー済み ✓', zh: '已复制 ✓', es: 'Copiado ✓', ar: 'تم النسخ ✓' }) : t({ ko: '복사', en: 'Copy', ja: 'コピー', zh: '复制', es: 'Copiar', ar: 'نسخ' })}
                  </button>
                )}
                {m.calc && (
                  <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 8, background: 'rgba(0,0,0,0.06)', fontSize: 11.5 }}>
                    <b style={{ color: m.calc.verdict === 'PASS' ? '#16a34a' : m.calc.verdict === 'FAIL' ? '#dc2626' : undefined }}>{String(m.calc.verdict ?? 'INFO')}</b>
                    {' · '}{m.calcId}
                    {Array.isArray(m.calc.notes) && m.calc.notes[0] ? <div style={{ marginTop: 3, color: 'var(--nx-text-3, #6b7684)' }}>{String(m.calc.notes[0]).slice(0, 140)}</div> : null}
                  </div>
                )}
              </div>
            ))}
            {busy && <div style={{ fontSize: 12, color: 'var(--nx-text-3, #6b7684)' }}>{t({ ko: '응답 생성 중…', en: 'Generating…', ja: '回答を生成中…', zh: '正在生成回复…', es: 'Generando…', ar: 'جارٍ إنشاء الرد…' })}</div>}
          </div>
          {pickedPart && (
            <div style={{ padding: '5px 10px', borderTop: '1px solid var(--nx-border, #dfe3e8)', fontSize: 11, fontWeight: 700, color: 'var(--nx-accent, #2563eb)' }}>
              🎯 {pickedPart} — {t({ ko: '메시지가 이 부품만 수정합니다(뷰어에서 선택 해제 가능)', en: 'messages edit only this part', ja: 'この部品だけを編集します（ビューアーで選択解除できます）', zh: '消息只会编辑此部件（可在预览中取消选择）', es: 'los mensajes editan solo esta pieza (puedes deseleccionarla en el visor)', ar: 'ستعدّل الرسائل هذه القطعة فقط (يمكن إلغاء تحديدها في العرض)' })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--nx-border, #dfe3e8)' }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
              placeholder={pickedPart ? t({ ko: `🎯 ${pickedPart} 수정 지시…`, en: `Edit ${pickedPart}…`, ja: `🎯 ${pickedPart}への編集指示…`, zh: `🎯 编辑 ${pickedPart}…`, es: `🎯 Editar ${pickedPart}…`, ar: `🎯 تعديل ${pickedPart}…` }) : t({ ko: '질문·계산 요청…', en: 'Ask or calculate…', ja: '質問または計算…', zh: '提问或计算…', es: 'Pregunta o calcula…', ar: 'اسأل أو احسب…' })}
              style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--nx-border, #dfe3e8)', background: 'transparent', color: 'inherit', fontSize: 12.5 }} />
            <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}
              style={{ padding: '8px 12px', borderRadius: 8, border: 'none', background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}>→</button>
          </div>
        </div>
      )}
      <button type="button" onClick={() => setOpen((o) => !o)}
        style={{ width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 22,
          background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', boxShadow: '0 8px 24px rgba(59,130,246,0.4)' }}
        aria-label="AI assistant">
        💬
      </button>
    </div>
  );
}
