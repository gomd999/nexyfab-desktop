'use client';

// Preference-center unsubscribe page. Reached from an email-link
// (?token=...&cat=...) or from Settings → "Email preferences". Token path
// auto-unsubs the named category; Settings path lets the user toggle each
// category individually.

import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type Cat = 'transactional' | 'billing' | 'product_updates' | 'marketing' | 'collab';

type Localized = Record<IsoLang, string>;
const CATEGORY_LABELS: Record<Cat, Localized & { desc: Localized; lock?: boolean }> = {
  transactional: {
    ko: '거래 안내', en: 'Transactional', ja: '取引通知', zh: '交易通知', es: 'Transaccionales', ar: 'المعاملات',
    desc: {
      ko: '인보이스, 비밀번호 재설정 등 — 법적으로 발송이 필요합니다.',
      en: 'Receipts, password resets — legally required, cannot be turned off.',
      ja: '領収書、パスワード再設定など。法令上必要なため停止できません。',
      zh: '收据、密码重置等——法律要求发送，无法关闭。',
      es: 'Recibos y restablecimientos de contraseña; son obligatorios y no se pueden desactivar.',
      ar: 'الإيصالات وإعادة تعيين كلمة المرور — مطلوبة قانونًا ولا يمكن إيقافها.',
    },
    lock: true,
  },
  billing: {
    ko: '결제 알림', en: 'Billing', ja: '請求通知', zh: '账单通知', es: 'Facturación', ar: 'الفوترة',
    desc: { ko: '결제 실패, 카드 만료, 환불 처리 결과', en: 'Failed payments, card expiry, refund updates', ja: '決済失敗、カード期限、返金状況', zh: '支付失败、银行卡到期、退款进度', es: 'Pagos fallidos, caducidad de tarjeta y reembolsos', ar: 'فشل الدفع وانتهاء البطاقة وتحديثات الاسترداد' },
  },
  product_updates: {
    ko: '제품 업데이트', en: 'Product updates', ja: '製品アップデート', zh: '产品更新', es: 'Actualizaciones del producto', ar: 'تحديثات المنتج',
    desc: { ko: '새 기능, 개선 사항, 릴리스 노트', en: 'New features, improvements, release notes', ja: '新機能、改善、リリースノート', zh: '新功能、改进和发行说明', es: 'Nuevas funciones, mejoras y notas de versión', ar: 'ميزات جديدة وتحسينات وملاحظات الإصدار' },
  },
  marketing: {
    ko: '마케팅 / 프로모션', en: 'Marketing', ja: 'マーケティング', zh: '营销推广', es: 'Marketing', ar: 'التسويق',
    desc: { ko: '할인, 이벤트, 케이스 스터디', en: 'Discounts, events, case studies', ja: '割引、イベント、導入事例', zh: '折扣、活动和案例研究', es: 'Descuentos, eventos y casos de estudio', ar: 'خصومات وفعاليات ودراسات حالة' },
  },
  collab: {
    ko: '협업 알림', en: 'Collaboration', ja: 'コラボレーション', zh: '协作通知', es: 'Colaboración', ar: 'التعاون',
    desc: { ko: '코멘트, 멘션, 공유 받은 프로젝트', en: 'Comments, mentions, shared projects', ja: 'コメント、メンション、共有プロジェクト', zh: '评论、提及和共享项目', es: 'Comentarios, menciones y proyectos compartidos', ar: 'التعليقات والإشارات والمشاريع المشتركة' },
  },
};

const COPY: Record<IsoLang, {
  title: string; intro: string; loading: string; required: string; legal: string;
  processed: (category: string) => string; processError: string; networkError: string;
}> = {
  ko: { title: '이메일 수신 설정', intro: '카테고리별로 어떤 이메일을 받을지 직접 설정하세요. 변경은 즉시 반영됩니다.', loading: '불러오는 중…', required: '필수', legal: '거래 안내 (영수증, 비밀번호 재설정 등)는 법적으로 발송이 필요하여 끌 수 없습니다.', processed: (c) => `${c} 메일 수신을 해제했습니다.`, processError: '처리에 실패했습니다', networkError: '네트워크 오류' },
  en: { title: 'Email preferences', intro: 'Choose which email categories you want to receive. Changes save immediately.', loading: 'Loading…', required: 'Required', legal: 'Transactional emails (receipts, password resets) are legally required and cannot be disabled.', processed: (c) => `Unsubscribed from ${c}.`, processError: 'Could not process the unsubscribe link', networkError: 'Network error' },
  ja: { title: 'メール受信設定', intro: '受信するメールのカテゴリを選択してください。変更はすぐに保存されます。', loading: '読み込み中…', required: '必須', legal: '取引メール（領収書、パスワード再設定など）は法令上必要なため停止できません。', processed: (c) => `${c}の配信を停止しました。`, processError: '配信停止リンクを処理できませんでした', networkError: 'ネットワークエラー' },
  zh: { title: '邮件接收设置', intro: '请选择希望接收的邮件类别。更改会立即保存。', loading: '加载中…', required: '必需', legal: '交易类邮件（收据、密码重置等）依法必须发送，无法关闭。', processed: (c) => `已退订${c}。`, processError: '无法处理退订链接', networkError: '网络错误' },
  es: { title: 'Preferencias de correo', intro: 'Elige las categorías de correo que deseas recibir. Los cambios se guardan de inmediato.', loading: 'Cargando…', required: 'Obligatorio', legal: 'Los correos transaccionales (recibos y restablecimientos de contraseña) son obligatorios y no se pueden desactivar.', processed: (c) => `Te has dado de baja de ${c}.`, processError: 'No se pudo procesar el enlace de baja', networkError: 'Error de red' },
  ar: { title: 'تفضيلات البريد الإلكتروني', intro: 'اختر فئات البريد التي تريد تلقيها. تُحفظ التغييرات فورًا.', loading: 'جارٍ التحميل…', required: 'مطلوب', legal: 'رسائل المعاملات (الإيصالات وإعادة تعيين كلمة المرور) مطلوبة قانونًا ولا يمكن تعطيلها.', processed: (c) => `تم إلغاء الاشتراك في ${c}.`, processError: 'تعذرت معالجة رابط إلغاء الاشتراك', networkError: 'خطأ في الشبكة' },
};

export default function UnsubscribePage({ params }: { params: Promise<{ lang: string }> }) {
  return (
    <Suspense fallback={null}>
      <UnsubscribeContent params={params} />
    </Suspense>
  );
}

function UnsubscribeContent({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const locale = toIsoLang(lang);
  const copy = COPY[locale];
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? null;
  const initialCat = (searchParams?.get('cat') ?? null) as Cat | null;

  const [prefs, setPrefs] = useState<Record<Cat, boolean>>({
    transactional: true, billing: true, product_updates: true, marketing: false, collab: true,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Token + cat path: auto-unsubscribe + show the rest of the preference center.
    if (token && initialCat) {
      void (async () => {
        try {
          const res = await fetch('/api/nexyfab/email-preferences', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, unsubscribe: initialCat }),
          });
          if (res.ok) {
            setPrefs(prev => ({ ...prev, [initialCat]: false }));
            setDone(copy.processed(CATEGORY_LABELS[initialCat][locale]));
          } else {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? copy.processError);
          }
        } catch {
          setError(copy.networkError);
        } finally {
          setLoading(false);
        }
      })();
      return;
    }

    // Logged-in path — fetch current preferences from the API.
    void fetch('/api/nexyfab/email-preferences')
      .then(r => r.ok ? r.json() : null)
      .then((data: { preferences?: Record<Cat, boolean> } | null) => {
        if (data?.preferences) setPrefs(data.preferences);
      })
      .catch(() => { /* show defaults */ })
      .finally(() => setLoading(false));
  }, [token, initialCat, locale, copy]);

  const togglePref = async (cat: Cat) => {
    if (CATEGORY_LABELS[cat].lock) return;
    const next = { ...prefs, [cat]: !prefs[cat] };
    setPrefs(next);
    setBusy(true);
    try {
      await fetch('/api/nexyfab/email-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { [cat]: next[cat] } }),
      });
    } catch {
      // Revert on failure.
      setPrefs(prefs);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', background: '#0c0f14', color: '#d8dee5', padding: '40px 24px', fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px' }}>
          {copy.title}
        </h1>
        <p style={{ color: '#8a93a3', fontSize: 14, margin: '0 0 24px', lineHeight: 1.6 }}>
          {copy.intro}
        </p>

        {done && (
          <div style={{ padding: 12, borderRadius: 6, background: 'rgba(16, 185, 129, 0.13)', border: '1px solid #10b981', color: '#10b981', fontSize: 13, marginBottom: 20 }}>
            ✓ {done}
          </div>
        )}
        {error && (
          <div style={{ padding: 12, borderRadius: 6, background: 'rgba(239, 68, 68, 0.13)', border: '1px solid #ef4444', color: '#ef4444', fontSize: 13, marginBottom: 20 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div role="status" aria-live="polite" style={{ padding: 40, textAlign: 'center', color: '#aab3c2' }}>
            {copy.loading}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {(Object.keys(CATEGORY_LABELS) as Cat[]).map(cat => {
              const meta = CATEGORY_LABELS[cat];
              return (
                <label
                  key={cat}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: 16, borderRadius: 8,
                    border: '1px solid #262d38', background: '#14181f',
                    cursor: meta.lock ? 'not-allowed' : 'pointer',
                    opacity: meta.lock ? 0.6 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={prefs[cat]}
                    disabled={meta.lock || busy}
                    onChange={() => togglePref(cat)}
                    style={{ marginTop: 2, width: 18, height: 18, accentColor: '#4f8bff' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {meta[locale]}
                      {meta.lock && (
                        <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 6px', borderRadius: 3, background: '#262d38', color: '#8a93a3' }}>
                          {copy.required}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#8a93a3', marginTop: 4, lineHeight: 1.5 }}>
                      {meta.desc[locale]}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: 11, color: '#8a93a3', lineHeight: 1.6 }}>
          {copy.legal}
        </p>
      </div>
    </main>
  );
}
