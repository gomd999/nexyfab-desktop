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
import PlanRefresher from '@/components/PlanRefresher';
import UtmListener from '@/components/UtmListener';
import NexyfabSessionHydrator from '@/components/nexyfab/NexyfabSessionHydrator';
import ConsentScripts from '@/components/ConsentScripts';
import { PaidBetaBanner } from '@/components/PaidBetaBanner';
import Script from 'next/script';
import { getAdminSettings } from '@/lib/adminSettings';

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
    return [{ lang: 'kr' }, { lang: 'en' }, { lang: 'ja' }, { lang: 'cn' }, { lang: 'es' }, { lang: 'ar' }];
}

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
                {/* PWA */}
                <link rel="manifest" href="/manifest.json" />
                <meta name="theme-color" content="#0f172a" />

                {adminSettings.headScripts && (
                    <div dangerouslySetInnerHTML={{ __html: adminSettings.headScripts }} />
                )}
                <script src={`https://www.google.com/recaptcha/api.js?render=${process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY}`} async defer></script>
            </head>
            <body suppressHydrationWarning>
                {adminSettings.bodyScripts && (
                    <div dangerouslySetInnerHTML={{ __html: adminSettings.bodyScripts }} />
                )}
                <NavigationProgress />
                <PlanRefresher />
                <UtmListener />
                <NexyfabSessionHydrator />
                <ToastProvider>
                <LangSetter />
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
