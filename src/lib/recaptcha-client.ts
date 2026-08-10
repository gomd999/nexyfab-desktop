'use client';

type RecaptchaApi = NonNullable<Window['grecaptcha']>;

const SCRIPT_ID = 'nexyfab-recaptcha-v3';
const LOAD_TIMEOUT_MS = 15_000;
const ACTION_RE = /^[A-Za-z0-9_/-]{1,100}$/;

let loading: Promise<RecaptchaApi> | null = null;
let loadingSiteKey: string | null = null;

function configuredSiteKey(siteKey?: string): string {
  const value = (siteKey ?? process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ?? '').trim();
  if (!value) throw new Error('reCAPTCHA site key is not configured');
  return value;
}
/**
 * Loads reCAPTCHA only when a protected form is submitted.  The previous
 * language-layout script made every landing/design/CAD route download Google
 * reCAPTCHA even when no protected form existed on the page.
 */
export function loadRecaptchaV3(siteKey?: string): Promise<RecaptchaApi> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('reCAPTCHA is only available in a browser'));
  }

  const key = configuredSiteKey(siteKey);
  if (window.grecaptcha) return Promise.resolve(window.grecaptcha);
  if (loading) {
    if (loadingSiteKey !== key) return Promise.reject(new Error('reCAPTCHA is already loading with a different site key'));
    return loading;
  }

  loadingSiteKey = key;
  loading = new Promise<RecaptchaApi>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (error) {
        loading = null;
        loadingSiteKey = null;
        reject(error);
        return;
      }
      if (!window.grecaptcha) {
        loading = null;
        loadingSiteKey = null;
        reject(new Error('reCAPTCHA loaded without exposing its API'));
        return;
      }
      resolve(window.grecaptcha);
    };

    const timeoutId = window.setTimeout(() => finish(new Error('reCAPTCHA load timed out')), LOAD_TIMEOUT_MS);
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => finish(), { once: true });
    script.addEventListener('error', () => finish(new Error('reCAPTCHA failed to load')), { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(key)}`;
      document.head.appendChild(script);
    }
  });

  return loading;
}

export async function executeRecaptchaV3(action: string, siteKey?: string): Promise<string> {
  if (!ACTION_RE.test(action)) throw new Error('Invalid reCAPTCHA action');
  const key = configuredSiteKey(siteKey);
  const api = await loadRecaptchaV3(key);
  return new Promise<string>((resolve, reject) => {
    api.ready(() => {
      void api.execute(key, { action }).then(resolve).catch(reject);
    });
  });
}
