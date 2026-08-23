'use client';

// /admin/settings — runtime config + API key rotation.
//
// Read-only for regular admin (sees masked values). Super admin can
// rotate values via inline form. All mutations write to nf_admin_audit
// so we can answer "who rotated this and when" for any incident.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useAdminI18n } from '../AdminI18nProvider';

interface Setting {
  key: string;
  scope: 'api_key' | 'feature_flag' | 'budget' | 'config';
  description: string;
  maskedValue: string;
  plainValue: string | null;
  hasValue: boolean;
  source: 'db' | 'env' | 'unset';
  updatedBy: string | null;
  updatedAt: number | null;
}

interface SettingsResp {
  isSuper: boolean;
  settings: Setting[];
}

interface AuditRow {
  id: string;
  adminUserId: string;
  action: string;
  target: string | null;
  oldValueHash: string | null;
  newValueHash: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: number;
}

const SCOPE_COLOR: Record<string, string> = {
  api_key:      '#f85149',
  feature_flag: '#a371f7',
  budget:       '#d29922',
  config:       '#79c0ff',
};

const SOURCE_LABEL: Record<Setting['source'], { label: string; color: string }> = {
  db:    { label: 'DB',    color: '#3fb950' },
  env:   { label: 'ENV',   color: '#79c0ff' },
  unset: { label: 'unset', color: '#6e7681' },
};

export default function AdminSettingsPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [data, setData] = useState<SettingsResp | null>(null);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [filterTarget, setFilterTarget] = useState<string | null>(null);
  const qwen38Setting = data?.settings.find(setting => setting.key === 'ai.model.qwen_3_8_max');
  const lunaFlag = data?.settings.find(setting => setting.key === 'feature.ai_luna_parallel.enabled');

  const load = useCallback(async () => {
    const [sRes, aRes] = await Promise.all([
      fetch('/api/admin/settings', { credentials: 'include' }),
      fetch(`/api/admin/admin-actions?windowH=168${filterTarget ? `&target=${encodeURIComponent(filterTarget)}` : ''}`, { credentials: 'include' }),
    ]);
    if (sRes.ok) setData(await sRes.json() as SettingsResp);
    if (aRes.ok) {
      const j = await aRes.json() as { rows: AuditRow[] };
      setAuditRows(j.rows);
    }
  }, [filterTarget]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (key: string) => {
    if (submitting) return;
    if (!editValue.trim()) { setSubmitErr(L('값을 입력하세요', 'Enter a value.')); return; }
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setEditingKey(null);
      setEditValue('');
      await load();
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>🔐 {L('관리자 설정', 'Admin settings')}</h1>
      <p style={subtitleStyle}>
        {L('런타임 설정 + API 키.', 'Runtime settings + API keys.')} {data?.isSuper ? <span style={{ color: '#3fb950' }}>{L('● super_admin (수정 가능)', '● super_admin (editable)')}</span> : <span style={{ color: '#d29922' }}>{L('● admin (읽기 전용)', '● admin (read-only)')}</span>}.
        {' '}{L('모든 변경은 감사 로그에 기록됩니다.', 'All changes are recorded in the audit log.')}
      </p>

      <div style={{ ...panelStyle, marginBottom: 16 }}>
        <h3 style={panelTitleStyle}>{L('AI 설계 실행 정책', 'AI design execution policy')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
          <div style={settingRowStyle}>
            <strong style={{ color: '#e6edf3', fontSize: 12 }}>{L('기본 모델', 'Default model')}</strong>
            <div style={mutedStyle}>{L('Free: GPT Luna · Pro/Team: DeepSeek Pro · Enterprise: GPT Terra', 'Free: GPT Luna · Pro/Team: DeepSeek Pro · Enterprise: GPT Terra')}</div>
          </div>
          <div style={settingRowStyle}>
            <strong style={{ color: '#e6edf3', fontSize: 12 }}>{L('VL 라우팅', 'VL routing')}</strong>
            <div style={mutedStyle}>{L('선택 모델의 native VL 우선 · 일시 장애/미지원 시 GPT Luna', 'Prefer native VL for the selected model; fall back to GPT Luna during outages or when unsupported.')}</div>
          </div>
          <div style={settingRowStyle}>
            <strong style={{ color: '#e6edf3', fontSize: 12 }}>{L('입력 캐시', 'Input cache')}</strong>
            <div style={mutedStyle}>{L('긴 안정 prefix만 명시적 캐시 · 짧은 요청은 provider 자동 캐시', 'Cache only long, stable prefixes explicitly; providers cache short requests automatically.')}</div>
          </div>
          <div style={settingRowStyle}>
            <strong style={{ color: '#e6edf3', fontSize: 12 }}>{L('Luna 보조', 'Luna assistant')}</strong>
            <div style={mutedStyle}>{L('복잡/모호 요청만 1회 구조화 점검 · 설정:', 'One structured review for complex or ambiguous requests · setting:')} {lunaFlag?.source ?? L('미설정', 'Unset')}</div>
          </div>
          <div style={{ ...settingRowStyle, borderInlineStart: '3px solid #d29922' }}>
            <strong style={{ color: '#f0b429', fontSize: 12 }}>Qwen 3.8 Max Preview</strong>
            <div style={mutedStyle}>{L('Token Plan/계정별 가용성 검증 필요 · runtime mapping:', 'Token Plan/account availability must be verified · runtime mapping:')} {qwen38Setting?.source ?? L('기본 preview ID', 'Default preview ID')}</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 16 }}>

        {/* Settings table */}
        <div style={panelStyle}>
          <h3 style={panelTitleStyle}>{L(`설정 (${data?.settings.length ?? 0})`, `Settings (${data?.settings.length ?? 0})`)}</h3>
          {!data && <div style={mutedStyle}>{L('불러오는 중…', 'Loading…')}</div>}
          {data && data.settings.map(s => {
            const src = SOURCE_LABEL[s.source];
            const isEditing = editingKey === s.key;
            return (
              <div key={s.key} style={{
                ...settingRowStyle,
                borderLeft: `3px solid ${SCOPE_COLOR[s.scope] ?? '#30363d'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                  <code style={{ fontSize: 12, color: '#e6edf3', fontWeight: 700 }}>{s.key}</code>
                  <span style={{
                    padding: '1px 6px', fontSize: 9, fontWeight: 700,
                    background: `${SCOPE_COLOR[s.scope] ?? '#30363d'}33`,
                    color: SCOPE_COLOR[s.scope] ?? '#9ca3af', borderRadius: 3,
                  }}>{s.scope === 'api_key' ? L('API 키', 'API key') : s.scope === 'feature_flag' ? L('기능 플래그', 'Feature flag') : s.scope === 'budget' ? L('예산', 'Budget') : L('설정', 'Config')}</span>
                  <span style={{
                    padding: '1px 6px', fontSize: 9, fontWeight: 700,
                    background: `${src.color}22`, color: src.color, borderRadius: 3,
                  }}>{src.label === 'unset' ? L('미설정', 'Unset') : src.label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#6e7681' }}>
                    {s.updatedAt ? new Date(s.updatedAt).toLocaleString(locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale) : '-'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 6 }}>{s.description}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {isEditing ? (
                    <>
                      <input
                        type={s.scope === 'api_key' ? 'password' : 'text'}
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        placeholder={s.scope === 'api_key' ? L('새 키 입력', 'Enter new key') : L('새 값 입력', 'Enter new value')}
                        style={inputStyle}
                        autoFocus
                      />
                      <button onClick={() => void submit(s.key)} disabled={submitting} style={confirmBtnStyle}>
                        {submitting ? L('저장 중…', 'Saving…') : L('저장', 'Save')}
                      </button>
                      <button onClick={() => { setEditingKey(null); setEditValue(''); setSubmitErr(null); }} style={cancelBtnStyle}>
                        {L('취소', 'Cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <code style={valueDisplayStyle}>
                        {s.scope === 'api_key' ? s.maskedValue : (s.plainValue ?? s.maskedValue)}
                      </code>
                      <span style={{ flex: 1 }} />
                      {data.isSuper && (
                        <button
                          onClick={() => { setEditingKey(s.key); setEditValue(''); setSubmitErr(null); }}
                          style={rotateBtnStyle}
                        >
                          {s.hasValue ? L('🔄 회전', '🔄 Rotate') : L('+ 설정', '+ Set')}
                        </button>
                      )}
                      <button
                        onClick={() => setFilterTarget(filterTarget === s.key ? null : s.key)}
                        style={historyBtnStyle}
title={L('이 설정의 변경 이력만 보기', 'Show history for this setting only')}
                      >
                        📜
                      </button>
                    </>
                  )}
                </div>
                {isEditing && submitErr && <div style={errStyle}>{submitErr}</div>}
              </div>
            );
          })}
        </div>

        {/* Audit log sidebar */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={panelTitleStyle}>
              {L('감사 로그 (7일)', 'Audit log (7 days)')}
              {filterTarget && <span style={{ fontSize: 11, color: '#79c0ff', marginLeft: 6 }}>· {filterTarget}</span>}
            </h3>
            {filterTarget && (
              <button onClick={() => setFilterTarget(null)} style={{ ...cancelBtnStyle, padding: '2px 8px' }}>{L('전체', 'All')}</button>
            )}
          </div>
          {auditRows.length === 0 && <div style={mutedStyle}>{L('변경 이력 없음', 'No change history')}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {auditRows.map(r => (
              <div key={r.id} style={auditRowStyle}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                  <code style={{ fontSize: 10, color: '#79c0ff', fontWeight: 700 }}>{r.action}</code>
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 9, color: '#6e7681' }}>{new Date(r.createdAt).toLocaleString(locale === 'ko' ? 'ko-KR' : locale === 'zh' ? 'zh-CN' : locale)}</span>
                </div>
                {r.target && <div style={{ fontSize: 11, color: '#c9d1d9', marginBottom: 2 }}>{r.target}</div>}
                <div style={{ fontSize: 9, color: '#6e7681', fontFamily: 'monospace' }}>
                  {L('작업자', 'by')} {r.adminUserId.slice(0, 12)}
                  {r.oldValueHash && ` · ${r.oldValueHash.slice(0, 8)} → ${r.newValueHash?.slice(0, 8) ?? 'null'}`}
                  {r.ipAddress && ` · ${r.ipAddress}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  padding: 24, color: '#e6edf3',
  fontFamily: 'system-ui, sans-serif', background: '#0d1117', minHeight: '100vh',
};
const titleStyle: React.CSSProperties = { fontSize: 24, fontWeight: 800, marginBottom: 4 };
const subtitleStyle: React.CSSProperties = { fontSize: 13, color: '#8b949e', margin: '0 0 20px' };
const panelStyle: React.CSSProperties = {
  background: '#161b22', border: '1px solid #30363d', borderRadius: 10, padding: 16,
};
const panelTitleStyle: React.CSSProperties = { fontSize: 14, fontWeight: 700, margin: '0 0 12px' };
const mutedStyle: React.CSSProperties = { color: '#8b949e', fontSize: 12, padding: 12, textAlign: 'center' };
const settingRowStyle: React.CSSProperties = {
  padding: 10, marginBottom: 8,
  background: '#0d1117', borderRadius: 6,
};
const valueDisplayStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 12, fontFamily: 'monospace',
  background: '#010409', borderRadius: 4, color: '#c9d1d9',
};
const inputStyle: React.CSSProperties = {
  flex: 1, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace',
  background: '#010409', border: '1px solid #30363d', borderRadius: 4,
  color: '#e6edf3', outline: 'none',
};
const rotateBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11, fontWeight: 600,
  background: '#1f6feb', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const historyBtnStyle: React.CSSProperties = {
  padding: '4px 6px', fontSize: 11,
  background: 'transparent', color: '#9ca3af',
  border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer',
};
const confirmBtnStyle: React.CSSProperties = {
  padding: '4px 12px', fontSize: 11, fontWeight: 700,
  background: '#3fb950', color: '#fff',
  border: 'none', borderRadius: 4, cursor: 'pointer',
};
const cancelBtnStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 11,
  background: 'transparent', color: '#9ca3af',
  border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer',
};
const errStyle: React.CSSProperties = {
  marginTop: 6, padding: 6, fontSize: 11,
  background: '#1c1110', color: '#f85149',
  border: '1px solid #f8514940', borderRadius: 4,
};
const auditRowStyle: React.CSSProperties = {
  padding: 8, background: '#0d1117', borderRadius: 4,
  borderLeft: '2px solid #21262d',
};
