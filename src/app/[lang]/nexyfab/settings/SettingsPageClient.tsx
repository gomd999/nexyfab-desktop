'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

interface SettingsCard {
  icon: string;
  titleKo: string;
  titleEn: string;
  descKo: string;
  descEn: string;
  href: string;
  titleLocalized?: Record<IsoLang, string>;
  descLocalized?: Record<IsoLang, string>;
}

export const SETTINGS_CARDS: SettingsCard[] = [
  {
    icon: '🤖',
    titleKo: '로컬 AI 연결',
    titleEn: 'Local AI Connections',
    descKo: 'Claude와 Codex/MCP 클라이언트를 프로젝트별 권한으로 연결합니다.',
    descEn: 'Connect Claude and Codex/MCP clients with project-scoped permissions.',
    titleLocalized: { ko: '로컬 AI 연결', en: 'Local AI Connections', ja: 'ローカルAI接続', zh: '本地 AI 连接', es: 'Conexiones de IA local', ar: 'اتصالات الذكاء الاصطناعي المحلي' },
    descLocalized: {
      ko: 'Claude와 Codex/MCP 클라이언트를 프로젝트별 권한으로 연결합니다.',
      en: 'Connect Claude and Codex/MCP clients with project-scoped permissions.',
      ja: 'Claude と Codex/MCP クライアントをプロジェクト単位の権限で接続します。',
      zh: '使用项目级权限连接 Claude 和 Codex/MCP 客户端。',
      es: 'Conecte Claude y clientes Codex/MCP con permisos por proyecto.',
      ar: 'صِل Claude وعملاء Codex/MCP بصلاحيات محددة لكل مشروع.',
    },
    href: '/nexyfab/settings/ai-connections',
  },
  {
    icon: '🏢',
    titleKo: '사업자 정보',
    titleEn: 'Business Profile',
    descKo: '사업자등록번호 등록 및 NTS 자동 검증. Pro 사업자 플랜 / 세금계산서 / 파트너 매칭에 사용.',
    descEn: 'BRN registration + NTS auto-verification. Required for Pro Business plan, tax invoices, partner matching.',
    titleLocalized: { ko: '사업자 정보', en: 'Business Profile', ja: '事業者プロフィール', zh: '企业资料', es: 'Perfil de empresa', ar: 'ملف الشركة' },
    descLocalized: {
      ko: '사업자등록번호 등록 및 NTS 자동 검증. Pro 사업자 플랜 / 세금계산서 / 파트너 매칭에 사용.',
      en: 'BRN registration + NTS auto-verification. Required for Pro Business plan, tax invoices, partner matching.',
      ja: '事業者登録番号の登録とNTS自動確認。Proビジネスプラン、税務請求書、パートナーマッチングに使用します。',
      zh: '注册企业登记号并进行 NTS 自动验证。用于 Pro 企业版、税务发票和合作伙伴匹配。',
      es: 'Registro del número de empresa y verificación automática de NTS. Necesario para el plan Pro Business, facturas fiscales y coincidencia de socios.',
      ar: 'تسجيل رقم المنشأة والتحقق التلقائي من NTS. مطلوب لخطة Pro Business والفواتير الضريبية ومطابقة الشركاء.',
    },
    href: '/nexyfab/settings/business',
  },
  {
    icon: '💳',
    titleKo: '청구 설정',
    titleEn: 'Billing',
    descKo: '구독 플랜, 결제 수단, 청구 내역을 관리합니다.',
    descEn: 'Manage your subscription plan, payment method, and billing history.',
    titleLocalized: { ko: '청구 설정', en: 'Billing', ja: '請求', zh: '账单', es: 'Facturación', ar: 'الفوترة' },
    descLocalized: {
      ko: '구독 플랜, 결제 수단, 청구 내역을 관리합니다.',
      en: 'Manage your subscription plan, payment method, and billing history.',
      ja: 'サブスクリプションプラン、支払い方法、請求履歴を管理します。',
      zh: '管理订阅方案、付款方式和账单记录。',
      es: 'Administre su plan de suscripción, método de pago e historial de facturación.',
      ar: 'إدارة خطة الاشتراك وطريقة الدفع وسجل الفوترة.',
    },
    href: '/nexyfab/settings/billing',
  },
  {
    icon: '🔐',
    titleKo: 'SSO 설정',
    titleEn: 'SSO',
    descKo: 'SAML/OIDC 기반 싱글 사인온(SSO) 설정을 구성합니다.',
    descEn: 'Configure SAML/OIDC-based Single Sign-On (SSO) settings.',
    titleLocalized: { ko: 'SSO 설정', en: 'SSO', ja: 'SSO設定', zh: 'SSO设置', es: 'SSO', ar: 'إعداد SSO' },
    descLocalized: {
      ko: 'SAML/OIDC 기반 싱글 사인온(SSO) 설정을 구성합니다.',
      en: 'Configure SAML/OIDC-based Single Sign-On (SSO) settings.',
      ja: 'SAML/OIDCベースのシングルサインオン（SSO）設定を構成します。',
      zh: '配置基于 SAML/OIDC 的单点登录（SSO）设置。',
      es: 'Configure los ajustes de inicio de sesión único (SSO) basados en SAML/OIDC.',
      ar: 'تكوين إعدادات الدخول الموحد (SSO) المستندة إلى SAML/OIDC.',
    },
    href: '/nexyfab/settings/sso',
  },
  {
    icon: '📋',
    titleKo: '감사 로그',
    titleEn: 'Audit Log',
    descKo: '계정 내 모든 활동 및 보안 이벤트 로그를 확인합니다.',
    descEn: 'View all activity and security event logs for your account.',
    titleLocalized: { ko: '감사 로그', en: 'Audit Log', ja: '監査ログ', zh: '审计日志', es: 'Registro de auditoría', ar: 'سجل التدقيق' },
    descLocalized: {
      ko: '계정 내 모든 활동 및 보안 이벤트 로그를 확인합니다.',
      en: 'View all activity and security event logs for your account.',
      ja: 'アカウントのすべてのアクティビティとセキュリティイベントログを確認します。',
      zh: '查看账户的所有活动和安全事件日志。',
      es: 'Consulte toda la actividad y los registros de eventos de seguridad de su cuenta.',
      ar: 'عرض جميع أنشطة الحساب وسجلات أحداث الأمان.',
    },
    href: '/nexyfab/settings/audit',
  },
];

export default function SettingsPage() {
  const params = useParams();
  const lang = (params?.lang as string) ?? 'ko';
  const isoLang = toIsoLang(lang);
  const copy = (ko: string, en: string) => createCommercialLocalizer(lang)(ko, en);
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
      alert(copy('데이터 내보내기에 실패했습니다.', 'Data export failed.'));
    } finally {
      setExporting(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      copy('정말로 계정을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없으며 모든 데이터가 영구 삭제됩니다.', 'Are you sure you want to delete your account?\nThis action cannot be undone and all data will be permanently deleted.'),
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
      background: 'var(--nx-bg)',
      color: 'var(--nx-text)',
      padding: '40px 24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{
            fontSize: 26, fontWeight: 800, color: 'var(--nx-text)',
            margin: 0, letterSpacing: '-0.02em',
          }}>
            {copy('설정', 'Settings')}
          </h1>
          <p style={{ fontSize: 14, color: 'var(--nx-text-3)', marginTop: 6, marginBottom: 0 }}>
            {copy('계정 및 보안 설정을 관리하세요', 'Manage your account and security settings')}
          </p>
        </div>

        {/* Cards grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {SETTINGS_CARDS.map(card => (
            <div
              key={card.href}
              style={{
                background: 'var(--nx-panel)',
                border: '1px solid var(--nx-border)',
                borderRadius: 12,
                padding: '24px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
              }}
            >
              <div style={{ fontSize: 28, lineHeight: 1 }}>{card.icon}</div>
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--nx-text)', margin: '0 0 6px' }}>
                  {card.titleLocalized?.[isoLang] ?? copy(card.titleKo, card.titleEn)}
                </h2>
                <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: 0, lineHeight: 1.5 }}>
                  {card.descLocalized?.[isoLang] ?? copy(card.descKo, card.descEn)}
                </p>
              </div>
              <a
                href={`/${lang}${card.href}`}
                style={{
                  display: 'inline-block', alignSelf: 'flex-start',
                  padding: '7px 16px', background: 'var(--nx-panel-2)',
                  color: 'var(--nx-text)', borderRadius: 8, fontSize: 13, fontWeight: 600,
                  textDecoration: 'none', border: '1px solid var(--nx-border)',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLAnchorElement).style.background = '#388bfd22';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = '#388bfd';
                  (e.currentTarget as HTMLAnchorElement).style.color = '#388bfd';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-panel-2)';
                  (e.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--nx-border)';
                  (e.currentTarget as HTMLAnchorElement).style.color = 'var(--nx-text)';
                }}
              >
                {copy('이동 →', 'Go →')}
              </a>
            </div>
          ))}
        </div>

        {/* Data Export */}
        <div style={{
          marginTop: 32,
          border: '1px solid var(--nx-border)',
          borderRadius: 12,
          padding: '24px 20px',
          background: 'var(--nx-panel)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--nx-text)', margin: '0 0 8px' }}>
            {copy('내 데이터 내보내기', 'Export My Data')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {copy('GDPR 제20조에 따라 주문, RFQ, 프로젝트 등 모든 개인 데이터를 JSON 파일로 내보낼 수 있습니다.', 'Under GDPR Article 20, you can export all your personal data (orders, RFQs, projects, etc.) as a JSON file.')}
          </p>
          <button
            onClick={handleExportData}
            disabled={exporting}
            style={{
              padding: '8px 18px',
              background: 'var(--nx-panel-2)',
              color: 'var(--nx-text)',
              border: '1px solid var(--nx-border)',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: exporting ? 'not-allowed' : 'pointer',
              opacity: exporting ? 0.6 : 1,
            }}
          >
            {exporting ? copy('준비 중...', 'Preparing...') : copy('데이터 내보내기 (.json)', 'Download My Data (.json)')}
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
            {copy('위험 구역', 'Danger Zone')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--nx-text-2)', margin: '0 0 16px', lineHeight: 1.5 }}>
            {copy('계정을 삭제하면 모든 프로젝트, 주문, 파일이 영구적으로 제거됩니다. 이 작업은 되돌릴 수 없습니다.', 'Deleting your account permanently removes all projects, orders, and files. This cannot be undone.')}
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
              ? copy('삭제 중...', 'Deleting...')
              : copy('계정 삭제', 'Delete Account')}
          </button>
        </div>
      </div>
    </div>
  );
}
