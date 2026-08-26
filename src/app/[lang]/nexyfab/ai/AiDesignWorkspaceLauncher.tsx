'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createAiDesignTextWorkspaceRequestV10 } from '@/lib/ai/aiDesignWorkspaceBootstrap';
import { getAiDesignWorkspaceCopy } from '@/lib/ai/aiDesignWorkspaceI18n';
import styles from './AiDesignWorkspace.module.css';

export { createAiDesignTextWorkspaceRequestV10 } from '@/lib/ai/aiDesignWorkspaceBootstrap';

export default function AiDesignWorkspaceLauncher({ lang, projectId }: { lang: string; projectId: string }) {
  const router = useRouter();
  const text = getAiDesignWorkspaceCopy(lang).launcher;
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true); setError(null);
    try {
      const request = await createAiDesignTextWorkspaceRequestV10(projectId, prompt);
      const response = await fetch('/api/nexyfab/ai-design/workspace-session', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `HTTP_${response.status}`);
      router.push(`/${encodeURIComponent(lang)}/nexyfab/ai?projectId=${encodeURIComponent(projectId)}&sessionId=${encodeURIComponent(request.sessionId)}`);
    } catch {
      setError(text.createFailed);
      setBusy(false);
    }
  }

  return <main className={styles.launcher}>
    <div className={styles.launcherCard}>
      <p className={styles.eyebrow}>NEXYFAB AI DESIGN · V10</p>
      <h1>{text.title}</h1>
      <p>{text.description}</p>
      <label htmlFor="ai-design-request">{text.requestLabel}</label>
      <textarea id="ai-design-request" value={prompt} maxLength={4_000} rows={7} onChange={event => setPrompt(event.target.value)} placeholder={text.requestPlaceholder} />
      <div className={styles.launcherMeta}>
        <span>{text.project}: {projectId}</span>
        <span>{text.rights}: {text.userOwned}</span>
        <span>{text.exactCad}: {text.notRun}</span>
      </div>
      {error && <p className={styles.notice} role="alert">{error}</p>}
      <button type="button" className={styles.launchButton} disabled={busy || !prompt.trim()} onClick={start}>{busy ? text.creatingSession : text.startDesign}</button>
    </div>
  </main>;
}
