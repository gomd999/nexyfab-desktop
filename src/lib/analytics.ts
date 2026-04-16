/**
 * analytics.ts — Lightweight conversion tracking helper
 * Fires events to Google Analytics (gtag), Facebook Pixel (fbq), and PostHog
 * (direct capture API — no SDK) when configured.
 *
 * PostHog is enabled when `NEXT_PUBLIC_POSTHOG_KEY` is set. We POST directly
 * to `/capture/` instead of loading posthog-js, which would add ~60 KB of JS
 * and session replay hooks that we don't need for funnel analytics.
 */

type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
  }
}

// ─── PostHog anonymous distinct_id (persists across tabs) ─────────────────
function getPosthogId(): string {
  if (typeof window === 'undefined') return 'server';
  try {
    const KEY = 'ph_distinct_id';
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'anon_nostorage';
  }
}

function forwardToPostHog(eventName: string, params?: EventParams): void {
  if (typeof window === 'undefined') return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';

  const body = {
    api_key: key,
    event: eventName,
    distinct_id: getPosthogId(),
    properties: {
      ...params,
      $current_url: window.location.href,
      $pathname: window.location.pathname,
      $lib: 'nexyfab-lite',
    },
    timestamp: new Date().toISOString(),
  };

  // Fire-and-forget. keepalive lets the beacon survive page nav.
  try {
    void fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => { /* swallow */ });
  } catch { /* swallow */ }
}

export function trackEvent(eventName: string, params?: EventParams): void {
  if (typeof window === 'undefined') return;

  // Google Analytics 4
  if (window.gtag) {
    window.gtag('event', eventName, params);
  }

  // Facebook Pixel — map to standard events where possible
  if (window.fbq) {
    const fbMap: Record<string, string> = {
      quote_request: 'Lead',
      signup_complete: 'CompleteRegistration',
      file_upload: 'AddToCart',
      partner_register: 'Subscribe',
      project_inquiry: 'Contact',
      shape_download: 'Purchase',
    };
    const fbEvent = fbMap[eventName];
    if (fbEvent) {
      window.fbq('track', fbEvent, params);
    } else {
      window.fbq('trackCustom', eventName, params);
    }
  }

  // PostHog — product analytics funnel
  forwardToPostHog(eventName, params);
}

// Pre-defined conversion events
export const analytics = {
  quoteRequest: (params?: EventParams) => trackEvent('quote_request', params),
  signupComplete: (params?: EventParams) => trackEvent('signup_complete', params),
  fileUpload: (format: string) => trackEvent('file_upload', { format }),
  partnerRegister: (params?: EventParams) => trackEvent('partner_register', params),
  projectInquiry: (params?: EventParams) => trackEvent('project_inquiry', params),
  shapeDownload: (format: string) => trackEvent('shape_download', { format }),
  shapeGenerate: (shapeType: string) => trackEvent('shape_generate', { shape_type: shapeType }),
  dfmAnalysis: () => trackEvent('dfm_analysis'),
  feaRun: () => trackEvent('fea_run'),
  modelShare: () => trackEvent('model_share'),
};
