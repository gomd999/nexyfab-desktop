'use client';

/**
 * /nexyfab/billing/return
 *
 * Toss Payments success/fail redirect landing page.
 *
 * Success query params (Toss → successUrl):  ?paymentKey=...&orderId=...&amount=...
 * Fail query params   (Toss → failUrl):      ?fail=1&message=...&code=...
 */

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { isKorean, toIsoLang } from '@/lib/i18n/normalize';
import { useAuthStore } from '@/hooks/useAuth';

const dict = {
  ko: {
    processing: '결제 처리 중...',
    processingDesc: '잠시만 기다려 주세요.',
    success: '결제 완료!',
    successDesc: '플랜이 활성화되었습니다.\n잠시 후 이동합니다.',
    fail: '결제 실패',
    backToBilling: '결제 페이지로 돌아가기',
    cancelDefault: '결제가 취소되었습니다.',
    badParams: '결제 정보가 올바르지 않습니다.',
    completeError: '결제 완료 처리 중 오류가 발생했습니다.',
    loadingFallback: '처리 중...',
  },
  en: {
    processing: 'Processing payment…',
    processingDesc: 'Please wait a moment.',
    success: 'Payment complete!',
    successDesc: 'Your plan has been activated.\nRedirecting shortly.',
    fail: 'Payment failed',
    backToBilling: 'Back to billing',
    cancelDefault: 'Payment was cancelled.',
    badParams: 'Invalid payment information.',
    completeError: 'An error occurred while completing payment.',
    loadingFallback: 'Processing…',
  },
  ja: {
    processing: '決済処理中…',
    processingDesc: 'しばらくお待ちください。',
    success: '決済完了！',
    successDesc: 'プランが有効になりました。\nまもなく移動します。',
    fail: '決済失敗',
    backToBilling: '決済ページに戻る',
    cancelDefault: '決済がキャンセルされました。',
    badParams: '決済情報が正しくありません。',
    completeError: '決済の完了処理中にエラーが発生しました。',
    loadingFallback: '処理中…',
  },
  zh: {
    processing: '正在处理付款…',
    processingDesc: '请稍候。',
    success: '付款完成！',
    successDesc: '套餐已激活。\n即将跳转。',
    fail: '付款失败',
    backToBilling: '返回结算页面',
    cancelDefault: '付款已取消。',
    badParams: '付款信息不正确。',
    completeError: '完成付款时发生错误。',
    loadingFallback: '处理中…',
  },
  es: {
    processing: 'Procesando el pago…',
    processingDesc: 'Espere un momento.',
    success: '¡Pago completado!',
    successDesc: 'Su plan se ha activado.\nLe redirigiremos en breve.',
    fail: 'Pago fallido',
    backToBilling: 'Volver a facturación',
    cancelDefault: 'El pago se ha cancelado.',
    badParams: 'La información de pago no es válida.',
    completeError: 'Se ha producido un error al completar el pago.',
    loadingFallback: 'Procesando…',
  },
  ar: {
    processing: 'جارٍ معالجة الدفع…',
    processingDesc: 'يُرجى الانتظار قليلاً.',
    success: 'تم الدفع بنجاح!',
    successDesc: 'تم تفعيل خطتك.\nسيتم تحويلك بعد قليل.',
    fail: 'فشل الدفع',
    backToBilling: 'العودة إلى الفوترة',
    cancelDefault: 'تم إلغاء عملية الدفع.',
    badParams: 'معلومات الدفع غير صحيحة.',
    completeError: 'حدث خطأ أثناء إتمام الدفع.',
    loadingFallback: 'جارٍ المعالجة…',
  },
};

function BillingReturnInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { lang }     = useParams<{ lang: string }>();
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const refreshPlan = useAuthStore(s => s.refreshPlan);

  const [status, setStatus]   = useState<'processing' | 'success' | 'fail'>('processing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const fail       = searchParams.get('fail');
    const paymentKey = searchParams.get('paymentKey');
    const orderId    = searchParams.get('orderId');
    const amount     = searchParams.get('amount');
    const failMsg    = searchParams.get('message');

    if (fail === '1') {
      setStatus('fail');
      setMessage(failMsg ?? t.cancelDefault);
      return;
    }

    if (!paymentKey || !orderId || !amount) {
      setStatus('fail');
      setMessage(t.badParams);
      return;
    }

    const parts      = orderId.split('-');
    const product    = parts[1] ?? 'nexyfab';
    const plan       = parts[2] ?? 'pro';
    const periodCode = parts[3] ?? 'm';
    const period     = periodCode === 'y' ? 'annual' : 'monthly';

    void (async () => {
      try {
        const res = await fetch('/api/billing/checkout', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan, product, period,
            action:         'complete',
            tossPaymentKey: paymentKey,
            tossOrderId:    orderId,
            tossAmount:     parseInt(amount),
          }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) throw new Error(data.error ?? t.completeError);
        setStatus('success');
        // Refresh plan from server so the entire app sees the new tier on
        // the very next render — without this, gates like "프로젝트 추가"
        // still show the paywall until full reload. The webhook may race the
        // checkout-complete API; we refresh once now and re-poll briefly.
        void refreshPlan();
        // Quick poll: if webhook hasn't landed yet by the first refresh,
        // retry every 1.5s up to 3 times. Lightweight — no UX impact.
        let polls = 0;
        const id = setInterval(() => {
          polls += 1;
          void refreshPlan();
          if (polls >= 3) clearInterval(id);
        }, 1500);
        setTimeout(() => router.push(`/${lang}/nexyfab/settings/billing?checkout=success`), 2000);
      } catch (e) {
        setStatus('fail');
        setMessage(e instanceof Error ? e.message : t.completeError);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 w-full max-w-sm text-center">

        {status === 'processing' && (
          <>
            <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-lg font-black text-gray-900">{t.processing}</p>
            <p className="text-sm text-gray-400 mt-1">{t.processingDesc}</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-5xl mb-4">✅</div>
            <p className="text-xl font-black text-gray-900">{t.success}</p>
            <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{t.successDesc}</p>
          </>
        )}

        {status === 'fail' && (
          <>
            <div className="text-5xl mb-4">❌</div>
            <p className="text-xl font-black text-gray-900">{t.fail}</p>
            <p className="text-sm text-red-500 mt-2">{message}</p>
            <button
              onClick={() => router.push(`/${lang}/nexyfab/settings/billing`)}
              className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
              {t.backToBilling}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function BillingReturnPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">…</p>
      </div>
    }>
      <BillingReturnInner />
    </Suspense>
  );
}
