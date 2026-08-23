import AiConnectionsClient from './AiConnectionsClient';

export default async function AiConnectionsPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  return <AiConnectionsClient lang={lang} />;
}
