import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { buildMetadata, type Lang } from '@/lib/metaHelper';
import JsonLd from '@/components/JsonLd';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import LangSetter from '@/components/LangSetter';
import CookieBanner from '@/components/CookieBanner';
import ToastProvider from '@/components/ToastProvider';
import NavigationProgress from '@/components/NavigationProgress';
import FetchAuthRetry from '@/components/FetchAuthRetry';
import PlanRefresher from '@/components/PlanRefresher';
import UtmListener from '@/components/UtmListener';
import NexyfabSessionHydrator from '@/components/nexyfab/NexyfabSessionHydrator';
import ConsentScripts from '@/components/ConsentScripts';
import { PaidBetaBanner } from '@/components/PaidBetaBanner';
import WebVitalsReporter from '@/components/WebVitalsReporter';
import Script from 'next/script';
import { getAdminSettings } from '@/lib/adminSettings';
import { resolvePrerenderLocales } from '@/lib/prerenderLocales';

const inter = Inter({
    subsets: ['latin'],
    weight: ['400', '500', '600', '700'],
    variable: '--font-inter',
    display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ['latin'],
    weight: ['400', '500', '600'],
    variable: '--font-jetbrains-mono',
    display: 'swap',
});

const HTML_LANG: Record<Lang, string> = {
    kr: 'ko',
    en: 'en',
    ja: 'ja',
    cn: 'zh-CN',
    es: 'es',
    ar: 'ar',
};

export async function generateMetadata(
    { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
    const { lang } = await params;
    return buildMetadata(lang, 'home');
}

// Mobile viewport meta — without this iOS Safari renders the page at 980px
// CSS width which makes the entire site look like a desktop screenshot
// shrunk into a phone. Round 32 mobile pass.
export const viewport: import('next').Viewport = {
    width: 'device-width',
    initialScale: 1,
    // Allow user pinch-zoom (a11y); we don't lock max-scale.
    minimumScale: 1,
    themeColor: '#0f172a',
};

export async function generateStaticParams() {
    return resolvePrerenderLocales(
        process.env.NEXYFAB_PRERENDER_LOCALES,
        process.env.TAURI === 'true',
    ).map(lang => ({ lang }));
}

// Locales not pre-rendered above remain globally available and are generated
// on first request, then cached by Next.js. This is the documented subset mode.
export const dynamicParams = true;

export default async function LangLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ lang: string }>;
}) {
    const { lang } = await params;
    const validLang = (['kr', 'en', 'ja', 'cn', 'es', 'ar'].includes(lang) ? lang : 'en') as Lang;
    const htmlLang = HTML_LANG[validLang];
    const adminSettings = getAdminSettings();

    return (
        <html lang={htmlLang} dir={validLang === 'ar' ? 'rtl' : 'ltr'} className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
            <head>
                {/* Nexyfab N 파비콘 */}
                <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
                <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32" />
                <link rel="icon" href="/favicon-16.png" type="image/png" sizes="16x16" />
                <link rel="icon" href="/favicon.ico" sizes="any" />
                <link rel="apple-touch-icon" href="/favicon-icon.png" sizes="256x256" />
                {/* PWA — manifest.webmanifest is the canonical name (W3C);
                    manifest.json kept for legacy clients that requested it. */}
                <link rel="manifest" href="/manifest.webmanifest" />
                <meta name="theme-color" content="#0c0f14" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="NexyFab" />
                <meta name="mobile-web-app-capable" content="yes" />

                {adminSettings.headScripts && (
                    <div dangerouslySetInnerHTML={{ __html: adminSettings.headScripts }} />
                )}
            </head>
            <body suppressHydrationWarning>
                {adminSettings.bodyScripts && (
                    <div dangerouslySetInnerHTML={{ __html: adminSettings.bodyScripts }} />
                )}
                <NavigationProgress />
                <FetchAuthRetry />
                <PlanRefresher />
                <UtmListener />
                <NexyfabSessionHydrator />
                <ToastProvider>
                <LangSetter />
                <WebVitalsReporter />
                <Header />
                <PaidBetaBanner lang={validLang} />
                <JsonLd lang={validLang} />
                {children}
                <Footer />
                <CookieBanner lang={validLang} />
                <ConsentScripts
                    googleAnalyticsId={adminSettings.googleAnalyticsId}
                    fbPixelId={adminSettings.fbPixelId}
                />
                </ToastProvider>
                {/* PWA — Service Worker (next/script runs on client; raw <script> in RSC warns in React 19) */}
                <Script id="nexyfab-sw-register" strategy="afterInteractive">
                  {`if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}`}
                </Script>
            </body>
        </html>
    );
}
