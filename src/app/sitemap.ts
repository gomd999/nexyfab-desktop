export const dynamic = 'force-static';
import { MetadataRoute } from 'next';

const BASE_URL = 'https://nexyfab.com';
const LANGS = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];

const PAGES = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/how-it-works', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/company-introduction', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/project-inquiry', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/partner-register', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/shape-generator', priority: 0.95, changeFrequency: 'weekly' },
    { path: '/quick-quote', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/simulator', priority: 0.85, changeFrequency: 'monthly' },
    { path: '/nexyfab', priority: 0.9, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/factories', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/auto-order', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/component-order', priority: 0.7, changeFrequency: 'monthly' },
    { path: '/privacy-policy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/terms-of-use', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/refund-policy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/security-policy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/customer-policy', priority: 0.3, changeFrequency: 'yearly' },
    { path: '/partner-policy', priority: 0.3, changeFrequency: 'yearly' },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();
    const entries: MetadataRoute.Sitemap = [];

    for (const lang of LANGS) {
        for (const page of PAGES) {
            entries.push({
                url: `${BASE_URL}/${lang}${page.path}`,
                lastModified: now,
                changeFrequency: page.changeFrequency,
                priority: page.priority,
            });
        }
    }

    return entries;
}

