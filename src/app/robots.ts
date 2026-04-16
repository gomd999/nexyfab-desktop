export const dynamic = 'force-static';
import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/api/', '/_next/', '/adminlink/'],
            },
        ],
        sitemap: 'https://nexyfab.com/sitemap.xml',
        host: 'https://nexyfab.com',
    };
}

