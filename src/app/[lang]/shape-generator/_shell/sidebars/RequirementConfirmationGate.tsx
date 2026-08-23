'use client';

import type { GuidedRequirementGate, GuidedRequirementValueState } from '@/lib/ai/guidedDesignBrief';
import type { RuntimeDesignLock } from '../../ai/manualEditProtectionStore';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

const tone: Record<GuidedRequirementValueState, string> = {
  AUTHORITATIVE: 'var(--nx-ok, #4ade80)',
  ASSUMED: 'var(--nx-warn, #fbbf24)',
  MISSING: 'var(--nx-danger, #f87171)',
  CONFLICT: 'var(--nx-danger, #f87171)',
};

export function RequirementConfirmationGate({
  gate,
  locks,
  lang,
  context = 'intake',
}: {
  gate: GuidedRequirementGate;
  locks: readonly RuntimeDesignLock[];
  lang: string;
  context?: 'intake' | 'candidate';
}) {
  const L = createCommercialLocalizer(lang);
  const next = gate.nextInput;
  const nextQuestion = next
    ? next.reason === 'CONFLICT'
      ? L(`${next.label}: 서로 다른 대안 중 하나를 확정해 주세요.`, `${next.label}: confirm one value and remove unresolved alternatives.`)
      : next.reason === 'ASSUMED'
        ? L(`${next.label}: 가정값 대신 확인된 값을 입력해 주세요.`, `${next.label}: replace the assumption with a confirmed value.`)
        : L(`${next.label}을(를) 알려주세요.`, `Please provide ${next.label}.`)
    : L('필수 요구사항이 사용자 확인값으로 확정되었습니다.', 'Required inputs are user-confirmed.');

  return (
    <section
      aria-label={context === 'candidate'
        ? (L('CAD 후보 요구사항 확정 게이트', 'CAD candidate requirement confirmation gate'))
        : (L('설계 입력 요구사항 확정 게이트', 'Design intake requirement confirmation gate'))}
      data-testid="requirement-confirmation-gate"
      style={{ display: 'grid', gap: 6, padding: 8, border: `1px solid ${gate.ready ? 'var(--nx-ok, #4ade80)' : 'var(--nx-warn, #fbbf24)'}`, borderRadius: 6, background: 'var(--nx-panel-2)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ fontSize: 10 }}>{L('요구사항 확정', 'Requirements')}</strong>
        <strong data-testid="requirement-gate-state" style={{ fontSize: 10, color: gate.ready ? 'var(--nx-ok, #4ade80)' : 'var(--nx-danger, #f87171)' }}>
          {gate.ready ? 'AUTHORITATIVE' : 'BLOCKED'}
        </strong>
      </div>
      <ul style={{ display: 'grid', gap: 4, margin: 0, padding: 0, listStyle: 'none' }}>
        {gate.items.map(item => {
          const locked = locks.some(lock => lock.target.kind === 'authoritative_input'
            && lock.target.objectId === item.lockObjectId && lock.target.field === item.key);
          return (
            <li key={`${item.domain}:${item.key}`} data-testid={`requirement-item-${item.domain}-${item.key}`} data-locked={locked || undefined} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 4, fontSize: 9.5 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={item.value === undefined ? item.label : `${item.label}: ${String(item.value)}`}>
                {locked ? '🔒 ' : ''}{item.label}{item.value === undefined ? '' : ` · ${String(item.value)}`}
              </span>
              <strong style={{ color: tone[item.state] }}>{item.state}</strong>
            </li>
          );
        })}
      </ul>
      <p role={gate.ready ? 'status' : 'alert'} aria-live="polite" style={{ margin: 0, color: gate.ready ? 'var(--nx-text-2)' : 'var(--nx-warn, #fbbf24)', fontSize: 9.5, lineHeight: 1.4 }}>
        {L('다음 질문: ', 'Next question: ')}{nextQuestion}
      </p>
    </section>
  );
}
