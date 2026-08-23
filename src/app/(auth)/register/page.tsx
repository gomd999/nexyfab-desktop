'use client';

// Signup entry — pick customer vs partner. The two account types fill
// completely different forms (customer = simple name/email/password,
// partner = factory profile + processes + certifications), so we make
// the choice explicit instead of routing everyone through one form and
// hoping they spot the right link.
//
// Routes:
//   /register/customer  — existing 3-field customer signup
//   /partner/register   — existing 5-section partner application

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';

type Lang = 'en' | 'ko' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, {
  title: string;
  subtitle: string;
  customerTitle: string;
  customerDesc: string;
  customerCta: string;
  partnerTitle: string;
  partnerDesc: string;
  partnerCta: string;
  haveAccount: string;
  signIn: string;
}> = {
  ko: {
    title: '어떻게 가입하시겠어요?',
    subtitle: 'NexyFab에는 두 종류의 계정이 있어요. 사용 목적에 맞게 선택해주세요.',
    customerTitle: '고객사로 가입',
    customerDesc: '3D 설계 · AI 자동 모델링 · 제조사에 견적 요청 · 주문/배송 관리',
    customerCta: '고객사 계정 만들기 →',
    partnerTitle: '파트너사(입점 제조사)로 가입',
    partnerDesc: '회사·공장 정보, 가공 공정·인증 등록 후 NexyFab 견적 요청을 받습니다',
    partnerCta: '파트너 신청하기 →',
    haveAccount: '이미 계정이 있으신가요?',
    signIn: '로그인',
  },
  en: {
    title: 'How would you like to sign up?',
    subtitle: 'NexyFab has two account types. Pick the one that matches what you want to do.',
    customerTitle: 'Sign up as a customer',
    customerDesc: '3D design · AI auto-modeling · request quotes from manufacturers · track orders',
    customerCta: 'Create a customer account →',
    partnerTitle: 'Sign up as a partner (manufacturer)',
    partnerDesc: 'Register your factory profile, processes, and certifications to receive NexyFab quote requests',
    partnerCta: 'Apply as a partner →',
    haveAccount: 'Already have an account?',
    signIn: 'Sign in',
  },
  ja: {
    title: 'どのように登録しますか？',
    subtitle: 'NexyFabには2種類のアカウントがあります。用途に合わせて選択してください。',
    customerTitle: '顧客として登録',
    customerDesc: '3D 設計・AI 自動モデリング・製造業者へ見積依頼・注文管理',
    customerCta: '顧客アカウントを作成 →',
    partnerTitle: 'パートナー（製造業者）として登録',
    partnerDesc: '会社・工場情報、加工工程・認証を登録して NexyFab の見積依頼を受け取ります',
    partnerCta: 'パートナー申請する →',
    haveAccount: 'すでにアカウントをお持ちですか？',
    signIn: 'ログイン',
  },
  zh: {
    title: '您要如何注册？',
    subtitle: 'NexyFab 有两种账户类型。请根据您的需要选择。',
    customerTitle: '注册为客户',
    customerDesc: '3D 设计 · AI 自动建模 · 向制造商请求报价 · 订单跟踪',
    customerCta: '创建客户账户 →',
    partnerTitle: '注册为合作伙伴（制造商）',
    partnerDesc: '注册公司·工厂信息、加工工艺·认证后接收 NexyFab 报价请求',
    partnerCta: '申请合作伙伴 →',
    haveAccount: '已经有账户？',
    signIn: '登录',
  },
  es: {
    title: '¿Cómo quieres registrarte?',
    subtitle: 'NexyFab tiene dos tipos de cuenta. Elige el que se ajuste a tu objetivo.',
    customerTitle: 'Registrarse como cliente',
    customerDesc: 'Diseño 3D · modelado IA · solicita cotizaciones a fabricantes · seguimiento de pedidos',
    customerCta: 'Crear cuenta de cliente →',
    partnerTitle: 'Registrarse como socio (fabricante)',
    partnerDesc: 'Registra perfil de fábrica, procesos y certificaciones para recibir solicitudes de cotización',
    partnerCta: 'Aplicar como socio →',
    haveAccount: '¿Ya tienes una cuenta?',
    signIn: 'Iniciar sesión',
  },
  ar: {
    title: 'كيف تريد التسجيل؟',
    subtitle: 'لدى NexyFab نوعان من الحسابات. اختر ما يناسب احتياجك.',
    customerTitle: 'التسجيل كعميل',
    customerDesc: 'التصميم ثلاثي الأبعاد · النمذجة بالذكاء الاصطناعي · طلب عروض من المصنعين · متابعة الطلبات',
    customerCta: 'إنشاء حساب عميل →',
    partnerTitle: 'التسجيل كشريك (مصنع)',
    partnerDesc: 'سجل ملف المصنع والعمليات والشهادات لتلقي طلبات عروض NexyFab',
    partnerCta: 'التقديم كشريك →',
    haveAccount: 'لديك حساب بالفعل؟',
    signIn: 'تسجيل الدخول',
  },
};

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    const query = new URLSearchParams(window.location.search).get('lang');
    if (query) return toIsoLang(query);
    const stored = localStorage.getItem('app_language')
      || localStorage.getItem('nf_lang')
      || localStorage.getItem('nexyfab_language');
    if (stored) return toIsoLang(stored);
  } catch { /* ignore */ }
  return 'en';
}

export default function RegisterChooserPage() {
  const [lang, setLang] = useState<Lang>('en');
  useEffect(() => { setLang(detectLang()); }, []);
  const t = dict[lang];
  const routeLang = toRouteLang(lang);
  const rtl = lang === 'ar';

  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      style={{
        minHeight: 'calc(100vh - 120px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        padding: '40px 16px',
        fontFamily: 'Pretendard, sans-serif',
      }}
    >
      <div style={{ maxWidth: 760, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 16 }}>
            <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111827', margin: '0 0 8px' }}>{t.title}</h1>
          <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>{t.subtitle}</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {/* Customer card */}
          <Link
            href={`/register/customer?lang=${routeLang}`}
            prefetch={false}
            style={{
              display: 'block',
              padding: 28,
              background: '#fff',
              borderRadius: 20,
              border: '2px solid #e5e7eb',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'border 0.15s, transform 0.15s, box-shadow 0.15s',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget;
              el.style.border = '2px solid #0b5cff';
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = '0 8px 24px rgba(11,92,255,0.12)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              el.style.border = '2px solid #e5e7eb';
              el.style.transform = 'translateY(0)';
              el.style.boxShadow = '0 4px 16px rgba(0,0,0,0.04)';
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🧑‍💼</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', marginBottom: 6 }}>
              {t.customerTitle}
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
              {t.customerDesc}
            </p>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0b5cff' }}>
              {t.customerCta}
            </div>
          </Link>

          {/* Partner card */}
          <Link
            href={`/partner/register?lang=${routeLang}`}
            prefetch={false}
            style={{
              display: 'block',
              padding: 28,
              background: '#fff',
              borderRadius: 20,
              border: '2px solid #e5e7eb',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'border 0.15s, transform 0.15s, box-shadow 0.15s',
              cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
            }}
            onMouseEnter={e => {
              const el = e.currentTarget;
              el.style.border = '2px solid #f59e0b';
              el.style.transform = 'translateY(-2px)';
              el.style.boxShadow = '0 8px 24px rgba(245,158,11,0.12)';
            }}
            onMouseLeave={e => {
              const el = e.currentTarget;
              el.style.border = '2px solid #e5e7eb';
              el.style.transform = 'translateY(0)';
              el.style.boxShadow = '0 4px 16px rgba(0,0,0,0.04)';
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>🏭</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111827', marginBottom: 6 }}>
              {t.partnerTitle}
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.5 }}>
              {t.partnerDesc}
            </p>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#f59e0b' }}>
              {t.partnerCta}
            </div>
          </Link>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <span style={{ fontSize: 13, color: '#6b7280' }}>
            {t.haveAccount}{' '}
          </span>
          <Link href={`/login?lang=${routeLang}`} prefetch={false} style={{ fontSize: 13, color: '#0b5cff', textDecoration: 'none', fontWeight: 700 }}>
            {t.signIn}
          </Link>
        </div>
      </div>
    </div>
  );
}
