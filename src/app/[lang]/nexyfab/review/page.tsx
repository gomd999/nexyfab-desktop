'use client';

/**
 * B-7/E3(260808d) — 리뷰어 검수 콘솔: 검토 패킷 JSON 업로드 → 케이스별
 * 체크리스트 확인·승인/거부·메모 → 승인 레코드 JSON 다운로드(promote CLI 가
 * 그대로 소비). 서버 의존 0(파일 기반 — CLI 파이프라인의 UI 중간층).
 * 부적격 패킷(내부 템플릿 등)은 배지로 명시하고 산출 파일에 경고 동봉 —
 * 방출 초크는 promote 계층이다(이 화면은 초크가 아님).
 */

import React, { useMemo, useState } from 'react';
import { use } from 'react';
import {
  parsePacketsFile,
  buildApprovalsFile,
  type ReviewPacket,
  type ReviewDecision,
} from '@/lib/ai/reviewPacketSession';

const T = {
  ko: {
    title: '도메인 정확도 검수 콘솔', reviewer: '리뷰어 ID', load: '검토 패킷 JSON 열기',
    none: '패킷 파일을 열어 시작하세요 (build-domain-accuracy-review-packets 출력)',
    notReady: '인증 부적격', ready: '검수 대상', axes: '근거 축', checklist: '검수 체크리스트(승인 전 전 항목 확인)',
    confirm: '체크리스트 전 항목을 확인했습니다', approve: '승인', reject: '거부', note: '메모(선택)',
    export: '승인 레코드 JSON 내보내기', decided: '결정', undecided: '미결정',
    exportHint: '내보낸 파일의 approvals 배열을 promote CLI --approvals 로 넘기세요. 리뷰어 2인이 각자 세션을 내보내야 이중 승인이 성립합니다.',
    summaryTitle: '산출물 요약(자동 생성 — 원본 소스 대조는 별도 문서로)',
  },
  en: {
    title: 'Domain accuracy review console', reviewer: 'Reviewer ID', load: 'Open review packets JSON',
    none: 'Open a packets file to start (output of build-domain-accuracy-review-packets)',
    notReady: 'NOT certifiable', ready: 'Reviewable', axes: 'Ground-truth axes', checklist: 'Checklist (confirm all before approving)',
    confirm: 'I have confirmed every checklist item', approve: 'Approve', reject: 'Reject', note: 'Note (optional)',
    export: 'Export approvals JSON', decided: 'decided', undecided: 'pending',
    exportHint: 'Feed the exported approvals array to the promote CLI via --approvals. Two reviewers must each export their own session for dual approval.',
    summaryTitle: 'Artifact summary (auto-generated — compare against source docs separately)',
  },
  ja: {
    title: 'ドメイン精度レビューコンソール', reviewer: 'レビュアーID', load: 'レビューパケットJSONを開く',
    none: 'パケットファイルを開いて開始してください', notReady: '認証不可', ready: 'レビュー可能', axes: '根拠軸', checklist: 'チェックリスト（承認前に全項目を確認）',
    confirm: 'すべてのチェック項目を確認しました', approve: '承認', reject: '却下', note: 'メモ（任意）', export: '承認レコードJSONを書き出す', decided: '決定済み', undecided: '未決定',
    exportHint: '書き出した approvals 配列を promote CLI の --approvals に渡してください。二重承認には各レビュアーが個別に書き出す必要があります。', summaryTitle: '成果物の概要（自動生成。原資料との照合は別途必要）',
  },
  zh: {
    title: '领域准确性审核控制台', reviewer: '审核员 ID', load: '打开审核包 JSON', none: '请打开审核包文件开始', notReady: '不可认证', ready: '可审核', axes: '依据维度',
    checklist: '审核清单（批准前确认全部项目）', confirm: '我已确认所有清单项目', approve: '批准', reject: '拒绝', note: '备注（可选）', export: '导出批准记录 JSON', decided: '已决定', undecided: '待决定',
    exportHint: '请将导出的 approvals 数组通过 --approvals 交给 promote CLI。双人批准要求两位审核员分别导出各自会话。', summaryTitle: '产物摘要（自动生成，仍需另行对照原始资料）',
  },
  es: {
    title: 'Consola de revisión de precisión', reviewer: 'ID del revisor', load: 'Abrir paquetes JSON', none: 'Abra un archivo de paquetes para comenzar', notReady: 'No certificable', ready: 'Revisable', axes: 'Ejes de evidencia',
    checklist: 'Lista de verificación (confirme todo antes de aprobar)', confirm: 'He confirmado todos los elementos', approve: 'Aprobar', reject: 'Rechazar', note: 'Nota (opcional)', export: 'Exportar aprobaciones JSON', decided: 'decididos', undecided: 'pendientes',
    exportHint: 'Pase el arreglo approvals exportado al CLI promote mediante --approvals. Cada uno de los dos revisores debe exportar su propia sesión.', summaryTitle: 'Resumen del artefacto (generado automáticamente; compárelo por separado con las fuentes)',
  },
  ar: {
    title: 'وحدة مراجعة دقة المجال', reviewer: 'معرّف المراجع', load: 'فتح حزم المراجعة JSON', none: 'افتح ملف الحزم للبدء', notReady: 'غير قابل للاعتماد', ready: 'جاهز للمراجعة', axes: 'محاور الأدلة',
    checklist: 'قائمة التحقق (أكد جميع البنود قبل الاعتماد)', confirm: 'أكدت جميع بنود قائمة التحقق', approve: 'اعتماد', reject: 'رفض', note: 'ملاحظة (اختياري)', export: 'تصدير سجلات الاعتماد JSON', decided: 'محسوم', undecided: 'معلّق',
    exportHint: 'مرّر مصفوفة approvals المصدّرة إلى promote CLI عبر --approvals. يجب أن يصدّر كل مراجع جلسته بصورة مستقلة للاعتماد المزدوج.', summaryTitle: 'ملخص المخرجات (مولّد آلياً؛ يلزم التحقق من المصادر بصورة منفصلة)',
  },
} as const;

export default function ReviewPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const locale = lang === 'kr' || lang === 'ko' ? 'ko'
    : lang === 'cn' || lang === 'zh' ? 'zh'
      : lang === 'ja' || lang === 'es' || lang === 'ar' ? lang
        : 'en';
  const t = T[locale];
  const [packets, setPackets] = useState<ReviewPacket[]>([]);
  const [error, setError] = useState('');
  const [reviewerId, setReviewerId] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, ReviewDecision>>(new Map());
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());

  const active = packets[activeIdx];
  const decidedCount = useMemo(() => packets.filter(p => decisions.has(p.caseId)).length, [packets, decisions]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parsePacketsFile(await file.text());
    if (parsed.error) { setError(parsed.error); return; }
    setError(''); setPackets(parsed.packets); setActiveIdx(0);
    setDecisions(new Map()); setConfirmed(new Set()); setNotes(new Map());
  };

  const decide = (decision: 'approve' | 'reject') => {
    if (!active) return;
    const next = new Map(decisions);
    next.set(active.caseId, {
      decision,
      checklistConfirmed: confirmed.has(active.caseId),
      note: notes.get(active.caseId),
    });
    setDecisions(next);
    if (activeIdx < packets.length - 1) setActiveIdx(activeIdx + 1);
  };

  const exportFile = () => {
    const built = buildApprovalsFile(packets, decisions, reviewerId, new Date().toISOString());
    if (built.errors.length) { setError(built.errors.join(' · ')); return; }
    setError('');
    const blob = new Blob([JSON.stringify(built.file, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `approvals-${reviewerId || 'reviewer'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const box: React.CSSProperties = { background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 16 };
  return (
    <div style={{ minHeight: '100vh', background: '#080b12', color: '#e6edf3', padding: 24, fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{t.title}</h1>
      <p style={{ fontSize: 12, color: '#8b949e', marginBottom: 16 }}>{t.exportHint}</p>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={reviewerId} onChange={e => setReviewerId(e.target.value)} placeholder={t.reviewer}
          style={{ padding: '8px 12px', borderRadius: 8, background: '#0b1020', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.15)', fontSize: 13 }} />
        <label style={{ padding: '8px 14px', borderRadius: 8, background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#93c5fd', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
          {t.load}
          <input type="file" accept="application/json" style={{ display: 'none' }} onChange={e => onFile(e.target.files?.[0])} />
        </label>
        {packets.length > 0 && (
          <span style={{ fontSize: 12.5, color: '#8b949e' }}>{decidedCount}/{packets.length} {t.decided}</span>
        )}
        {decidedCount > 0 && (
          <button onClick={exportFile} disabled={!reviewerId.trim()}
            style={{ padding: '8px 14px', borderRadius: 8, background: reviewerId.trim() ? 'rgba(34,197,94,0.18)' : 'rgba(148,163,184,0.15)', border: '1px solid rgba(34,197,94,0.4)', color: '#4ade80', fontSize: 13, fontWeight: 700, cursor: reviewerId.trim() ? 'pointer' : 'not-allowed' }}>
            ⭳ {t.export}
          </button>
        )}
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 12.5, marginBottom: 12 }}>⚠️ {error}</div>}
      {packets.length === 0 && <div style={{ ...box, color: '#8b949e', fontSize: 13 }}>{t.none}</div>}

      {packets.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 14 }}>
          <div style={{ ...box, maxHeight: '75vh', overflow: 'auto', padding: 8 }}>
            {packets.map((p, i) => {
              const d = decisions.get(p.caseId);
              return (
                <button key={p.caseId} onClick={() => setActiveIdx(i)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8, marginBottom: 4, fontSize: 12, cursor: 'pointer', background: i === activeIdx ? 'rgba(99,102,241,0.18)' : 'transparent', border: '1px solid ' + (i === activeIdx ? 'rgba(99,102,241,0.5)' : 'transparent'), color: '#cbd5e1' }}>
                  <span style={{ fontWeight: 700 }}>{p.caseId}</span>
                  <span style={{ float: 'right', color: d ? (d.decision === 'approve' ? '#4ade80' : '#fca5a5') : '#6e7681' }}>
                    {d ? (d.decision === 'approve' ? '✓' : '✗') : '·'}
                  </span>
                </button>
              );
            })}
          </div>

          {active && (
            <div style={{ ...box, maxHeight: '75vh', overflow: 'auto' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 800 }}>{active.caseId}</span>
                <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 999, background: active.scoreReadyForReview ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.16)', color: active.scoreReadyForReview ? '#4ade80' : '#fbbf24', fontWeight: 700 }}>
                  {active.scoreReadyForReview ? t.ready : t.notReady}
                </span>
                <span style={{ fontSize: 11, color: '#8b949e' }}>{active.domain}</span>
              </div>
              {active.issues.length > 0 && (
                <div style={{ fontSize: 11.5, color: '#fbbf24', marginBottom: 10 }}>{active.issues.map(issue => <div key={issue}>• {issue}</div>)}</div>
              )}
              <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{t.axes}: {active.assertions.map(a => a.axis).join(', ') || '—'}</div>
              <div style={{ fontSize: 10.5, color: '#6e7681', marginBottom: 12, fontFamily: 'ui-monospace, monospace' }}>
                src {active.signedTarget.sourceHash.slice(0, 12)} · art {active.signedTarget.artifactHash.slice(0, 12)} · gt {active.signedTarget.groundTruthHash.slice(0, 12)}
              </div>

              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>{t.checklist}</div>
              <ul style={{ fontSize: 12, color: '#cbd5e1', paddingLeft: 18, marginBottom: 10 }}>
                {active.checklist.map(item => <li key={item} style={{ marginBottom: 3 }}>{item.replaceAll('_', ' ')}</li>)}
              </ul>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, marginBottom: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={confirmed.has(active.caseId)}
                  onChange={e => { const n = new Set(confirmed); if (e.target.checked) n.add(active.caseId); else n.delete(active.caseId); setConfirmed(n); }} />
                {t.confirm}
              </label>
              <textarea value={notes.get(active.caseId) ?? ''} placeholder={t.note}
                onChange={e => { const n = new Map(notes); n.set(active.caseId, e.target.value); setNotes(n); }}
                style={{ width: '100%', minHeight: 56, padding: 10, borderRadius: 8, background: '#0b1020', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.12)', fontSize: 12.5, marginBottom: 12 }} />
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => decide('approve')} disabled={!confirmed.has(active.caseId)}
                  style={{ padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: confirmed.has(active.caseId) ? 'pointer' : 'not-allowed', background: confirmed.has(active.caseId) ? 'rgba(34,197,94,0.2)' : 'rgba(148,163,184,0.12)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.45)' }}>
                  ✓ {t.approve}
                </button>
                <button onClick={() => decide('reject')}
                  style={{ padding: '9px 20px', borderRadius: 9, fontSize: 13, fontWeight: 800, cursor: 'pointer', background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.4)' }}>
                  ✗ {t.reject}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
