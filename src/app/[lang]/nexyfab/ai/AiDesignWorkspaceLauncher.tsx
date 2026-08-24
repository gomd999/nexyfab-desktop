'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AiDesignInputEvent } from '@/lib/ai/aiDesignInputAdapter';
import { getAiDesignWorkspaceCopy } from '@/lib/ai/aiDesignWorkspaceI18n';
import styles from './AiDesignWorkspace.module.css';

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function createAiDesignTextWorkspaceRequestV10(projectId: string, prompt: string) {
  const normalized = prompt.trim();
  if (!normalized || normalized.length > 4_000) throw new Error('AI_DESIGN_PROMPT_LENGTH_INVALID');
  const bytes = new TextEncoder().encode(normalized);
  const sourceHash = hex(await crypto.subtle.digest('SHA-256', bytes));
  const sessionId = `ai:${crypto.randomUUID()}`;
  const input: AiDesignInputEvent = {
    projectId,
    revision: 0,
    sourceId: `input:${crypto.randomUUID()}`,
    sourceHash,
    projectContentHash: sourceHash,
    kind: 'text',
    mimeType: 'text/plain',
    sizeBytes: bytes.byteLength,
    fields: [{ key: 'design_request', category: 'requirement', value: normalized }],
    authority: 'user_confirmed',
    provenance: { rights: 'user_owned', origin: 'nexyfab.ai-design.v10', aiUseAllowed: true, derivativeUseAllowed: true },
    label: 'AI Design request',
    extractionKind: 'user',
  };
  return {
    sessionId,
    body: {
      operation: 'create' as const,
      projectId,
      sessionId,
      revisionToken: `rev:${sourceHash.slice(0, 48)}`,
      inputs: [input],
    },
  };
}

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI_DESIGN_WORKSPACE_CREATE_FAILED');
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
      <div className={styles.launcherMeta}><span>Project: {projectId}</span><span>Rights: user_owned</span><span>Exact CAD: NOT_RUN</span></div>
      {error && <p className={styles.notice} role="alert">{error}</p>}
      <button type="button" className={styles.launchButton} disabled={busy || !prompt.trim()} onClick={start}>{busy ? text.creatingSession : text.startDesign}</button>
    </div>
  </main>;
}
