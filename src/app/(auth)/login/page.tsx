'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authBaseUrl, nexysysBaseUrl } from '@/lib/auth-base-url';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';
import { safeReturnPath } from '@/lib/safeReturnPath';

const AUTH_BASE = authBaseUrl();

type Lang = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar';

const SESSION_NOTICE: Record<Lang, string> = {
    ko: '보안을 위해 브라우저를 완전히 닫으면 로그아웃되며, 다음 방문 때 다시 로그인해야 합니다.',
    en: 'For security, closing the browser signs you out. Sign in again on your next visit.',
    ja: 'セキュリティのため、ブラウザを完全に閉じるとログアウトし、次回は再ログインが必要です。',
    zh: '为确保安全，完全关闭浏览器后将退出登录，下次访问时需要重新登录。',
    es: 'Por seguridad, al cerrar el navegador se cerrará la sesión. Deberás iniciar sesión de nuevo en la próxima visita.',
    ar: 'لأمانك، يؤدي إغلاق المتصفح بالكامل إلى تسجيل الخروج، وستحتاج إلى تسجيل الدخول في الزيارة التالية.',
};

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
        const query = new URLSearchParams(window.location.search).get('lang');
        if (query) return toIsoLang(query);
        const stored = sessionStorage.getItem('currentUser');
        if (stored) {
            const u = JSON.parse(stored);
            if (u.language) return toIsoLang(u.language);
        }
    } catch (err) { console.error('[page] caught', err); }
    const saved = localStorage.getItem('app_language')
        || localStorage.getItem('nf_lang')
        || localStorage.getItem('nexyfab_language');
    if (saved) return toIsoLang(saved);
    return 'en';
}

function loginReturnPath(): string {
    if (typeof window === 'undefined') return '/account';
    return safeReturnPath(new URLSearchParams(window.location.search).get('next'));
}

const LOGIN_EXTRA: Record<Lang, {
    passkeyUnsupported: string; emailRequired: string; passkeyOptionsFailed: string;
    passkeyVerifyFailed: string; passkeyLoginFailed: string; codeRequired: string;
    twoFactorTitle: string; twoFactorPrompt: string; verifying: string; verify: string;
    backToSignIn: string; continueWith: (name: string) => string; passkey: string;
    or: string; sso: string; kakao: string; naver: string; demo: string;
    customerDemo: string; partnerDemo: string; demoNote: string; testAccounts: string;
    showPassword: string; hidePassword: string;
}> = {
    en: { passkeyUnsupported: 'Passkey not supported by this browser.', emailRequired: 'Enter your email first.', passkeyOptionsFailed: 'Passkey lookup failed', passkeyVerifyFailed: 'Passkey verify failed', passkeyLoginFailed: 'Passkey login failed', codeRequired: 'Enter the 6-digit code.', twoFactorTitle: 'Two-factor authentication', twoFactorPrompt: 'Enter the 6-digit code from your authenticator app.', verifying: 'Verifying…', verify: 'Verify', backToSignIn: 'Back to sign in', continueWith: n => `Continue with ${n}`, passkey: 'Sign in with passkey', or: 'or', sso: 'Sign in with Nexysys SSO', kakao: 'Kakao', naver: 'Naver', demo: 'Try Demo', customerDemo: 'Customer Demo', partnerDemo: 'Partner Demo', demoNote: 'Demo accounts are read-only and do not affect real data.', testAccounts: 'Test accounts', showPassword: 'Show password', hidePassword: 'Hide password' },
    ko: { passkeyUnsupported: '이 브라우저는 패스키를 지원하지 않습니다.', emailRequired: '이메일을 먼저 입력해주세요.', passkeyOptionsFailed: '패스키 옵션 조회 실패', passkeyVerifyFailed: '패스키 검증 실패', passkeyLoginFailed: '패스키 로그인 실패', codeRequired: '6자리 코드를 입력해주세요.', twoFactorTitle: '2단계 인증', twoFactorPrompt: '인증 앱의 6자리 코드를 입력해 주세요.', verifying: '확인 중…', verify: '인증', backToSignIn: '로그인 화면으로', continueWith: n => `${n}으로 로그인`, passkey: '패스키로 로그인', or: '또는', sso: 'Nexysys SSO로 로그인', kakao: '카카오 로그인', naver: '네이버 로그인', demo: '데모 체험', customerDemo: '고객사 체험', partnerDemo: '파트너사 체험', demoNote: '데모 계정은 읽기 전용이며 실제 데이터에 영향을 주지 않습니다.', testAccounts: '테스트 계정', showPassword: '비밀번호 표시', hidePassword: '비밀번호 숨기기' },
    ja: { passkeyUnsupported: 'このブラウザはパスキーに対応していません。', emailRequired: '先にメールアドレスを入力してください。', passkeyOptionsFailed: 'パスキーの取得に失敗しました', passkeyVerifyFailed: 'パスキーの検証に失敗しました', passkeyLoginFailed: 'パスキーでのログインに失敗しました', codeRequired: '6桁のコードを入力してください。', twoFactorTitle: '2段階認証', twoFactorPrompt: '認証アプリの6桁のコードを入力してください。', verifying: '確認中…', verify: '確認', backToSignIn: 'ログイン画面に戻る', continueWith: n => `${n}でログイン`, passkey: 'パスキーでログイン', or: 'または', sso: 'Nexysys SSOでログイン', kakao: 'Kakaoログイン', naver: 'Naverログイン', demo: 'デモを試す', customerDemo: '顧客デモ', partnerDemo: 'パートナーデモ', demoNote: 'デモアカウントは読み取り専用で、実際のデータには影響しません。', testAccounts: 'テストアカウント', showPassword: 'パスワードを表示', hidePassword: 'パスワードを隠す' },
    zh: { passkeyUnsupported: '此浏览器不支持通行密钥。', emailRequired: '请先输入邮箱。', passkeyOptionsFailed: '获取通行密钥选项失败', passkeyVerifyFailed: '通行密钥验证失败', passkeyLoginFailed: '通行密钥登录失败', codeRequired: '请输入 6 位验证码。', twoFactorTitle: '双重身份验证', twoFactorPrompt: '请输入身份验证器应用中的 6 位验证码。', verifying: '验证中…', verify: '验证', backToSignIn: '返回登录', continueWith: n => `使用 ${n} 登录`, passkey: '使用通行密钥登录', or: '或者', sso: '使用 Nexysys SSO 登录', kakao: 'Kakao 登录', naver: 'Naver 登录', demo: '体验演示', customerDemo: '客户演示', partnerDemo: '合作伙伴演示', demoNote: '演示账户为只读，不会影响真实数据。', testAccounts: '测试账户', showPassword: '显示密码', hidePassword: '隐藏密码' },
    es: { passkeyUnsupported: 'Este navegador no admite claves de acceso.', emailRequired: 'Introduce primero tu correo electrónico.', passkeyOptionsFailed: 'No se pudieron obtener las opciones de la clave de acceso', passkeyVerifyFailed: 'No se pudo verificar la clave de acceso', passkeyLoginFailed: 'No se pudo iniciar sesión con la clave de acceso', codeRequired: 'Introduce el código de 6 dígitos.', twoFactorTitle: 'Autenticación de dos factores', twoFactorPrompt: 'Introduce el código de 6 dígitos de tu aplicación de autenticación.', verifying: 'Verificando…', verify: 'Verificar', backToSignIn: 'Volver a iniciar sesión', continueWith: n => `Continuar con ${n}`, passkey: 'Iniciar sesión con clave de acceso', or: 'o', sso: 'Iniciar sesión con Nexysys SSO', kakao: 'Kakao', naver: 'Naver', demo: 'Probar demo', customerDemo: 'Demo de cliente', partnerDemo: 'Demo de socio', demoNote: 'Las cuentas demo son de solo lectura y no afectan a los datos reales.', testAccounts: 'Cuentas de prueba', showPassword: 'Mostrar contraseña', hidePassword: 'Ocultar contraseña' },
    ar: { passkeyUnsupported: 'هذا المتصفح لا يدعم مفاتيح المرور.', emailRequired: 'أدخل بريدك الإلكتروني أولاً.', passkeyOptionsFailed: 'تعذر الحصول على خيارات مفتاح المرور', passkeyVerifyFailed: 'تعذر التحقق من مفتاح المرور', passkeyLoginFailed: 'تعذر تسجيل الدخول بمفتاح المرور', codeRequired: 'أدخل الرمز المكون من 6 أرقام.', twoFactorTitle: 'المصادقة الثنائية', twoFactorPrompt: 'أدخل الرمز المكون من 6 أرقام من تطبيق المصادقة.', verifying: 'جارٍ التحقق…', verify: 'تحقق', backToSignIn: 'العودة إلى تسجيل الدخول', continueWith: n => `المتابعة مع ${n}`, passkey: 'تسجيل الدخول بمفتاح المرور', or: 'أو', sso: 'الدخول عبر Nexysys SSO', kakao: 'تسجيل الدخول عبر Kakao', naver: 'تسجيل الدخول عبر Naver', demo: 'تجربة العرض', customerDemo: 'عرض العميل', partnerDemo: 'عرض الشريك', demoNote: 'حسابات العرض للقراءة فقط ولا تؤثر في البيانات الحقيقية.', testAccounts: 'حسابات الاختبار', showPassword: 'إظهار كلمة المرور', hidePassword: 'إخفاء كلمة المرور' },
};

type LoginStep = 'credentials' | '2fa';

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [lang, setLang] = useState<Lang>('en');
    const [discoveredSso, setDiscoveredSso] = useState<{ name: string; loginUrl: string } | null>(null);
    // Phase ⑦ Passkey + 2FA — same auth-server endpoints NexyFlow already
    // talks to. Step state moves from 'credentials' to '2fa' when the
    // server returns `requires_2fa`; tempToken carries the short-lived
    // continuation token across the step boundary.
    const [step, setStep] = useState<LoginStep>('credentials');
    const [totpCode, setTotpCode] = useState('');
    const [tempToken, setTempToken] = useState('');
    const [passkeyLoading, setPasskeyLoading] = useState(false);

    useEffect(() => {
        setLang(detectLang());
        const stored = sessionStorage.getItem('currentUser');
        if (stored) {
            router.push(loginReturnPath());
        }
    }, [router]);

    // SSO domain discovery — debounced 350ms; aborts in-flight requests
    // when the email changes so we don't race the latest reply.
    useEffect(() => {
        const e = email.trim().toLowerCase();
        if (!e.includes('@') || !e.split('@')[1]) { setDiscoveredSso(null); return; }
        const ctrl = new AbortController();
        const timer = setTimeout(async () => {
            try {
                const r = await fetch(`/api/auth/sso/discover?email=${encodeURIComponent(e)}`, { signal: ctrl.signal });
                if (!r.ok) { setDiscoveredSso(null); return; }
                const data = await r.json() as { found?: boolean; provider?: { name?: string }; login_url?: string };
                if (data?.found && data.login_url) {
                    setDiscoveredSso({ name: data.provider?.name || 'SSO', loginUrl: data.login_url });
                } else {
                    setDiscoveredSso(null);
                }
            } catch { /* aborted or offline */ }
        }, 350);
        return () => { clearTimeout(timer); ctrl.abort(); };
    }, [email]);

    const t = loginDict[lang];
    const x = LOGIN_EXTRA[lang];
    const routeLang = toRouteLang(lang);

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
        sessionStorage.setItem('currentUser', JSON.stringify(user));
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

    /** Phase ⑦ — WebAuthn passkey login. Mirrors NexyFlow's implementation
     *  exactly so the same auth-server endpoints serve both products. */
    const handlePasskeyLogin = async () => {
        if (typeof navigator === 'undefined' || !navigator.credentials) {
            setError(x.passkeyUnsupported);
            return;
        }
        if (!email.trim()) {
            setError(x.emailRequired);
            return;
        }
        setPasskeyLoading(true); setError('');
        try {
            const b64urlToBuffer = (s: string) => {
                const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
                const bin = atob(b64);
                return Uint8Array.from(bin, c => c.charCodeAt(0)).buffer;
            };
            const bufToB64url = (buf: ArrayBuffer) =>
                btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

            const optsRes = await fetch(`${AUTH_BASE}/api/auth/webauthn/login/options?email=${encodeURIComponent(email.trim().toLowerCase())}`);
            if (!optsRes.ok) {
                const e = await optsRes.json().catch(() => ({}));
                throw new Error(e.error || x.passkeyOptionsFailed);
            }
            const opts = await optsRes.json();
            const publicKey = {
                ...opts,
                challenge: b64urlToBuffer(opts.challenge),
                allowCredentials: (opts.allowCredentials || []).map((c: { id: string }) => ({ ...c, id: b64urlToBuffer(c.id) })),
            };
            const cred = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;
            const resp = cred.response as AuthenticatorAssertionResponse;

            const verifyRes = await fetch(`${AUTH_BASE}/api/auth/webauthn/login/verify`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email.trim().toLowerCase(),
                    response: {
                        id: cred.id,
                        rawId: bufToB64url(cred.rawId),
                        type: cred.type,
                        response: {
                            clientDataJSON: bufToB64url(resp.clientDataJSON),
                            authenticatorData: bufToB64url(resp.authenticatorData),
                            signature: bufToB64url(resp.signature),
                            userHandle: resp.userHandle ? bufToB64url(resp.userHandle) : null,
                        },
                    },
                }),
            });
            const data = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(data.error || x.passkeyVerifyFailed);
            sessionStorage.setItem('currentUser', JSON.stringify(data.user));
            window.dispatchEvent(new Event('storage'));
            router.push(loginReturnPath());
        } catch (e: unknown) {
            const err = e as { name?: string; message?: string };
            if (err.name !== 'NotAllowedError') setError(err.message ?? x.passkeyLoginFailed);
        } finally {
            setPasskeyLoading(false);
        }
    };

    /** Phase ⑦ — complete the 2FA TOTP challenge using the temp_token
     *  the credentials step stashed. */
    const handle2FA = async (e: React.FormEvent) => {
        e.preventDefault();
        if (totpCode.replace(/\s/g, '').length < 6) {
            setError(x.codeRequired);
            return;
        }
        setError(''); setLoading(true);
        try {
            const res = await fetch(`${AUTH_BASE}/api/auth/2fa/complete`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ temp_token: tempToken, code: totpCode.replace(/\s/g, '') }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || data.message || t.failed);
            sessionStorage.setItem('currentUser', JSON.stringify(data.user));
            window.dispatchEvent(new Event('storage'));
            setStep('credentials'); setTotpCode(''); setTempToken('');
            router.push(loginReturnPath());
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : t.failed);
        } finally {
            setLoading(false);
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

            // 2FA gate — server replies with a short-lived temp_token; we
            // pivot to the 2fa step until the TOTP code completes.
            if (data.requires_2fa) {
                setTempToken(data.temp_token || '');
                setStep('2fa');
                return;
            }

            sessionStorage.setItem('currentUser', JSON.stringify(data.user));

            window.dispatchEvent(new Event('storage'));
            router.push(loginReturnPath());
        } catch (err: unknown) {
            // If network error (server not running), try client-side test account fallback
            if (err instanceof TypeError && err.message.includes('fetch')) {
                const testAccount = TEST_ACCOUNTS[email.toLowerCase()];
                if (testAccount && testAccount.password === password) {
                    sessionStorage.setItem('currentUser', JSON.stringify(testAccount.user));
                    window.dispatchEvent(new Event('storage'));
                    router.push(loginReturnPath());
                    return;
                }
            }
            setError(err instanceof Error ? err.message : t.failed);
        } finally {
            setLoading(false);
        }
    };

    // 2FA modal — overlays the credentials card without unmounting it,
    // so cancelling drops the user back to a still-filled login form.
    const twoFactorModal = step === '2fa' ? (
        <div role="dialog" aria-modal style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 'min(400px, 100%)', boxShadow: '0 24px 48px rgba(0,0,0,0.32)' }}>
                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: '#eff6ff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                    </div>
                    <h2 style={{ fontSize: 18, fontWeight: 900, color: '#111827', margin: '0 0 4px' }}>
                        {x.twoFactorTitle}
                    </h2>
                    <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                        {x.twoFactorPrompt}
                    </p>
                </div>
                <form onSubmit={handle2FA} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={totpCode}
                        onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                        placeholder="000000"
                        autoFocus
                        required
                        style={{ width: '100%', padding: '14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, fontSize: 22, outline: 'none', textAlign: 'center', letterSpacing: '0.4em', fontWeight: 700, fontFamily: 'ui-monospace, monospace', boxSizing: 'border-box' }}
                    />
                    {error && (
                        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <span>{error}</span>
                        </div>
                    )}
                    <button
                        type="submit"
                        disabled={loading || totpCode.length < 6}
                        style={{ width: '100%', padding: '12px', background: '#0b5cff', color: '#fff', fontWeight: 700, fontSize: 14, border: 'none', borderRadius: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: (loading || totpCode.length < 6) ? 0.5 : 1 }}
                    >
                        {loading ? x.verifying : x.verify}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setStep('credentials'); setError(''); setTotpCode(''); setTempToken(''); }}
                        style={{ width: '100%', padding: '8px', background: 'transparent', color: '#6b7280', fontSize: 13, border: 'none', cursor: 'pointer' }}
                    >
                        ← {x.backToSignIn}
                    </button>
                </form>
            </div>
        </div>
    ) : null;

    return (
        <div style={{ minHeight: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6fb', padding: '40px 16px', fontFamily: 'Pretendard, sans-serif', direction: lang === 'ar' ? 'rtl' : 'ltr', position: 'relative', overflow: 'hidden' }}>
            {twoFactorModal}
            {/* NexyFlow-style background blur blobs */}
            <div style={{ position: 'absolute', top: '-20%', right: '-10%', width: 600, height: 600, background: 'rgba(96, 165, 250, 0.10)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: 600, height: 600, background: 'rgba(167, 139, 250, 0.10)', borderRadius: '50%', filter: 'blur(120px)', pointerEvents: 'none' }} />
            {/* scale-in animation for the card */}
            <style>{`@keyframes nfLoginScaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }`}</style>

            <div style={{ position: 'relative', zIndex: 1, maxWidth: '420px', width: '100%', background: '#fff', padding: '40px 32px', borderRadius: '20px', boxShadow: '0 16px 48px rgba(0,0,0,0.08)', border: '1px solid #f3f4f6', animation: 'nfLoginScaleIn 0.25s ease-out' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    {/* Text logo — same style as Header */}
                    <div style={{ fontSize: '26px', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '16px' }}>
                        <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
                    </div>
                    <h1 style={{ fontSize: '22px', fontWeight: '900', color: '#111827', margin: '0 0 8px' }}>{t.title}</h1>
                    <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>{t.subtitle}</p>
                    <p role="note" style={{ fontSize: 12, color: '#64748b', margin: '10px 0 0', lineHeight: 1.5 }}>
                        🔒 {SESSION_NOTICE[lang]}
                    </p>
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
                    <div style={{ position: 'relative' }}>
                        <input
                            type={showPw ? 'text' : 'password'}
                            placeholder={t.password}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            style={{ width: '100%', padding: '14px 40px 14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                        />
                        <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowPw(v => !v)}
                            aria-label={showPw ? x.hidePassword : x.showPassword}
                            aria-pressed={showPw}
                            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 28, height: 28, border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                        >
                            {showPw ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" y1="2" x2="22" y2="22" /></svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
                            )}
                        </button>
                    </div>

                    {discoveredSso && (
                        <a
                            href={discoveredSso.loginUrl}
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 700, textDecoration: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,0.2)' }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                            <span>
                                {x.continueWith(discoveredSso.name)}
                            </span>
                            <span>→</span>
                        </a>
                    )}

                    {error && (
                        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        style={{ width: '100%', background: '#0b5cff', color: '#fff', fontWeight: '700', padding: '14px', borderRadius: '12px', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, fontSize: '15px', transition: '0.2s' }}
                    >
                        {loading ? t.signingIn : t.signIn}
                    </button>
                </form>

                {/* Phase ⑦ Passkey — only show when the browser supports it. */}
                {typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && (
                    <button
                        type="button"
                        onClick={handlePasskeyLogin}
                        disabled={passkeyLoading}
                        style={{ marginTop: 12, width: '100%', background: '#7c3aed', color: '#fff', fontWeight: 700, padding: '12px', borderRadius: 12, border: 'none', cursor: passkeyLoading ? 'wait' : 'pointer', opacity: passkeyLoading ? 0.6 : 1, fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 4px 12px rgba(124,58,237,0.2)' }}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="7" cy="14" r="5" /><path d="M11 10l5-5 1 1-1 1 1 1-2 2 1 1-2 2" />
                        </svg>
                        {passkeyLoading
                            ? x.verifying
                            : x.passkey}
                    </button>
                )}

                {/* 소셜 로그인 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0 16px' }}>
                    <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                    <span style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {x.or}
                    </span>
                    <div style={{ flex: 1, height: '1px', background: '#e5e7eb' }} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <Link
                        href={`/api/auth/nexysys/start?return_to=${encodeURIComponent(`/account?lang=${lang}`)}`}
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#0b5cff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, color: '#fff', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
                        {x.sso}
                    </Link>
                    <Link
                        href={`/api/auth/oauth/google?lang=${lang}`}
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#374151', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                        Google
                    </Link>
                    {process.env.NEXT_PUBLIC_KAKAO_CLIENT_ID && (
                    <Link
                        href={`/api/auth/oauth/kakao?lang=${lang}`}
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#FEE500', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#191919', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M12 3C6.48 3 2 6.36 2 10.5c0 2.63 1.74 4.95 4.38 6.3l-1.12 4.1c-.1.35.31.63.6.42l4.82-3.2c.43.04.87.06 1.32.06 5.52 0 10-3.36 10-7.5S17.52 3 12 3z" fill="#191919"/></svg>
                        {x.kakao}
                    </Link>
                    )}
                    {process.env.NEXT_PUBLIC_NAVER_CLIENT_ID && (
                    <Link
                        href={`/api/auth/oauth/naver?lang=${lang}`}
                        prefetch={false}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', background: '#03C75A', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, color: '#fff', textDecoration: 'none', cursor: 'pointer', transition: '0.15s', boxSizing: 'border-box' }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M16.27 3v8.46L7.73 3H3v18h4.73v-8.46L16.27 21H21V3h-4.73z" fill="#fff"/></svg>
                        {x.naver}
                    </Link>
                    )}
                </div>

                <div style={{ textAlign: 'center', marginTop: '16px' }}>
                    <a
                        href={`${nexysysBaseUrl()}/forgot-password`}
                        style={{ fontSize: '12px', color: '#6b7280', textDecoration: 'none', fontWeight: '500' }}
                    >
                        {t.forgot}
                    </a>
                </div>

                <div style={{ textAlign: 'center', marginTop: '10px' }}>
                    <Link
                        href={`/register?lang=${routeLang}`}
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
                            {x.demo}
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
                            <span>{x.customerDemo}</span>
                        </button>
                        <button
                            onClick={() => handleDemoLogin('partner')}
                            disabled={loading}
                            style={{ padding: '10px 12px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '12px', fontWeight: 700, color: '#1d4ed8', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', transition: '0.15s' }}
                        >
                            <span style={{ fontSize: '18px' }}>🔧</span>
                            <span>{x.partnerDemo}</span>
                        </button>
                    </div>
                    <p style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', margin: '8px 0 0', lineHeight: 1.5 }}>
                        {x.demoNote}
                    </p>
                </div>

                {process.env.NODE_ENV !== 'production' && (
                    <div style={{ marginTop: '20px', padding: '12px', background: '#f8faff', border: '1px solid #dbeafe', borderRadius: '10px' }}>
                        <div style={{ fontWeight: 700, color: '#374151', fontSize: 11, textAlign: 'center', marginBottom: 8, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{x.testAccounts}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                            {[
                                { email: 'test@nexysys.com', password: 'Test1234!', label: 'Test' },
                                { email: 'orgadmin@nexysys.com', password: 'OrgAdmin1!', label: 'OrgAdmin' },
                                { email: 'customer@nexyfab.com', password: 'Customer1!', label: 'Customer' },
                                { email: 'partner@nexyfab.com', password: 'Partner1!', label: 'Partner' },
                            ].map(acc => (
                                <button
                                    key={acc.email}
                                    type="button"
                                    onClick={() => { setEmail(acc.email); setPassword(acc.password); setError(''); }}
                                    style={{
                                        padding: '6px 8px',
                                        background: 'transparent',
                                        border: '1px dashed #cbd5e1',
                                        borderRadius: 6,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        color: '#475569',
                                        cursor: 'pointer',
                                        transition: 'border 0.15s, color 0.15s',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.border = '1px dashed #0b5cff';
                                        e.currentTarget.style.color = '#0b5cff';
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.border = '1px dashed #cbd5e1';
                                        e.currentTarget.style.color = '#475569';
                                    }}
                                    title={`${acc.email} / ${acc.password}`}
                                >
                                    {acc.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
