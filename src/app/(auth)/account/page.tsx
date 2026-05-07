'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000';
const NEXYSYS_URL = process.env.NEXT_PUBLIC_NEXYSYS_URL || 'http://localhost:5173';

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free: { label: 'Free', color: '#6b7280' },
  pro: { label: 'Pro', color: '#0b5cff' },
  team: { label: 'Team', color: '#8b5cf6' },
  enterprise: { label: 'Enterprise', color: '#d97706' },
};

type AccountLang = 'ko' | 'en' | 'zh' | 'ja' | 'es' | 'ar';

const ACCOUNT_I18N: Record<AccountLang, {
  portalError: string; networkError: string; loading: string;
  billingUnavailable: string; currentPlan: string; memberSince: string;
  upgradeToPro: string; loadingPortal: string; manageSubscription: string;
  billingHistory: string; paymentComplete: string;
  backToNexyFab: string; sessionExpired: string; loginBtn: string;
  editBtn: string; nameLabel: string; languageLabel: string;
  saving: string; saveBtn: string; cancelBtn: string;
  emailLabel: string; titleLabel: string; langLabel: string;
  availableServices: string;
  changePassword: string; currentPasswordLabel: string;
  newPasswordLabel: string; confirmPasswordLabel: string;
  passwordMismatch: string; passwordMinLength: string;
  changingPassword: string; changePasswordBtn: string;
  passwordChanged: string; profileUpdated: string;
  profileUpdateFailed: string; passwordChangeFailed: string;
  subscriptionTitle: string; logoutBtn: string;
}> = {
  ko: {
    portalError: '포털을 열 수 없습니다.',
    networkError: '네트워크 오류',
    loading: '로딩 중...',
    billingUnavailable: '결제 정보를 불러올 수 없습니다.',
    currentPlan: '현재 플랜: ',
    memberSince: '가입일: ',
    upgradeToPro: 'Pro로 업그레이드',
    loadingPortal: '로딩...',
    manageSubscription: '구독 관리 (변경/취소/결제수단)',
    billingHistory: '결제 이력',
    paymentComplete: '결제 완료',
    backToNexyFab: 'NexyFab으로 돌아가기',
    sessionExpired: '세션이 만료되었습니다. 다시 로그인해주세요.',
    loginBtn: '로그인',
    editBtn: '수정',
    nameLabel: '이름',
    languageLabel: '언어',
    saving: '저장 중...',
    saveBtn: '저장',
    cancelBtn: '취소',
    emailLabel: '이메일',
    titleLabel: '직함',
    langLabel: '언어',
    availableServices: '이용 가능 서비스',
    changePassword: '비밀번호 변경',
    currentPasswordLabel: '현재 비밀번호',
    newPasswordLabel: '새 비밀번호',
    confirmPasswordLabel: '새 비밀번호 확인',
    passwordMismatch: '새 비밀번호가 일치하지 않습니다.',
    passwordMinLength: '비밀번호는 8자 이상이어야 합니다.',
    changingPassword: '변경 중...',
    changePasswordBtn: '비밀번호 변경',
    passwordChanged: '비밀번호가 변경되었습니다.',
    profileUpdated: '프로필이 업데이트되었습니다.',
    profileUpdateFailed: '프로필 업데이트에 실패했습니다.',
    passwordChangeFailed: '비밀번호 변경에 실패했습니다.',
    subscriptionTitle: '구독 & 결제 관리',
    logoutBtn: '로그아웃',
  },
  en: {
    portalError: 'Unable to open portal.',
    networkError: 'Network error',
    loading: 'Loading...',
    billingUnavailable: 'Unable to load billing information.',
    currentPlan: 'Current plan: ',
    memberSince: 'Member since: ',
    upgradeToPro: 'Upgrade to Pro',
    loadingPortal: 'Loading...',
    manageSubscription: 'Manage Subscription',
    billingHistory: 'Billing History',
    paymentComplete: 'Payment Complete',
    backToNexyFab: 'Back to NexyFab',
    sessionExpired: 'Session expired. Please log in again.',
    loginBtn: 'Log in',
    editBtn: 'Edit',
    nameLabel: 'Name',
    languageLabel: 'Language',
    saving: 'Saving...',
    saveBtn: 'Save',
    cancelBtn: 'Cancel',
    emailLabel: 'Email',
    titleLabel: 'Title',
    langLabel: 'Language',
    availableServices: 'Available Services',
    changePassword: 'Change Password',
    currentPasswordLabel: 'Current Password',
    newPasswordLabel: 'New Password',
    confirmPasswordLabel: 'Confirm New Password',
    passwordMismatch: 'New passwords do not match.',
    passwordMinLength: 'Password must be at least 8 characters.',
    changingPassword: 'Changing...',
    changePasswordBtn: 'Change Password',
    passwordChanged: 'Password has been changed.',
    profileUpdated: 'Profile updated.',
    profileUpdateFailed: 'Failed to update profile.',
    passwordChangeFailed: 'Failed to change password.',
    subscriptionTitle: 'Subscription & Billing',
    logoutBtn: 'Log out',
  },
  zh: {
    portalError: '无法打开门户。',
    networkError: '网络错误',
    loading: '加载中...',
    billingUnavailable: '无法加载计费信息。',
    currentPlan: '当前套餐: ',
    memberSince: '注册日期: ',
    upgradeToPro: '升级到 Pro',
    loadingPortal: '加载中...',
    manageSubscription: '管理订阅',
    billingHistory: '账单记录',
    paymentComplete: '支付完成',
    backToNexyFab: '返回 NexyFab',
    sessionExpired: '会话已过期，请重新登录。',
    loginBtn: '登录',
    editBtn: '编辑',
    nameLabel: '姓名',
    languageLabel: '语言',
    saving: '保存中...',
    saveBtn: '保存',
    cancelBtn: '取消',
    emailLabel: '邮箱',
    titleLabel: '职位',
    langLabel: '语言',
    availableServices: '可用服务',
    changePassword: '更改密码',
    currentPasswordLabel: '当前密码',
    newPasswordLabel: '新密码',
    confirmPasswordLabel: '确认新密码',
    passwordMismatch: '新密码不一致。',
    passwordMinLength: '密码至少需要8个字符。',
    changingPassword: '更改中...',
    changePasswordBtn: '更改密码',
    passwordChanged: '密码已更改。',
    profileUpdated: '个人资料已更新。',
    profileUpdateFailed: '个人资料更新失败。',
    passwordChangeFailed: '密码更改失败。',
    subscriptionTitle: '订阅 & 账单管理',
    logoutBtn: '退出登录',
  },
  ja: {
    portalError: 'ポータルを開けません。',
    networkError: 'ネットワークエラー',
    loading: '読み込み中...',
    billingUnavailable: '請求情報を読み込めません。',
    currentPlan: '現在のプラン: ',
    memberSince: '登録日: ',
    upgradeToPro: 'Proにアップグレード',
    loadingPortal: '読み込み中...',
    manageSubscription: 'サブスクリプション管理',
    billingHistory: '請求履歴',
    paymentComplete: '支払い完了',
    backToNexyFab: 'NexyFabに戻る',
    sessionExpired: 'セッションが期限切れです。再度ログインしてください。',
    loginBtn: 'ログイン',
    editBtn: '編集',
    nameLabel: '名前',
    languageLabel: '言語',
    saving: '保存中...',
    saveBtn: '保存',
    cancelBtn: 'キャンセル',
    emailLabel: 'メール',
    titleLabel: '役職',
    langLabel: '言語',
    availableServices: '利用可能なサービス',
    changePassword: 'パスワード変更',
    currentPasswordLabel: '現在のパスワード',
    newPasswordLabel: '新しいパスワード',
    confirmPasswordLabel: '新しいパスワードの確認',
    passwordMismatch: '新しいパスワードが一致しません。',
    passwordMinLength: 'パスワードは8文字以上必要です。',
    changingPassword: '変更中...',
    changePasswordBtn: 'パスワード変更',
    passwordChanged: 'パスワードが変更されました。',
    profileUpdated: 'プロフィールが更新されました。',
    profileUpdateFailed: 'プロフィールの更新に失敗しました。',
    passwordChangeFailed: 'パスワードの変更に失敗しました。',
    subscriptionTitle: 'サブスクリプション & 請求管理',
    logoutBtn: 'ログアウト',
  },
  es: {
    portalError: 'No se puede abrir el portal.',
    networkError: 'Error de red',
    loading: 'Cargando...',
    billingUnavailable: 'No se puede cargar la informacion de facturacion.',
    currentPlan: 'Plan actual: ',
    memberSince: 'Miembro desde: ',
    upgradeToPro: 'Actualizar a Pro',
    loadingPortal: 'Cargando...',
    manageSubscription: 'Gestionar suscripcion',
    billingHistory: 'Historial de facturacion',
    paymentComplete: 'Pago completado',
    backToNexyFab: 'Volver a NexyFab',
    sessionExpired: 'Sesion expirada. Por favor, inicie sesion de nuevo.',
    loginBtn: 'Iniciar sesion',
    editBtn: 'Editar',
    nameLabel: 'Nombre',
    languageLabel: 'Idioma',
    saving: 'Guardando...',
    saveBtn: 'Guardar',
    cancelBtn: 'Cancelar',
    emailLabel: 'Correo electronico',
    titleLabel: 'Cargo',
    langLabel: 'Idioma',
    availableServices: 'Servicios disponibles',
    changePassword: 'Cambiar contrasena',
    currentPasswordLabel: 'Contrasena actual',
    newPasswordLabel: 'Nueva contrasena',
    confirmPasswordLabel: 'Confirmar nueva contrasena',
    passwordMismatch: 'Las nuevas contrasenas no coinciden.',
    passwordMinLength: 'La contrasena debe tener al menos 8 caracteres.',
    changingPassword: 'Cambiando...',
    changePasswordBtn: 'Cambiar contrasena',
    passwordChanged: 'Contrasena cambiada.',
    profileUpdated: 'Perfil actualizado.',
    profileUpdateFailed: 'Error al actualizar el perfil.',
    passwordChangeFailed: 'Error al cambiar la contrasena.',
    subscriptionTitle: 'Suscripcion & Facturacion',
    logoutBtn: 'Cerrar sesion',
  },
  ar: {
    portalError: 'Unable to open portal.',
    networkError: 'Network error',
    loading: 'Loading...',
    billingUnavailable: 'Unable to load billing information.',
    currentPlan: 'Current plan: ',
    memberSince: 'Member since: ',
    upgradeToPro: 'Upgrade to Pro',
    loadingPortal: 'Loading...',
    manageSubscription: 'Manage Subscription',
    billingHistory: 'Billing History',
    paymentComplete: 'Payment Complete',
    backToNexyFab: 'Back to NexyFab',
    sessionExpired: 'Session expired. Please log in again.',
    loginBtn: 'Log in',
    editBtn: 'Edit',
    nameLabel: 'Name',
    languageLabel: 'Language',
    saving: 'Saving...',
    saveBtn: 'Save',
    cancelBtn: 'Cancel',
    emailLabel: 'Email',
    titleLabel: 'Title',
    langLabel: 'Language',
    availableServices: 'Available Services',
    changePassword: 'Change Password',
    currentPasswordLabel: 'Current Password',
    newPasswordLabel: 'New Password',
    confirmPasswordLabel: 'Confirm New Password',
    passwordMismatch: 'New passwords do not match.',
    passwordMinLength: 'Password must be at least 8 characters.',
    changingPassword: 'Changing...',
    changePasswordBtn: 'Change Password',
    passwordChanged: 'Password has been changed.',
    profileUpdated: 'Profile updated.',
    profileUpdateFailed: 'Failed to update profile.',
    passwordChangeFailed: 'Failed to change password.',
    subscriptionTitle: 'Subscription & Billing',
    logoutBtn: 'Log out',
  },
};

function getUserLang(): AccountLang {
  if (typeof window === 'undefined') return 'ko';
  try {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      const u = JSON.parse(stored);
      if (u.language && u.language in ACCOUNT_I18N) return u.language as AccountLang;
    }
  } catch {}
  return 'ko';
}

function SubscriptionSection() {
  const t = ACCOUNT_I18N[getUserLang()];
  const [billing, setBilling] = useState<{
    currentPlan: string; memberSince: number;
    recentInvoices: { id: string; total_amount_krw: number; status: string; created_at: number; description: string }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/billing/portal', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) setBilling({
          currentPlan: d.plan,
          memberSince: d.user?.memberSince ?? 0,
          recentInvoices: d.invoices ?? [],
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: '#9ca3af', fontSize: '14px' }}>{t.loading}</p>;
  if (!billing) return <p style={{ color: '#9ca3af', fontSize: '14px' }}>{t.billingUnavailable}</p>;

  const plan = PLAN_LABELS[billing.currentPlan] || PLAN_LABELS.free;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Current plan */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <span style={{ fontSize: '14px', color: '#6b7280' }}>{t.currentPlan}</span>
          <span style={{
            display: 'inline-block', padding: '3px 12px', borderRadius: '8px',
            background: plan.color + '18', color: plan.color, fontSize: '13px', fontWeight: 800,
          }}>
            {plan.label}
          </span>
        </div>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          {t.memberSince}{new Date(billing.memberSince).toLocaleDateString()}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {billing.currentPlan === 'free' ? (
          <Link href={`/${getUserLang()}/pricing`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', borderRadius: '10px',
            background: '#0b5cff', color: '#fff', fontWeight: 700, fontSize: '13px',
            textDecoration: 'none',
          }}>
            {t.upgradeToPro}
          </Link>
        ) : (
          <Link href={`/${getUserLang()}/nexyfab/settings/billing`} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', borderRadius: '10px',
            border: '1px solid #e5e7eb',
            background: '#fff', color: '#374151', fontWeight: 700, fontSize: '13px',
            textDecoration: 'none',
          }}>
            {t.manageSubscription}
          </Link>
        )}
      </div>

      {/* Billing history */}
      {billing.recentInvoices.length > 0 && (
        <div>
          <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 8px', color: '#374151' }}>{t.billingHistory}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {billing.recentInvoices.slice(0, 10).map((inv, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', background: '#f9fafb', borderRadius: '8px', fontSize: '13px',
              }}>
                <span style={{ color: '#374151' }}>
                  {inv.description || t.paymentComplete}
                  <span style={{
                    marginLeft: '8px', fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                    background: inv.status === 'paid' ? '#dcfce7' : '#fef9c3',
                    color: inv.status === 'paid' ? '#16a34a' : '#92400e',
                  }}>{inv.status === 'paid' ? '결제완료' : inv.status}</span>
                </span>
                <span style={{ color: '#9ca3af' }}>
                  ₩{inv.total_amount_krw.toLocaleString('ko-KR')} · {new Date(inv.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Toggle Switch ────────────────────────────────────────────────────────────
function ToggleSwitch({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
      <span style={{ fontSize: '14px', color: '#374151' }}>{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? 'bg-blue-600' : 'bg-gray-200'}`}
        style={{
          position: 'relative',
          display: 'inline-flex',
          height: '24px',
          width: '44px',
          alignItems: 'center',
          borderRadius: '9999px',
          border: 'none',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          backgroundColor: value ? '#2563eb' : '#e5e7eb',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            height: '16px',
            width: '16px',
            borderRadius: '9999px',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            transition: 'transform 0.2s',
            transform: value ? 'translateX(24px)' : 'translateX(4px)',
          }}
        />
      </button>
    </div>
  );
}

interface NotificationSettings {
  emailRfqUpdate: boolean;
  emailQuoteExpiry: boolean;
  emailOrderStatus: boolean;
  emailMarketing: boolean;
  browserNotifications: boolean;
}

interface NexysysUser {
  sub: string;
  email: string;
  name: string;
  role: string;
  services: string[];
  avatar: string;
  language: string;
  title: string;
}

const SERVICE_URLS: Record<string, { url: string; label: string; color: string }> = {
  nexyflow: { url: process.env.NEXT_PUBLIC_NEXYFLOW_URL || 'https://nexyflow.com', label: 'NexyFlow', color: '#3b82f6' },
  nexyfab: { url: process.env.NEXT_PUBLIC_NEXYFAB_URL || 'https://nexyfab.com', label: 'NexyFab', color: '#8b5cf6' },
  nexywise: { url: process.env.NEXT_PUBLIC_NEXYWISE_URL || 'https://nexywise.com', label: 'NexyWise', color: '#22c55e' },
};

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [user, setUser] = useState<NexysysUser | null>(null);
  const lang: AccountLang = (user?.language as AccountLang) || getUserLang();
  const t = ACCOUNT_I18N[lang] || ACCOUNT_I18N.ko;
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Profile edit
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editLanguage, setEditLanguage] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Email change
  const [newEmail, setNewEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailChangeLoading, setEmailChangeLoading] = useState(false);

  // Notification settings
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({
    emailRfqUpdate: true,
    emailQuoteExpiry: true,
    emailOrderStatus: true,
    emailMarketing: false,
    browserNotifications: false,
  });
  const [notifLoading, setNotifLoading] = useState(false);

  // Account deletion modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('currentUser');
    if (stored) {
      try { setUser(JSON.parse(stored)); } catch { router.push('/login'); }
    } else {
      router.push('/login');
    }
  }, [router]);

  useEffect(() => {
    if (searchParams.get('emailChanged') === '1') {
      toast('success', '이메일이 성공적으로 변경되었습니다.');
      router.replace('/account');
    }
    const emailChangeError = searchParams.get('emailChangeError');
    if (emailChangeError) {
      toast('error', emailChangeError);
      router.replace('/account');
    }
  }, [searchParams, toast, router]);

  // Load notification settings on mount
  const loadNotifSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/notification-settings', { credentials: 'same-origin' });
      if (res.ok) {
        const data = await res.json() as { settings: NotificationSettings };
        if (data.settings) setNotifSettings(data.settings);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadNotifSettings();
  }, [loadNotifSettings]);

  const getAuthHeaders = () => ({
    'Content-Type': 'application/json',
  });

  const handleLogout = async () => {
    await fetch(`${AUTH_BASE}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    localStorage.removeItem('currentUser');
    window.dispatchEvent(new Event('storage'));
    router.push('/login');
  };

  const startEditing = () => {
    if (!user) return;
    setEditName(user.name);
    setEditLanguage(user.language || 'ko');
    setEditing(true);
    setProfileMessage(null);
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileMessage(null);
    setProfileLoading(true);

    try {
      const body: Record<string, string> = {};
      if (editName !== user.name) body.name = editName;
      if (editLanguage !== user.language) body.language = editLanguage;

      const res = await fetch(`${AUTH_BASE}/api/auth/me/profile`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string; message?: string };
        if (res.status === 401) { setSessionExpired(true); return; }
        throw new Error(data.error || data.message || t.profileUpdateFailed);
      }

      const data = await res.json() as { user: NexysysUser };
      setUser(data.user);
      localStorage.setItem('currentUser', JSON.stringify(data.user));
      window.dispatchEvent(new Event('storage'));
      setEditing(false);
      setProfileMessage({ type: 'success', text: t.profileUpdated });
    } catch (err: unknown) {
      setProfileMessage({ type: 'error', text: err instanceof Error ? err.message : t.profileUpdateFailed });
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: t.passwordMismatch });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: t.passwordMinLength });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${AUTH_BASE}/api/auth/me/password`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string; message?: string };
        if (res.status === 401) { setSessionExpired(true); return; }
        throw new Error(data.error || data.message || t.passwordChangeFailed);
      }

      setMessage({ type: 'success', text: t.passwordChanged });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : t.passwordChangeFailed });
    } finally {
      setLoading(false);
    }
  };

  // ─── Email Change Handler ─────────────────────────────────────────────────
  const handleEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      toast('error', '올바른 이메일 형식이 아닙니다.');
      return;
    }
    if (newEmail !== confirmEmail) {
      toast('error', '이메일 주소가 일치하지 않습니다.');
      return;
    }
    if (!emailPassword) {
      toast('error', '현재 비밀번호를 입력해주세요.');
      return;
    }

    setEmailChangeLoading(true);
    try {
      const res = await fetch('/api/auth/change-email', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ newEmail, confirmEmail, password: emailPassword }),
      });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error || '이메일 변경 요청에 실패했습니다.');
      toast('success', data.message || '인증 이메일을 발송했습니다.');
      setNewEmail('');
      setConfirmEmail('');
      setEmailPassword('');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '이메일 변경 요청에 실패했습니다.');
    } finally {
      setEmailChangeLoading(false);
    }
  };

  // ─── Notification Settings Handler ───────────────────────────────────────
  const handleNotifSave = async () => {
    setNotifLoading(true);
    try {
      const res = await fetch('/api/auth/notification-settings', {
        method: 'PATCH',
        headers: getAuthHeaders(),
        credentials: 'same-origin',
        body: JSON.stringify({ settings: notifSettings }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || '설정 저장에 실패했습니다.');
      toast('success', '알림 설정이 저장되었습니다.');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '설정 저장에 실패했습니다.');
    } finally {
      setNotifLoading(false);
    }
  };

  // ─── Account Delete Handler ───────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleteLoading(true);
    try {
      const res = await fetch('/api/auth/delete-account', {
        method: 'DELETE',
        headers: getAuthHeaders(),
        credentials: 'same-origin',
      });
      const data = await res.json() as { deleted?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error || '계정 삭제에 실패했습니다.');
      localStorage.removeItem('currentUser');
      window.dispatchEvent(new Event('storage'));
      router.push('/');
    } catch (err: unknown) {
      toast('error', err instanceof Error ? err.message : '계정 삭제에 실패했습니다.');
      setDeleteLoading(false);
      setShowDeleteModal(false);
    }
  };

  if (!user) return null;

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb',
    borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };

  const cardStyle: React.CSSProperties = {
    background: '#fff', borderRadius: '20px', padding: '32px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #f3f4f6',
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', padding: '48px 16px', fontFamily: 'Pretendard, sans-serif' }}>
      <div style={{ maxWidth: '560px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Back nav */}
        <Link href="/ko" style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#0b5cff', fontSize: '13px', textDecoration: 'none', fontWeight: 600 }}>
          &larr; {t.backToNexyFab}
        </Link>

        {/* Session Expired */}
        {sessionExpired && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '14px', fontSize: '14px', color: '#b45309', fontWeight: 600 }}>
            <span>{t.sessionExpired}</span>
            <button onClick={handleLogout} style={{ background: '#fde68a', border: 'none', borderRadius: '8px', padding: '6px 14px', color: '#b45309', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
              {t.loginBtn}
            </button>
          </div>
        )}

        {/* Profile */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <Image
              src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`}
              alt={`${user.name} avatar`}
              width={64}
              height={64}
              style={{ borderRadius: '50%', border: '2px solid #0b5cff' }}
            />
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#111827', margin: '0 0 4px' }}>{user.name}</h2>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: '6px',
                fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
                background: user.role === 'superadmin' ? '#fef2f2' : '#eff6ff',
                color: user.role === 'superadmin' ? '#dc2626' : '#2563eb',
              }}>{user.role}</span>
            </div>
            {!editing && (
              <button onClick={startEditing} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '8px 14px', color: '#6b7280', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                {t.editBtn}
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleProfileUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{t.nameLabel}</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} required style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{t.languageLabel}</label>
                <select value={editLanguage} onChange={e => setEditLanguage(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="en">English</option>
                  <option value="ko">한국어</option>
                  <option value="zh">中文</option>
                  <option value="ja">日本語</option>
                  <option value="es">Español</option>
                  <option value="ar">العربية</option>
                </select>
              </div>
              {profileMessage && (
                <div style={{ padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', background: profileMessage.type === 'success' ? '#f0fdf4' : '#fef2f2', color: profileMessage.type === 'success' ? '#15803d' : '#dc2626', border: `1px solid ${profileMessage.type === 'success' ? '#bbf7d0' : '#fecaca'}` }}>
                  {profileMessage.text}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" disabled={profileLoading} style={{ flex: 1, background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '12px', borderRadius: '10px', border: 'none', cursor: profileLoading ? 'not-allowed' : 'pointer', opacity: profileLoading ? 0.6 : 1, fontSize: '14px' }}>
                  {profileLoading ? t.saving : t.saveBtn}
                </button>
                <button type="button" onClick={() => setEditing(false)} style={{ padding: '12px 20px', background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '10px', color: '#6b7280', cursor: 'pointer', fontSize: '14px', fontWeight: 600 }}>
                  {t.cancelBtn}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px', color: '#374151' }}>
                <div><strong style={{ color: '#9ca3af', fontSize: '12px', textTransform: 'uppercase' }}>{t.emailLabel}</strong><br />{user.email}</div>
                {user.title && <div><strong style={{ color: '#9ca3af', fontSize: '12px', textTransform: 'uppercase' }}>{t.titleLabel}</strong><br />{user.title}</div>}
                <div><strong style={{ color: '#9ca3af', fontSize: '12px', textTransform: 'uppercase' }}>{t.langLabel}</strong><br />{user.language?.toUpperCase() || 'KO'}</div>
              </div>

              {profileMessage && (
                <div style={{ marginTop: '14px', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '600', background: profileMessage.type === 'success' ? '#f0fdf4' : '#fef2f2', color: profileMessage.type === 'success' ? '#15803d' : '#dc2626', border: `1px solid ${profileMessage.type === 'success' ? '#bbf7d0' : '#fecaca'}` }}>
                  {profileMessage.text}
                </div>
              )}

              {/* Clickable Services */}
              {user.services && user.services.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <strong style={{ color: '#9ca3af', fontSize: '12px', textTransform: 'uppercase' }}>{t.availableServices}</strong>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {user.services.map(svc => {
                      const info = SERVICE_URLS[svc];
                      return info ? (
                        <a key={svc} href={info.url} target="_blank" rel="noopener noreferrer" style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
                          background: `${info.color}15`, color: info.color,
                          border: `1px solid ${info.color}30`, textDecoration: 'none',
                        }}>
                          {info.label} ↗
                        </a>
                      ) : (
                        <span key={svc} style={{ padding: '4px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', background: '#6b728015', color: '#6b7280', border: '1px solid #6b728030' }}>{svc}</span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Cross-Service Navigation */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '15px', fontWeight: '800', color: '#111827', margin: '0 0 16px' }}>Nexysys Ecosystem</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
            <a href={NEXYSYS_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: '12px', background: '#f0f9ff', border: '1px solid #e0f2fe', textDecoration: 'none', color: '#0284c7', fontSize: '13px', fontWeight: 600 }}>
              Nexysys ↗
            </a>
            {Object.entries(SERVICE_URLS).filter(([k]) => k !== 'nexyfab').map(([key, svc]) => (
              <a key={key} href={svc.url} target="_blank" rel="noopener noreferrer" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: '12px',
                background: `${svc.color}08`, border: `1px solid ${svc.color}20`,
                textDecoration: 'none', color: svc.color, fontSize: '13px', fontWeight: 600,
              }}>
                {svc.label} ↗
              </a>
            ))}
          </div>
        </div>

        {/* Change Password */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#111827', margin: '0 0 20px' }}>{t.changePassword}</h3>
          <form onSubmit={handlePasswordChange} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{t.currentPasswordLabel}</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{t.newPasswordLabel}</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>{t.confirmPasswordLabel}</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required style={inputStyle} />
            </div>

            {message && (
              <div style={{
                padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: '600',
                background: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
                color: message.type === 'success' ? '#15803d' : '#dc2626',
                border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              }}>{message.text}</div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '12px', borderRadius: '10px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontSize: '14px' }}
            >
              {loading ? t.changingPassword : t.changePasswordBtn}
            </button>
          </form>
        </div>

        {/* ─── 이메일 변경 ──────────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#111827', margin: '0 0 20px' }}>이메일 변경</h3>
          <form onSubmit={handleEmailChange} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>새 이메일 주소</label>
              <input
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                required
                placeholder="new@example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>새 이메일 확인</label>
              <input
                type="email"
                value={confirmEmail}
                onChange={e => setConfirmEmail(e.target.value)}
                required
                placeholder="new@example.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#6b7280', marginBottom: '4px', textTransform: 'uppercase' }}>현재 비밀번호</label>
              <input
                type="password"
                value={emailPassword}
                onChange={e => setEmailPassword(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={emailChangeLoading}
              style={{
                background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '12px',
                borderRadius: '10px', border: 'none',
                cursor: emailChangeLoading ? 'not-allowed' : 'pointer',
                opacity: emailChangeLoading ? 0.6 : 1, fontSize: '14px',
              }}
            >
              {emailChangeLoading ? '요청 중...' : '이메일 변경 요청'}
            </button>
          </form>
        </div>

        {/* ─── 알림 설정 ───────────────────────────────────────────────────── */}
        <div style={cardStyle}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#111827', margin: '0 0 4px' }}>알림 설정</h3>
          <div style={{ borderTop: '1px solid #f3f4f6', marginTop: '16px' }}>
            <ToggleSwitch
              label="이메일 알림: RFQ 업데이트"
              value={notifSettings.emailRfqUpdate}
              onChange={v => setNotifSettings(s => ({ ...s, emailRfqUpdate: v }))}
            />
            <div style={{ borderTop: '1px solid #f9fafb' }} />
            <ToggleSwitch
              label="이메일 알림: 견적 만료"
              value={notifSettings.emailQuoteExpiry}
              onChange={v => setNotifSettings(s => ({ ...s, emailQuoteExpiry: v }))}
            />
            <div style={{ borderTop: '1px solid #f9fafb' }} />
            <ToggleSwitch
              label="이메일 알림: 주문 상태 변경"
              value={notifSettings.emailOrderStatus}
              onChange={v => setNotifSettings(s => ({ ...s, emailOrderStatus: v }))}
            />
            <div style={{ borderTop: '1px solid #f9fafb' }} />
            <ToggleSwitch
              label="이메일 알림: 마케팅 및 뉴스레터"
              value={notifSettings.emailMarketing}
              onChange={v => setNotifSettings(s => ({ ...s, emailMarketing: v }))}
            />
            <div style={{ borderTop: '1px solid #f9fafb' }} />
            <ToggleSwitch
              label="브라우저 알림"
              value={notifSettings.browserNotifications}
              onChange={v => setNotifSettings(s => ({ ...s, browserNotifications: v }))}
            />
          </div>
          <button
            type="button"
            onClick={handleNotifSave}
            disabled={notifLoading}
            style={{
              marginTop: '20px', width: '100%', background: '#0b5cff', color: '#fff',
              fontWeight: '700', padding: '12px', borderRadius: '10px', border: 'none',
              cursor: notifLoading ? 'not-allowed' : 'pointer',
              opacity: notifLoading ? 0.6 : 1, fontSize: '14px',
            }}
          >
            {notifLoading ? '저장 중...' : '설정 저장'}
          </button>
        </div>

        {/* Subscription Management */}
        <div style={{ background: '#fff', borderRadius: '16px', border: '1px solid #f0f0f0', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 900, margin: '0 0 16px' }}>{t.subscriptionTitle}</h2>
          <SubscriptionSection />
        </div>

        {/* ─── 위험 구역 (계정 탈퇴) ───────────────────────────────────────── */}
        <div style={{
          background: '#fff', borderRadius: '20px', padding: '32px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.04)',
          border: '1px solid #fecaca',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#dc2626', margin: '0 0 8px' }}>위험 구역</h3>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px', lineHeight: 1.5 }}>
            계정을 삭제하면 모든 데이터가 영구적으로 제거됩니다.
          </p>
          <button
            type="button"
            onClick={() => { setShowDeleteModal(true); setDeleteConfirmText(''); }}
            style={{
              padding: '10px 24px', borderRadius: '10px',
              border: '1px solid #dc2626', background: '#fff',
              color: '#dc2626', fontWeight: '700', fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            계정 탈퇴
          </button>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          style={{
            width: '100%', padding: '14px', background: '#fef2f2', border: '1px solid #fecaca',
            borderRadius: '14px', color: '#dc2626', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
          }}
        >
          {t.logoutBtn}
        </button>
      </div>

      {/* ─── 계정 탈퇴 확인 모달 ─────────────────────────────────────────── */}
      {showDeleteModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
          style={{
            position: 'fixed', inset: 0, zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', padding: '16px',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteModal(false); }}
        >
          <div style={{
            background: '#fff', borderRadius: '20px', padding: '32px',
            width: '100%', maxWidth: '440px',
            boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <h3 id="delete-modal-title" style={{ fontSize: '18px', fontWeight: '800', color: '#dc2626', margin: '0 0 12px' }}>
              계정 탈퇴 확인
            </h3>
            <p style={{ fontSize: '14px', color: '#374151', margin: '0 0 8px', lineHeight: 1.6 }}>
              이 작업은 <strong>되돌릴 수 없습니다.</strong> 모든 프로젝트, RFQ, 주문 데이터가 영구적으로 삭제됩니다.
            </p>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px' }}>
              계속하려면 아래 입력란에 <strong style={{ color: '#374151' }}>DELETE</strong> 를 입력하세요.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              style={{
                ...inputStyle,
                marginBottom: '16px',
                border: '1px solid #fecaca',
              }}
            />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  background: '#f3f4f6', border: '1px solid #e5e7eb',
                  color: '#6b7280', fontWeight: '700', fontSize: '14px', cursor: 'pointer',
                }}
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deleteConfirmText !== 'DELETE' || deleteLoading}
                style={{
                  flex: 1, padding: '12px', borderRadius: '10px',
                  background: deleteConfirmText === 'DELETE' ? '#dc2626' : '#fecaca',
                  border: 'none',
                  color: '#fff', fontWeight: '700', fontSize: '14px',
                  cursor: deleteConfirmText !== 'DELETE' || deleteLoading ? 'not-allowed' : 'pointer',
                  opacity: deleteLoading ? 0.7 : 1,
                }}
              >
                {deleteLoading ? '삭제 중...' : '계정 영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
