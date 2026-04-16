'use client';

/**
 * CheckoutModal
 *
 * 국가 기반 자동 결제 수단 분기:
 *   KR  → Toss Payments (카드 / 카카오페이 / 네이버페이 / 토스페이)
 *   기타 → Airwallex Drop-in (글로벌 카드 결제)
 *
 * 사용:
 *   <CheckoutModal
 *     plan="pro"
 *     product="nexyfab"
 *     country="KR"
 *     priceFormatted="₩29,000"
 *     onSuccess={() => router.refresh()}
 *     onClose={() => setOpen(false)}
 *   />
 */

import { useEffect, useRef, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface CheckoutParams {
  // Airwallex
  provider:            'airwallex' | 'toss';
  intentId?:           string;
  clientSecret?:       string;
  env?:                'demo' | 'prod';
  paymentMethodTypes?: string[]; // local payment methods for Drop-in
  // Toss
  orderId?:     string;
  amount?:      number;
  currency?:    string;
  orderName?:   string;
  customerKey?: string;
  invoiceId?:   string;
}

interface CheckoutModalProps {
  plan:             string;
  product:          string;
  country:          string;
  priceFormatted:   string;
  period:           'monthly' | 'annual';
  annualFormatted?: string; // annual total price string (e.g. "₩278,208")
  onSuccess:        () => void;
  onClose:          () => void;
}

// ── Declare globals loaded via CDN ────────────────────────────────────────────

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Airwallex: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    TossPayments: any;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const TOSS_CDN     = 'https://js.tosspayments.com/v2/standard';
const AIRWALLEX_CDN = 'https://checkout.airwallex.com/assets/elements.bundle.min.js';

// ── Main component ────────────────────────────────────────────────────────────

export default function CheckoutModal({
  plan, product, country, priceFormatted, period, annualFormatted, onSuccess, onClose,
}: CheckoutModalProps) {
  const [step, setStep]       = useState<'loading' | 'ready' | 'paying' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [params, setParams]   = useState<CheckoutParams | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const isToss = country === 'KR';

  // ── Step 1: fetch checkout params from server ───────────────────────────────
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/billing/checkout', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ plan, product, period, action: 'create' }),
        });
        const data = await res.json() as CheckoutParams & { error?: string };
        if (!res.ok) throw new Error(data.error ?? '결제 초기화 실패');
        setParams(data);
        setStep('ready');
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : '오류 발생');
        setStep('error');
      }
    })();
  }, [plan, product, period]);

  // ── Step 2a: Mount Airwallex Drop-in (현지 결제수단 포함) ───────────────────
  useEffect(() => {
    if (step !== 'ready' || isToss || !params?.intentId || !params.clientSecret) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dropInElement: any = null;

    void (async () => {
      try {
        await loadScript(AIRWALLEX_CDN);
        const AW = window.Airwallex;
        if (!AW) throw new Error('Airwallex SDK 로드 실패');

        await AW.init({
          env:    params.env ?? 'demo',
          origin: window.location.origin,
          // locale will be auto-detected from browser; override if needed
        });

        // Drop-in: shows all available payment methods for the currency/country
        // (card + local wallets/banks depending on what was passed to the intent)
        dropInElement = AW.createElement('dropIn', {
          intent_id:            params.intentId,
          client_secret:        params.clientSecret,
          // Restrict to the methods we computed server-side; undefined = show all
          ...(params.paymentMethodTypes?.length && {
            payment_method_types: params.paymentMethodTypes,
          }),
          style: {
            popupWidth:  400,
            popupHeight: 549,
            base: { fontSize: '14px', fontFamily: 'inherit', color: '#111827' },
          },
        });

        if (cardRef.current) {
          dropInElement.mount(cardRef.current);
        }

        // Drop-in uses element.on() instead of window events
        dropInElement.on('success', async (event: { detail?: { paymentIntent?: { id?: string } } }) => {
          const intentId = event?.detail?.paymentIntent?.id ?? params.intentId;
          setStep('paying');
          try {
            const completeRes = await fetch('/api/billing/checkout', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ plan, product, period, action: 'complete', intentId }),
            });
            const d = await completeRes.json() as { error?: string };
            if (!completeRes.ok) throw new Error(d.error);
            setStep('success');
            setTimeout(() => { onSuccess(); }, 1500);
          } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : '완료 처리 실패');
            setStep('error');
          }
        });

        dropInElement.on('error', (event: { detail?: { error?: { message?: string } } }) => {
          const msg = event?.detail?.error?.message ?? '결제 오류';
          setErrorMsg(msg);
          setStep('error');
        });
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'SDK 오류');
        setStep('error');
      }
    })();

    return () => {
      try { dropInElement?.unmount?.(); } catch { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isToss, params]);

  // ── Step 2b: Trigger Toss payment ────────────────────────────────────────────
  async function handleTossPayment(method: 'CARD' | 'TOSSPAY' | 'TRANSFER' = 'CARD') {
    if (!params?.orderId || !params.amount || !params.customerKey) return;
    setStep('paying');
    try {
      await loadScript(TOSS_CDN);
      const tossPayments = window.TossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? '');
      const payment = tossPayments.payment({ customerKey: params.customerKey });
      await payment.requestPayment({
        method,
        amount:     { currency: 'KRW', value: params.amount },
        orderId:    params.orderId,
        orderName:  params.orderName ?? `${product} ${plan}`,
        successUrl: `${window.location.origin}/nexyfab/billing/return`,
        failUrl:    `${window.location.origin}/nexyfab/billing/return?fail=1`,
      });
        // Note: Toss redirects the page, so code after this line won't run
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '결제 오류');
      setStep('error');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden ${isToss ? 'max-w-md' : 'max-w-lg'}`}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-gray-900">결제하기</h2>
              {period === 'annual' && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">연간 20% 할인</span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {product} {plan.charAt(0).toUpperCase() + plan.slice(1)} ·{' '}
              {period === 'annual' ? (
                <span className="font-semibold text-gray-800">{annualFormatted ?? priceFormatted} / 년</span>
              ) : (
                <span className="font-semibold text-gray-800">{priceFormatted} / 월</span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="p-6">

          {/* Loading */}
          {step === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-400">결제 준비 중...</p>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <div className="text-5xl">✅</div>
              <p className="text-lg font-black text-gray-900">결제 완료!</p>
              <p className="text-sm text-gray-500">{plan} 플랜이 활성화되었습니다.</p>
            </div>
          )}

          {/* Paying (processing) */}
          {step === 'paying' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <svg className="animate-spin h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-400">결제 처리 중...</p>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-4xl">❌</div>
              <p className="text-sm text-red-600 text-center">{errorMsg}</p>
              <button
                onClick={() => { setStep('loading'); setErrorMsg(''); setParams(null); }}
                className="px-4 py-2 text-sm font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition">
                다시 시도
              </button>
            </div>
          )}

          {/* Airwallex Drop-in (카드 + 현지 결제수단 자동 표시) */}
          {step === 'ready' && !isToss && (
            <div className="space-y-3">
              {/* Airwallex Drop-in mounts here — shows all available local payment methods */}
              <div
                ref={cardRef}
                id="airwallex-dropin-element"
                className="min-h-[200px] w-full"
              />
              <p className="text-xs text-gray-400 text-center flex items-center justify-center gap-1">
                🔒 Airwallex 보안 결제 · PCI DSS 인증
              </p>
            </div>
          )}

          {/* Toss button */}
          {step === 'ready' && isToss && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 space-y-1">
                <p className="font-semibold text-gray-800">결제 정보 확인</p>
                <p>플랜: <span className="font-bold">{plan.charAt(0).toUpperCase() + plan.slice(1)}</span></p>
                {period === 'annual' ? (
                  <>
                    <p>결제 주기: <span className="font-bold text-green-700">연간 결제</span></p>
                    <p>금액: <span className="font-bold">{annualFormatted ?? priceFormatted} / 년</span>
                      <span className="ml-1 text-xs text-green-600">(20% 할인 적용)</span>
                    </p>
                    <p className="text-xs text-gray-400">VAT(10%) 포함 · 1년 단위 결제</p>
                  </>
                ) : (
                  <>
                    <p>금액: <span className="font-bold">{priceFormatted} / 월</span></p>
                    <p className="text-xs text-gray-400">VAT(10%) 포함 · 매월 자동 결제</p>
                  </>
                )}
              </div>

              <button
                onClick={() => void handleTossPayment('CARD')}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl text-base transition">
                카드 결제
              </button>

              <div className="grid grid-cols-2 gap-2">
                {([
                  { label: '토스페이',  icon: '🔵', method: 'TOSSPAY' as const },
                  { label: '계좌이체',  icon: '🏦', method: 'TRANSFER' as const },
                ] as const).map(m => (
                  <button key={m.label}
                    onClick={() => void handleTossPayment(m.method)}
                    className="flex flex-col items-center gap-1 py-2 border border-gray-200 rounded-xl text-xs text-gray-600 hover:bg-gray-50 transition">
                    <span className="text-lg">{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>

              <p className="text-xs text-gray-400 text-center">🔒 Toss Payments 보안 결제 · 국내 인증</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
