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
import { isKorean } from '@/lib/i18n/normalize';

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
};

function BillingReturnInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { lang }     = useParams<{ lang: string }>();
  const t = dict[isKorean(lang) ? 'ko' : 'en'];

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
