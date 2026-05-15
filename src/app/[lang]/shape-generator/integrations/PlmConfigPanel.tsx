'use client';

// G9 — PLM/ERP connector config panel for F9.
//
// Lets the user pick a provider (SAP/Odoo/Windchill/Generic), enter base URL
// + API token, test the connection, and push the current BOM. Tokens are
// persisted to sessionStorage by default — for a production deployment they
// should move to an encrypted preference store (CF KV).

import React, { useState } from 'react';
import {
  pushBomToPlm, testPlmConnection,
  type PlmEndpoint, type PlmProvider, type PlmPushPayload, type BomLineForPlm,
} from './plmConnector';

interface PlmConfigPanelProps {
  open: boolean;
  /** Project name for the BOM header. */
  projectName: string;
  /** Current BOM lines — built by caller from bomParts. */
  bomLines: BomLineForPlm[];
  lang: 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';
  onClose: () => void;
}

const PROVIDER_LABELS: Record<PlmProvider, string> = {
  sap:        'SAP',
  oracle:     'Oracle Agile',
  odoo:       'Odoo',
  windchill:  'PTC Windchill',
  teamcenter: 'Siemens Teamcenter',
  generic:    'Generic REST',
};

const dict = {
  ko: { title: 'PLM/ERP 연동', provider: '시스템', baseUrl: '베이스 URL', token: 'API 토큰', tenantId: '테넌트 ID (선택)', test: '연결 테스트', push: 'BOM 전송', testing: '테스트 중…', pushing: '전송 중…', success: '성공', failed: '실패', noBom: 'BOM이 비어 있습니다.', tokenHint: '토큰은 세션에만 저장됩니다 (브라우저 새로고침 시 재입력)' },
  en: { title: 'PLM / ERP Integration', provider: 'System', baseUrl: 'Base URL', token: 'API Token', tenantId: 'Tenant ID (optional)', test: 'Test Connection', push: 'Push BOM', testing: 'Testing…', pushing: 'Pushing…', success: 'Success', failed: 'Failed', noBom: 'BOM is empty.', tokenHint: 'Token is stored only for the current session (re-enter on reload).' },
  ja: { title: 'PLM/ERP 連携', provider: 'システム', baseUrl: 'ベース URL', token: 'API トークン', tenantId: 'テナント ID', test: '接続テスト', push: 'BOM 送信', testing: 'テスト中…', pushing: '送信中…', success: '成功', failed: '失敗', noBom: 'BOM が空です', tokenHint: 'トークンはセッションのみに保存されます' },
  zh: { title: 'PLM/ERP 集成', provider: '系统', baseUrl: '基础 URL', token: 'API 令牌', tenantId: '租户 ID', test: '测试连接', push: '推送 BOM', testing: '测试中…', pushing: '推送中…', success: '成功', failed: '失败', noBom: 'BOM 为空', tokenHint: '令牌仅在当前会话存储' },
  es: { title: 'Integración PLM/ERP', provider: 'Sistema', baseUrl: 'URL Base', token: 'Token API', tenantId: 'ID Tenant', test: 'Probar Conexión', push: 'Enviar BOM', testing: 'Probando…', pushing: 'Enviando…', success: 'Éxito', failed: 'Falló', noBom: 'BOM vacío', tokenHint: 'El token solo se guarda en la sesión actual' },
  ar: { title: 'تكامل PLM/ERP', provider: 'النظام', baseUrl: 'URL الأساسي', token: 'رمز API', tenantId: 'معرف المستأجر', test: 'اختبار الاتصال', push: 'إرسال BOM', testing: 'جاري الاختبار…', pushing: 'جاري الإرسال…', success: 'نجاح', failed: 'فشل', noBom: 'BOM فارغ', tokenHint: 'يُحفظ الرمز للجلسة فقط' },
};

const C = {
  bg: 'var(--nx-panel)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  muted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent-2)',
  green: 'var(--nx-ok)',
  red: 'var(--nx-error)',
  cellBg: 'var(--nx-bg)',
};

export default function PlmConfigPanel({
  open, projectName, bomLines, lang, onClose,
}: PlmConfigPanelProps) {
  const t = dict[lang] ?? dict.en;
  const [provider, setProvider] = useState<PlmProvider>('generic');
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [status, setStatus] = useState<{ kind: 'idle' | 'testing' | 'pushing'; result?: string; ok?: boolean }>({ kind: 'idle' });

  if (!open) return null;

  const endpoint: PlmEndpoint = {
    provider,
    baseUrl: baseUrl.trim(),
    token: token.trim(),
    ...(tenantId.trim() ? { tenantId: tenantId.trim() } : {}),
  };

  const handleTest = async () => {
    setStatus({ kind: 'testing' });
    const r = await testPlmConnection(endpoint);
    setStatus({
      kind: 'idle',
      ok: r.ok,
      result: r.ok ? `${t.success} (HTTP ${r.status ?? '?'})` : `${t.failed}: ${r.error ?? r.status}`,
    });
  };

  const handlePush = async () => {
    if (bomLines.length === 0) {
      setStatus({ kind: 'idle', ok: false, result: t.noBom });
      return;
    }
    setStatus({ kind: 'pushing' });
    const payload: PlmPushPayload = {
      projectName,
      bomLines,
    };
    const r = await pushBomToPlm(endpoint, payload);
    setStatus({
      kind: 'idle',
      ok: r.ok,
      result: r.ok
        ? `${t.success}${r.remoteId ? ` (id=${r.remoteId})` : ''}`
        : `${t.failed}: ${r.error ?? `HTTP ${r.status}`}`,
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, color: C.text, borderRadius: 10,
          padding: 20, width: 480, border: `1px solid ${C.border}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>🔗 {t.title}</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ fontSize: 12, color: C.muted }}>
            {t.provider}
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as PlmProvider)}
              style={inputStyle}
            >
              {(Object.keys(PROVIDER_LABELS) as PlmProvider[]).map(p => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: C.muted }}>
            {t.baseUrl}
            <input
              type="url"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://erp.acme.com/api/v2"
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 12, color: C.muted }}>
            {t.token}
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 12, color: C.muted }}>
            {t.tenantId}
            <input
              type="text"
              value={tenantId}
              onChange={e => setTenantId(e.target.value)}
              style={inputStyle}
            />
          </label>
          <div style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>{t.tokenHint}</div>

          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              onClick={handleTest}
              disabled={!baseUrl || status.kind !== 'idle'}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.accent}`,
                background: 'transparent', color: C.accent, fontSize: 12, fontWeight: 600,
                cursor: !baseUrl || status.kind !== 'idle' ? 'not-allowed' : 'pointer',
              }}
            >
              {status.kind === 'testing' ? t.testing : t.test}
            </button>
            <button
              onClick={handlePush}
              disabled={!baseUrl || !token || bomLines.length === 0 || status.kind !== 'idle'}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 6, border: 'none',
                background: (baseUrl && token && bomLines.length > 0 && status.kind === 'idle') ? C.green : 'var(--nx-border-strong)',
                color: 'var(--nx-text)', fontSize: 12, fontWeight: 700,
                cursor: !baseUrl || !token || bomLines.length === 0 || status.kind !== 'idle' ? 'not-allowed' : 'pointer',
              }}
            >
              {status.kind === 'pushing' ? t.pushing : `${t.push} (${bomLines.length})`}
            </button>
          </div>

          {status.result && (
            <div style={{
              marginTop: 4, padding: '6px 10px', borderRadius: 6, fontSize: 11,
              background: status.ok ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)',
              color: status.ok ? C.green : C.red,
              wordBreak: 'break-all',
            }}>
              {status.result}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', marginTop: 4, padding: '6px 8px',
  background: C.cellBg, color: C.text, borderRadius: 6,
  border: `1px solid ${C.border}`, fontSize: 13,
};
