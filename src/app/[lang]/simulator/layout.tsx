import { Metadata } from 'next';
import { buildMetadata, type Lang } from '@/lib/metaHelper';

export async function generateMetadata(
    { params }: { params: Promise<{ lang: string }> }
): Promise<Metadata> {
    const { lang } = await params;
    return buildMetadata(lang, 'simulator');
}

export default function SimulatorLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return <>{children}</>;
}
