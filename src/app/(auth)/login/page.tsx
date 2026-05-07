'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const AUTH_BASE = process.env.NEXT_PUBLIC_AUTH_URL || 'http://localhost:4000';

type Lang = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar';

const loginDict: Record<Lang, Record<string, string>> = {
    en: {
        title: 'Nexysys Unified Sign In',
        subtitle: 'One account for all Nexysys services',
        email: 'Email',
        password: 'Password',
        signIn: 'Sign In',
        signingIn: 'Signing in...',
        forgot: 'Forgot your password?',
        noAccount: "Don't have an account?",
        register: 'Nexysys Unified Registration',
        failed: 'Login failed',
    },
    ko: {
        title: 'Nexysys 통합 로그인',
        subtitle: '하나의 계정으로 모든 Nexysys 서비스를 이용하세요',
        email: '이메일',
        password: '비밀번호',
        signIn: '로그인',
        signingIn: '로그인 중...',
        forgot: '비밀번호를 잊으셨나요?',
        noAccount: '계정이 없으신가요?',
        register: 'Nexysys 통합 회원가입',
        failed: '로그인에 실패했습니다.',
    },
    ja: {
        title: 'Nexysys 統合ログイン',
        subtitle: '1つのアカウントですべてのNexysysサービスをご利用いただけます',
        email: 'メールアドレス',
        password: 'パスワード',
        signIn: 'ログイン',
        signingIn: 'ログイン中...',
        forgot: 'パスワードをお忘れですか？',
        noAccount: 'アカウントをお持ちでないですか？',
        register: 'Nexysys 統合会員登録',
        failed: 'ログインに失敗しました',
    },
    zh: {
        title: 'Nexysys 统一登录',
        subtitle: '一个账户畅享所有Nexysys服务',
        email: '电子邮箱',
        password: '密码',
        signIn: '登录',
        signingIn: '登录中...',
        forgot: '忘记密码？',
        noAccount: '还没有账户？',
        register: 'Nexysys 统一注册',
        failed: '登录失败',
    },
    es: {
        title: 'Inicio de sesión unificado de Nexysys',
        subtitle: 'Una cuenta para todos los servicios de Nexysys',
        email: 'Correo electrónico',
        password: 'Contraseña',
        signIn: 'Iniciar Sesión',
        signingIn: 'Iniciando sesión...',
        forgot: '¿Olvidaste tu contraseña?',
        noAccount: '¿No tienes una cuenta?',
        register: 'Registro unificado de Nexysys',
        failed: 'Error de inicio de sesión',
    },
    ar: {
        title: 'تسجيل الدخول الموحد لـ Nexysys',
        subtitle: 'حساب واحد لجميع خدمات Nexysys',
        email: 'البريد الإلكتروني',
        password: 'كلمة المرور',
        signIn: 'تسجيل الدخول',
        signingIn: '...جارٍ تسجيل الدخول',
        forgot: 'هل نسيت كلمة المرور؟',
        noAccount: 'ليس لديك حساب؟',
        register: 'التسجيل الموحد في Nexysys',
        failed: 'فشل تسجيل الدخول',
    },
};

// Client-side fallback for test accounts (development only)
const TEST_ACCOUNTS: Record<string, { password: string; user: Record<string, unknown> }> = process.env.NODE_ENV === 'production' ? {} : {
    'test@nexysys.com': {
        password: 'Test1234!',
        user: {
            sub: 'test-user-001',
            name: '테스트 사용자',
            email: 'test@nexysys.com',
            role: 'employee',
            is_test: true,
            services: ['nexyflow', 'nexyfab'],
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=%ED%85%8C%EC%8A%A4%ED%8A%B8%20%EC%82%AC%EC%9A%A9%EC%9E%90',
            language: 'ko',
            title: '테스트 계정',
            plan: 'pro',
        },
    },
    'orgadmin@nexysys.com': {
        password: 'OrgAdmin1!',
        user: {
            sub: 'test-user-003',
            name: '고객사관리자',
            email: 'orgadmin@nexysys.com',
            role: 'employee',
            is_test: true,
            services: ['nexyflow'],
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=%EA%B3%A0%EA%B0%9D%EC%82%AC%EA%B4%80%EB%A6%AC%EC%9E%90',
            language: 'ko',
            title: '부서장',
            organization_id: 'test-company',
            org_role: 'admin',
            department: '경영지원팀',
            position: '팀장',
            plan: 'pro',
        },
    },
    'customer@nexyfab.com': {
        password: 'Customer1!',
        user: {
            sub: 'test-user-fab-customer',
            name: 'NexyFab 고객사',
            email: 'customer@nexyfab.com',
            role: 'customer',
            is_test: true,
            services: ['nexyfab'],
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=fab-customer',
            language: 'ko',
            title: '고객사 테스트',
            plan: 'pro',
        },
    },
    'partner@nexyfab.com': {
        password: 'Partner1!',
        user: {
            sub: 'test-user-fab-partner',
            name: 'NexyFab 파트너사',
            email: 'partner@nexyfab.com',
            role: 'partner',
            is_test: true,
            services: ['nexyfab'],
            avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=fab-partner',
            language: 'ko',
            title: '파트너사 테스트',
            plan: 'pro',
        },
    },
};

function detectLang(): Lang {
    try {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            const u = JSON.parse(stored);
            if (u.language && loginDict[u.language as Lang]) return u.language as Lang;
        }
    } catch {}
    const saved = localStorage.getItem('app_language');
    if (saved && loginDict[saved as Lang]) return saved as Lang;
    const fabLang = localStorage.getItem('nexyfab_language');
    if (fabLang === 'kr' || fabLang === 'ko') return 'ko';
    if (fabLang && loginDict[fabLang as Lang]) return fabLang as Lang;
    return 'ko';
}

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [lang, setLang] = useState<Lang>('ko');

    useEffect(() => {
        setLang(detectLang());
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            router.push('/account');
        }
    }, [router]);

    const t = loginDict[lang];

    const DEMO_USERS = {
        customer: {
            sub: 'demo-customer-001', name: 'Demo 고객사',
            email: 'demo-customer@nexyfab.com', role: 'customer',
            is_demo: true, services: ['nexyfab'], language: 'ko',
            title: '데모 고객 계정', plan: 'pro', company: 'Demo Corp',
        },
        partner: {
            sub: 'demo-partner-001', name: 'Demo 파트너사',
            email: 'demo-partner@nexyfab.com', role: 'partner',
            is_demo: true, services: ['nexyfab'], language: 'ko',
            title: '데모 파트너 계정', plan: 'pro', company: 'Demo Manufacturer',
        },
    };

    const handleDemoLogin = (role: 'customer' | 'partner') => {
        setError('');
        const user = DEMO_USERS[role];
        localStorage.setItem('currentUser', JSON.stringify(user));
        window.dispatchEvent(new Event('storage'));
        if (role === 'partner') {
            localStorage.setItem('partnerSession', 'demo');
            localStorage.setItem('partnerInfo', JSON.stringify({
                email: user.email, company: user.company,
                factoryId: 'demo-factory-001', factoryName: 'Demo 제조사',
            }));
            router.push('/partner/dashboard');
        } else {
            router.push('/dashboard');
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch(`${AUTH_BASE}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email, password }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || t.failed);

            localStorage.setItem('currentUser', JSON.stringify(data.user));

            window.dispatchEvent(new Event('storage'));
            router.push('/account');
        } catch (err: any) {
            // If network error (server not running), try client-side test account fallback
            if (err instanceof TypeError && err.message.includes('fetch')) {
                const testAccount = TEST_ACCOUNTS[email.toLowerCase()];
                if (testAccount && testAccount.password === password) {
                    localStorage.setItem('currentUser', JSON.stringify(testAccount.user));
                    window.dispatchEvent(new Event('storage'));
                    router.push('/account');
                    return;
                }
            }
            setError(err.message || t.failed);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ minHeight: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '40px 16px', fontFamily: 'Pretendard, sans-serif', direction: lang === 'ar' ? 'rtl' : 'ltr' }}>

            <div style={{ maxWidth: '420px', width: '100%', background: '#fff', padding: '40px 32px', borderRadius: '20px', boxShadow: '0 10px 40px rgba(0,0,0,0.06)', border: '1px solid #f3f4f6' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    {/* Text logo — same style as Header */}
                    <div style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '16px' }}>
                        <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
                    </div>
                    <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#111827', margin: '0 0 8px' }}>{t.title}</h1>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>{t.subtitle}</p>
                </div>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <input
                        type="email"
                        placeholder={t.email}
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        autoFocus
                        style={{ width: '100%', padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                    />
                    <input
                        type="password"
                        placeholder={t.password}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        style={{ width: '100%', padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                    />

                    {error && (
                        <p style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600', margin: 0 }}>{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        style={{ width: '100%', background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '14px', borderRadius: '12px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontSize: '15px', transition: '0.2s' }}
                    >
                        {loading ? t.signingIn : t.signIn}
                    </button>
                </form>

                {/* 소셜 로그인 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0 16px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                    <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {lang === 'ko' ? '또는' : lang === 'ja' ? 'または' : lang === 'zh' ? '或者' : lang === 'es' ? 'o' : lang === 'ar' ? 'أو' : 'or'}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Link
                        href="/api/auth/nexysys/start"
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#0b5cff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, color: '#fff', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        {lang === 'ko' ? 'Nexysys SSO로 로그인' : lang === 'ja' ? 'Nexysys SSOでログイン' : lang === 'zh' ? '使用 Nexysys SSO 登录' : lang === 'es' ? 'Entrar con Nexysys SSO' : lang === 'ar' ? 'الدخول بـ Nexysys SSO' : 'Sign in with Nexysys SSO'}
                    </Link>
                    <Link
                        href="/api/auth/oauth/google"
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#374151', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        Google
                    </Link>
                    {process.env.NEXT_PUBLIC_KAKAO_CLIENT_ID && (
                    <Link
                        href="/api/auth/oauth/kakao"
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#FEE500', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#191919', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.36 2 10.5c0 2.63 1.74 4.95 4.38 6.3l-1.12 4.1c-.1.35.31.63.6.42l4.82-3.2c.43.04.87.06 1.32.06 5.52 0 10-3.36 10-7.5S17.52 3 12 3z" fill="#191919"/></svg>
                        {lang === 'ko' ? '카카오 로그인' : 'Kakao'}
                    </Link>
                    )}
                    {process.env.NEXT_PUBLIC_NAVER_CLIENT_ID && (
                    <Link
                        href="/api/auth/oauth/naver"
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#03C75A', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#fff', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M16.27 3v8.46L7.73 3H3v18h4.73v-8.46L16.27 21H21V3h-4.73z" fill="#fff"/></svg>
                        {lang === 'ko' ? '네이버 로그인' : 'Naver'}
                    </Link>
                    )}
                </div>

                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <a
                        href={`${process.env.NEXT_PUBLIC_NEXYSYS_URL || 'http://localhost:5173'}/forgot-password`}
                        style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none', fontWeight: '500' }}
                    >
                        {t.forgot}
                    </a>
                </div>

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <Link
                        href="/register"
                        prefetch={false}
                        style={{ fontSize: '13px', color: '#0b5cff', textDecoration: 'none', fontWeight: '600' }}
                    >
                        {t.noAccount} {t.register}
                    </Link>
                </div>

                {/* Demo 버튼 */}
                <div style={{ marginTop: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                        <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {lang === 'ko' ? '데모 체험' : 'Try Demo'}
                        </span>
                        <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button
                            onClick={() => handleDemoLogin('customer')}
                            disabled={loading}
                            style={{ padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', fontSize: '12px', fontWeight: 700, color: '#15803d', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: '0.15s' }}
                        >
                            <span style={{ fontSize: '18px' }}>🏭</span>
                            <span>{lang === 'ko' ? '고객사 체험' : 'Customer Demo'}</span>
                        </button>
                        <button
                            onClick={() => handleDemoLogin('partner')}
                            disabled={loading}
                            style={{ padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '12px', fontWeight: 700, color: '#1d4ed8', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: '0.15s' }}
                        >
                            <span style={{ fontSize: '18px' }}>🔧</span>
                            <span>{lang === 'ko' ? '파트너사 체험' : 'Partner Demo'}</span>
                        </button>
                    </div>
                    <p style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', margin: '8px 0 0', lineHeight: 1.5 }}>
                        {lang === 'ko' ? '데모 계정은 읽기 전용이며 실제 데이터에 영향을 주지 않습니다.' : 'Demo accounts are read-only and do not affect real data.'}
                    </p>
                </div>

                {process.env.NODE_ENV !== 'production' && (
                    <div style={{ marginTop: '20px', padding: '12px 16px', background: '#f8faff', border: '1px solid #dbeafe', borderRadius: '10px', fontSize: '11px', color: '#6b7280', textAlign: 'center', lineHeight: 1.8 }}>
                        <div style={{ fontWeight: 700, color: '#374151', marginBottom: '4px' }}>테스트 계정</div>
                        <div>test@nexysys.com / Test1234!</div>
                        <div>orgadmin@nexysys.com / OrgAdmin1!</div>
                        <div>customer@nexyfab.com / Customer1!</div>
                        <div>partner@nexyfab.com / Partner1!</div>
                    </div>
                )}
            </div>
        </div>
    );
}
