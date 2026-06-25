import { redirect } from 'next/navigation';

// Consolidated: the old Nexy AI Studio is superseded by the new chat Studio
// at /[lang]/studio (live 3D + Customizer sliders + expert handoff). Redirect
// any bookmarked / linked traffic there.
export default async function AiStudioRedirect({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  redirect(`/${lang}/studio`);
}
