import { Metadata } from 'next';
import { buildMetadata } from '@/lib/metaHelper';

export async function generateMetadata(
    { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
    const { lang } = await params;
    return buildMetadata(lang, 'quick-quote');
}

export default function QuickQuoteLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
