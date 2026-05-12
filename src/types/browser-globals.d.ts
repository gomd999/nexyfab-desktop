/** Ambient browser globals not covered by default lib.dom (reCAPTCHA v3, Tauri). */
declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

export {};
