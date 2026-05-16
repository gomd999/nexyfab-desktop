// FX rates daily cron — pulls KRW→{USD,EUR,JPY,GBP,AUD,CAD} from a public
// source and caches in process. In production the cron runs once a day so
// pricing stays current without paying for a paid FX feed.
//
// Source: exchangerate.host (no key, generous free tier). If unreachable
// we keep the previous live rates and (if older than 36h) the static
// fallback in multi-currency.ts kicks in.

import { NextRequest, NextResponse } from 'next/server';
import { setLiveFxRates, type Currency } from '@/lib/multi-currency';

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const TARGETS: Currency[] = ['USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD'];
  try {
    const url = `https://api.exchangerate.host/latest?base=KRW&symbols=${TARGETS.join(',')}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json() as { rates?: Record<string, number> };
    const rates: Partial<Record<Currency, number>> = { KRW: 1 };
    for (const t of TARGETS) {
      if (typeof data.rates?.[t] === 'number') rates[t] = data.rates[t];
    }
    setLiveFxRates(rates);
    return NextResponse.json({ ok: true, rates });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 502 });
  }
}
