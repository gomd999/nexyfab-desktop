'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';

interface SettingsCard {
  icon: string;
  titleKo: string;
  titleEn: string;
  descKo: string;
  descEn: string;
  href: string;
}

const SETTINGS_CARDS: SettingsCard[] = [
  {
    icon: '💳',
    titleKo: '청구 설정',
    titleEn: 'Billing',
    descKo: '구독 플랜, 결제 수단, 청구 내역을 관리합니다.',
    descEn: 'Manage your subscription plan, payment method, and billing history.',
    href: '/nexyfab/settings/billing',
  },
  {
    icon: '🔐',
    titleKo: 'SSO 설정',
    titleEn: 'SSO',
    descKo: 'SAML/OIDC 기반 싱글 사인온(SSO) 설정을 구성합니다.',
    descEn: 'Configure SAML/OIDC-based Single Sign-On (SSO) settings.',
    href: '/nexyfab/settings/sso',
  },
  {
    icon: '📋',
    titleKo: '감사 로그',
    titleEn: 'Audit Log',
    descKo: '계정 내 모든 활동 및 보안 이벤트 로그를 확인합니다.',
    descEn: 'View all activity and security event logs for your account.',
    href: '/nexyfab/settings/audit',
  },
];

export default function SettingsPage() {
  const params = useParams();
  const lang = (params?.lang as string) ?? 'ko';
  const isKo = isKorean(lang);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [exporting, setExporting] = useState(false);

  async function handleExportData() {
    setExporting(true);
    try {
      const res = await fetch('/api/auth/export-data');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'nexyfab-data-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert(isKo ? '데이터 내보내기에 실패했습니다.' : 'Data export failed.');
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      isKo
        ? '정말로 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 모든 데이터가 영구 삭제됩니다.'
        : 'Are you sure you want to delete your account?\nThis action cannot be undone and all data will be permanently deleted.',
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch('/api/auth/delete-account', { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.href = '/';
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unknown error');
      setDeleting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0d1117',
      color: '#e6edf3',
      padding: '40px 24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontSize: 26, fontWeight: 800, color: '#e6edf3',
            margin: 0, letterSpacing: '-0.02em',
          }}>
            {isKo ? '설정' : 'Settings'}
          </h1>
          <p style={{ fontSize: 14, color: '#6e7681', marginTop: 6, marginBottom: 0 }}>
            {isKo ? '계정 및 보안 설정을 관리하세요' : 'Manage your account and security settings'}
          </p>
        </div>

        {/* Cards grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {SETTINGS_CARDS.map(card => (
            <div
              key={card.href}
              style={{
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 12,
                padding: '24px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 28, lineHeight: 1 }}>{card.icon}</div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#e6edf3', margin: '0 0 6px' }}>
                  {isKo ? card.titleKo : card.titleEn}
                </h2>
                <p style={{ fontSize: 13, color: '#8b949e', margin: 0, lineHeight: 1.5 }}>
                  {isKo ? card.descKo : card.descEn}
                </p>
              </div>
              <a
                href={`/${lang}${card.href}`}
                style={{
                  display: 'inline-block', alignSelf: 'flex-start',
                  padding: '7px 16px', background: '#21262d',
                  color: '#e6edf3', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', border: '1px solid #30363d',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#388bfd22';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = '#388bfd';
                  (e.currentTarget as HTMLAnchorElement).style.color = '#388bfd';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#21262d';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = '#30363d';
                  (e.currentTarget as HTMLAnchorElement).style.color = '#e6edf3';
                }}
              >
                {isKo ? '이동 →' : 'Go →'}
              </a>
            </div>
          ))}
        </div>

        {/* Data Export */}
        <div style={{
          marginTop: 32,
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: '24px 20px',
          background: '#161b22',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#e6edf3', margin: '0 0 8px' }}>
            {isKo ? '내 데이터 내보내기' : 'Export My Data'}
          </h2>
          <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 16px', lineHeight: 1.5 }}>
            {isKo
              ? 'GDPR 제20조에 따라 주문, RFQ, 프로젝트 등 모든 개인 데이터를 JSON 파일로 내보낼 수 있습니다.'
              : 'Under GDPR Article 20, you can export all your personal data (orders, RFQs, projects, etc.) as a JSON file.'}
          </p>
          <button
            onClick={handleExportData}
            disabled={exporting}
            style={{
              padding: '8px 18px',
              background: '#21262d',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: exporting ? 'not-allowed' : 'pointer',
              opacity: exporting ? 0.6 : 1,
            }}
          >
            {exporting ? (isKo ? '준비 중...' : 'Preparing...') : (isKo ? '데이터 내보내기 (.json)' : 'Download My Data (.json)')}
          </button>
        </div>

        {/* Danger Zone */}
        <div style={{
          marginTop: 48,
          border: '1px solid #f8514933',
          borderRadius: 12,
          padding: '24px 20px',
          background: '#1a0d0d',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#f85149', margin: '0 0 8px' }}>
            {isKo ? '위험 구역' : 'Danger Zone'}
          </h2>
          <p style={{ fontSize: 13, color: '#8b949e', margin: '0 0 16px', lineHeight: 1.5 }}>
            {isKo
              ? '계정을 삭제하면 모든 프로젝트, 주문, 파일이 영구적으로 제거됩니다. 이 작업은 되돌릴 수 없습니다.'
              : 'Deleting your account permanently removes all projects, orders, and files. This cannot be undone.'}
          </p>
          {deleteError && (
            <p style={{ fontSize: 13, color: '#f85149', margin: '0 0 12px' }}>{deleteError}</p>
          )}
          <button
            onClick={handleDeleteAccount}
            disabled={deleting}
            style={{
              padding: '8px 18px',
              background: 'transparent',
              color: '#f85149',
              border: '1px solid #f85149',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: deleting ? 'not-allowed' : 'pointer',
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting
              ? (isKo ? '삭제 중...' : 'Deleting...')
              : (isKo ? '계정 삭제' : 'Delete Account')}
          </button>
        </div>
      </div>
    </div>
  );
}
