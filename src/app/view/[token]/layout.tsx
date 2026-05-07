import type { Metadata } from 'next';

const BASE_URL = 'https://nexyfab.com';

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const { token } = await params;

  // Fetch share data for dynamic metadata
  let title = 'Shared 3D Model | NexyFab';
  let description = 'View a shared 3D model with specs, DFM analysis, and annotations on NexyFab.';
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || BASE_URL}/api/nexyfab/share?token=${token}`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      const name = data.metadata?.name || 'Untitled';
      title = `${name} — 3D Model | NexyFab`;
      description = `View "${name}" 3D model shared via NexyFab. ${data.metadata?.material ? `Material: ${data.metadata.material}.` : ''} Interactive 3D viewer with specs and annotations.`;
    }
  } catch {
    // fallback to defaults
  }

  return {
    title,
    description,
    openGraph: {
      type: 'website',
      url: `${BASE_URL}/view/${token}`,
      siteName: 'NexyFab',
      title,
      description,
      images: [{ url: `${BASE_URL}/og-image.png`, width: 1200, height: 630, alt: 'NexyFab Shared Model' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [`${BASE_URL}/og-image.png`],
    },
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function ViewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
