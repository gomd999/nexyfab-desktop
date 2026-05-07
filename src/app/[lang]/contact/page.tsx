'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';

const dict = {
  ko: {
    title: '문의하기',
    sub: 'NexyFab 팀에 직접 연락하기',
    desc: '궁금한 점, 기능 제안, 버그 리포트 무엇이든 보내주세요. 영업일 기준 1~2일 내 답장드립니다.',
    name: '이름',
    namePl: '성함을 입력해주세요 (선택)',
    email: '이메일',
    emailPl: 'you@example.com',
    category: '문의 유형',
    cat_general: '일반 문의',
    cat_order: '주문/견적 관련',
    cat_partner: '파트너 등록',
    cat_billing: '결제/요금',
    cat_bug: '버그 신고',
    cat_other: '기타',
    subject: '제목',
    subjectPl: '문의 내용을 한 줄로 요약해주세요',
    message: '내용',
    messagePl: '자세한 내용을 적어주세요 (최소 10자)',
    submit: '보내기',
    sending: '전송 중…',
    success: '문의가 접수되었습니다. 곧 연락드리겠습니다.',
    errGeneric: '전송에 실패했습니다. 잠시 후 다시 시도해주세요.',
    errEmail: '올바른 이메일 주소를 입력해주세요.',
    errSubject: '제목은 3자 이상이어야 합니다.',
    errMessage: '내용은 10자 이상이어야 합니다.',
    required: '*',
    altContact: '이메일로도 연락 가능합니다:',
  },
  en: {
    title: 'Contact Us',
    sub: 'Talk directly with the NexyFab team',
    desc: 'Questions, feature requests, or bug reports — all welcome. We reply within 1-2 business days.',
    name: 'Name',
    namePl: 'Your name (optional)',
    email: 'Email',
    emailPl: 'you@example.com',
    category: 'Category',
    cat_general: 'General',
    cat_order: 'Order / Quote',
    cat_partner: 'Partner Registration',
    cat_billing: 'Billing',
    cat_bug: 'Bug Report',
    cat_other: 'Other',
    subject: 'Subject',
    subjectPl: 'Brief one-line summary',
    message: 'Message',
    messagePl: 'Please describe your inquiry (min 10 chars)',
    submit: 'Send',
    sending: 'Sending…',
    success: 'Your message has been received. We will get back to you soon.',
    errGeneric: 'Failed to send. Please try again shortly.',
    errEmail: 'Please enter a valid email address.',
    errSubject: 'Subject must be at least 3 characters.',
    errMessage: 'Message must be at least 10 characters.',
    required: '*',
    altContact: 'You can also reach us at:',
  },
  ja: {
    title: 'お問い合わせ',
    sub: 'NexyFab チームへ直接お送りください',
    desc: 'ご質問、機能リクエスト、バグ報告、すべて歓迎します。営業日1〜2日以内にご返信いたします。',
    name: 'お名前',
    namePl: 'お名前（任意）',
    email: 'メール',
    emailPl: 'you@example.com',
    category: 'カテゴリ',
    cat_general: '一般的なお問い合わせ',
    cat_order: '注文/見積もり',
    cat_partner: 'パートナー登録',
    cat_billing: '請求・料金',
    cat_bug: 'バグ報告',
    cat_other: 'その他',
    subject: '件名',
    subjectPl: '一行の要約をお書きください',
    message: '内容',
    messagePl: '詳細をご記入ください（10文字以上）',
    submit: '送信',
    sending: '送信中…',
    success: 'お問い合わせを受け付けました。追ってご連絡いたします。',
    errGeneric: '送信に失敗しました。しばらくしてから再度お試しください。',
    errEmail: '有効なメールアドレスをご入力ください。',
    errSubject: '件名は3文字以上でご入力ください。',
    errMessage: '内容は10文字以上でご入力ください。',
    required: '*',
    altContact: 'メールでもご連絡いただけます：',
  },
  zh: {
    title: '联系我们',
    sub: '直接联系 NexyFab 团队',
    desc: '欢迎提问、反馈功能建议或报告缺陷。我们将在1至2个工作日内回复。',
    name: '姓名',
    namePl: '您的姓名（选填）',
    email: '邮箱',
    emailPl: 'you@example.com',
    category: '类别',
    cat_general: '一般咨询',
    cat_order: '订单/报价',
    cat_partner: '合作伙伴注册',
    cat_billing: '账单/费用',
    cat_bug: '缺陷报告',
    cat_other: '其他',
    subject: '主题',
    subjectPl: '用一句话概括您的问题',
    message: '内容',
    messagePl: '请详细说明您的问题（至少10个字符）',
    submit: '发送',
    sending: '发送中…',
    success: '您的咨询已收到，我们会尽快与您联系。',
    errGeneric: '发送失败，请稍后再试。',
    errEmail: '请输入有效的电子邮箱地址。',
    errSubject: '主题至少需要3个字符。',
    errMessage: '内容至少需要10个字符。',
    required: '*',
    altContact: '您也可以通过邮箱联系我们：',
  },
  es: {
    title: 'Contacto',
    sub: 'Contacta directamente con el equipo de NexyFab',
    desc: 'Preguntas, sugerencias o reportes de errores — todo es bienvenido. Respondemos en 1-2 días hábiles.',
    name: 'Nombre',
    namePl: 'Tu nombre (opcional)',
    email: 'Correo',
    emailPl: 'tu@ejemplo.com',
    category: 'Categoría',
    cat_general: 'General',
    cat_order: 'Pedido / Cotización',
    cat_partner: 'Registro de Socio',
    cat_billing: 'Facturación',
    cat_bug: 'Reporte de Error',
    cat_other: 'Otro',
    subject: 'Asunto',
    subjectPl: 'Resumen breve en una línea',
    message: 'Mensaje',
    messagePl: 'Describe tu consulta (mín 10 caracteres)',
    submit: 'Enviar',
    sending: 'Enviando…',
    success: 'Tu mensaje ha sido recibido. Te responderemos pronto.',
    errGeneric: 'Error al enviar. Por favor intenta de nuevo.',
    errEmail: 'Por favor ingresa un correo válido.',
    errSubject: 'El asunto debe tener al menos 3 caracteres.',
    errMessage: 'El mensaje debe tener al menos 10 caracteres.',
    required: '*',
    altContact: 'También puedes escribirnos a:',
  },
  ar: {
    title: 'تواصل معنا',
    sub: 'تواصل مباشرة مع فريق NexyFab',
    desc: 'الأسئلة، اقتراحات الميزات، تقارير الأخطاء — جميعها مرحب بها. نرد خلال 1-2 أيام عمل.',
    name: 'الاسم',
    namePl: 'اسمك (اختياري)',
    email: 'البريد الإلكتروني',
    emailPl: 'you@example.com',
    category: 'الفئة',
    cat_general: 'عام',
    cat_order: 'طلب / عرض سعر',
    cat_partner: 'تسجيل شريك',
    cat_billing: 'الفواتير',
    cat_bug: 'تقرير خطأ',
    cat_other: 'أخرى',
    subject: 'الموضوع',
    subjectPl: 'ملخص سطر واحد',
    message: 'الرسالة',
    messagePl: 'صف استفسارك (10 أحرف على الأقل)',
    submit: 'إرسال',
    sending: 'جارٍ الإرسال…',
    success: 'تم استلام رسالتك. سنرد عليك قريباً.',
    errGeneric: 'فشل الإرسال. يرجى المحاولة مرة أخرى.',
    errEmail: 'يرجى إدخال عنوان بريد إلكتروني صالح.',
    errSubject: 'يجب أن يحتوي الموضوع على 3 أحرف على الأقل.',
    errMessage: 'يجب أن تحتوي الرسالة على 10 أحرف على الأقل.',
    required: '*',
    altContact: 'يمكنك أيضاً مراسلتنا على:',
  },
};

type Category = 'general' | 'order' | 'partner' | 'billing' | 'bug' | 'other';

export default function ContactPage() {
  const pathname = usePathname();
  const langCode = pathname.split('/')[1] || 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[langCode] ?? 'en'];
  const isRtl = langCode === 'ar';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState<Category>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t.errEmail);
      return;
    }
    if (subject.trim().length < 3) {
      setError(t.errSubject);
      return;
    }
    if (message.trim().length < 10) {
      setError(t.errMessage);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email, category, subject, message,
          context: {
            page: typeof window !== 'undefined' ? window.location.href : '',
            lang: langCode,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          },
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t.errGeneric);
        return;
      }
      setDone(true);
    } catch {
      setError(t.errGeneric);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 720, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 36, fontWeight: 700, marginBottom: 8 }}>{t.title}</h1>
      <p style={{ color: '#666', fontSize: 16, marginBottom: 6 }}>{t.sub}</p>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 32 }}>{t.desc}</p>

      {done ? (
        <div style={{
          padding: '20px 24px', borderRadius: 12, background: '#eaf7ea',
          color: '#1f6f1f', fontSize: 15, border: '1px solid #c6e8c6',
        }}>
          ✓ {t.success}
        </div>
      ) : (
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16 }}>
          <Field label={`${t.name}`} >
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.namePl}
              maxLength={100}
              style={inputStyle}
            />
          </Field>

          <Field label={`${t.email} ${t.required}`}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t.emailPl}
              required
              maxLength={200}
              style={inputStyle}
            />
          </Field>

          <Field label={`${t.category} ${t.required}`}>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              style={inputStyle}
            >
              <option value="general">{t.cat_general}</option>
              <option value="order">{t.cat_order}</option>
              <option value="partner">{t.cat_partner}</option>
              <option value="billing">{t.cat_billing}</option>
              <option value="bug">{t.cat_bug}</option>
              <option value="other">{t.cat_other}</option>
            </select>
          </Field>

          <Field label={`${t.subject} ${t.required}`}>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder={t.subjectPl}
              required
              maxLength={200}
              style={inputStyle}
            />
          </Field>

          <Field label={`${t.message} ${t.required}`}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t.messagePl}
              required
              maxLength={5000}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 8, background: '#fdecea',
              color: '#a03030', fontSize: 14, border: '1px solid #f4c7c3',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '14px 24px', borderRadius: 10, fontSize: 16, fontWeight: 600,
              background: loading ? '#999' : '#111', color: '#fff', border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', marginTop: 8,
            }}
          >
            {loading ? t.sending : t.submit}
          </button>
        </form>
      )}

      <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #eee', fontSize: 13, color: '#888' }}>
        {t.altContact} <a href="mailto:nexyfab@nexysys.com" style={{ color: '#1f6fb2' }}>nexyfab@nexysys.com</a>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 6 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#333' }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid #d0d0d0',
  fontSize: 15,
  outline: 'none',
  background: '#fff',
  width: '100%',
  boxSizing: 'border-box',
};
