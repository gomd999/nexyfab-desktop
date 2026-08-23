'use client';

import { useEffect, useMemo, useState } from 'react';
import { CODEGEN_MODELS, findCodegenModel, type CodegenModel } from '@/lib/ai/codegenModels';
import { hasDesktopPower, isTauriApp } from '@/lib/tauri';
import { langDir, toIsoLang, type IsoLang } from '@/lib/i18n/normalize';
import { createRemotePrecisionCadExecutor } from '@/lib/precision-cad-agent/remoteBridge';
import { createTauriPrecisionCadExecutor, type PrecisionCadAgentExecutor } from '@/lib/precision-cad-agent/executor';
import type { RemotePrecisionCadProjectBinding } from '@/lib/precision-cad-agent/remoteCadContract';
import { usePrecisionCadAgentController } from '@/lib/precision-cad-agent/usePrecisionCadAgentController';
import PrecisionCadAgentPanel from '../nexyfab/design/PrecisionCadAgentPanel';

type DesktopProvider = 'openai' | 'anthropic';

type WorkspaceCopy = {
  title: string;
  saveFirst: string;
  open: string;
  close: string;
  provider: string;
  model: string;
  loading: string;
  revisionMissing: string;
  loadFailed: string;
};

const COPY: Record<IsoLang, WorkspaceCopy> = {
  ko: {
    title: '정밀 CAD 에이전트',
    saveFirst: '정밀 CAD 에이전트를 사용하려면 저장된 클라우드 프로젝트와 CAD 버전 정보가 필요합니다.',
    open: '정밀 CAD 에이전트 열기', close: '닫기', provider: '제공자', model: '모델',
    loading: '클라우드 프로젝트와 최신 CAD 버전을 확인하고 있습니다.',
    revisionMissing: '이 프로젝트에는 확정된 CAD 버전이 아직 없습니다. 먼저 정확 커널 CAD 버전을 저장해 주세요.',
    loadFailed: '클라우드 CAD 버전을 불러오지 못했습니다. 로그인과 프로젝트 권한을 확인한 뒤 다시 열어 주세요.',
  },
  en: {
    title: 'Precision CAD agent',
    saveFirst: 'A saved cloud project with a CAD revision is required to use the precision CAD agent.',
    open: 'Open precision CAD agent', close: 'Close', provider: 'Provider', model: 'Model',
    loading: 'Checking the cloud project and its latest CAD revision.',
    revisionMissing: 'This project has no committed CAD revision yet. Save an exact-kernel CAD revision first.',
    loadFailed: 'Could not load the cloud CAD revision. Check your sign-in and project access, then reopen it.',
  },
  ja: {
    title: '高精度 CAD エージェント',
    saveFirst: '高精度 CAD エージェントを使うには、CAD リビジョン付きの保存済みクラウドプロジェクトが必要です。',
    open: '高精度 CAD エージェントを開く', close: '閉じる', provider: 'プロバイダー', model: 'モデル',
    loading: 'クラウドプロジェクトと最新の CAD リビジョンを確認しています。',
    revisionMissing: 'このプロジェクトには確定済みの CAD リビジョンがありません。先に正確カーネルの CAD リビジョンを保存してください。',
    loadFailed: 'クラウド CAD リビジョンを読み込めませんでした。ログインとプロジェクト権限を確認して、もう一度開いてください。',
  },
  zh: {
    title: '精密 CAD 代理',
    saveFirst: '使用精密 CAD 代理需要已保存且带有 CAD 版本的云项目。',
    open: '打开精密 CAD 代理', close: '关闭', provider: '提供商', model: '模型',
    loading: '正在检查云项目及其最新 CAD 版本。',
    revisionMissing: '此项目尚无已提交的 CAD 版本。请先保存精确内核 CAD 版本。',
    loadFailed: '无法加载云端 CAD 版本。请检查登录状态和项目权限后重新打开。',
  },
  es: {
    title: 'Agente CAD de precisión',
    saveFirst: 'Para usar el agente CAD de precisión necesitas un proyecto en la nube guardado con una revisión CAD.',
    open: 'Abrir agente CAD de precisión', close: 'Cerrar', provider: 'Proveedor', model: 'Modelo',
    loading: 'Comprobando el proyecto en la nube y su última revisión CAD.',
    revisionMissing: 'Este proyecto aún no tiene una revisión CAD confirmada. Guarda primero una revisión CAD de núcleo exacto.',
    loadFailed: 'No se pudo cargar la revisión CAD en la nube. Comprueba el acceso al proyecto y vuelve a abrirla.',
  },
  ar: {
    title: 'وكيل CAD الدقيق',
    saveFirst: 'يلزم وجود مشروع سحابي محفوظ يتضمن إصدار CAD لاستخدام وكيل CAD الدقيق.',
    open: 'فتح وكيل CAD الدقيق', close: 'إغلاق', provider: 'المزوّد', model: 'النموذج',
    loading: 'جارٍ التحقق من المشروع السحابي وأحدث مراجعة CAD.',
    revisionMissing: 'لا يحتوي هذا المشروع بعد على مراجعة CAD معتمدة. احفظ أولاً مراجعة CAD بنواة دقيقة.',
    loadFailed: 'تعذر تحميل مراجعة CAD السحابية. تحقق من تسجيل الدخول وصلاحية المشروع ثم أعد فتحها.',
  },
};

type DesktopModelOption = Pick<CodegenModel, 'id' | 'label' | 'model'>;

const PROVIDER_MODELS: Record<DesktopProvider, readonly DesktopModelOption[]> = {
  openai: CODEGEN_MODELS.filter(model => model.provider === 'openai'),
  // This is the repository's provider default (src/lib/ai/providers/anthropic.ts).
  anthropic: [{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', model: 'claude-haiku-4-5-20251001' }],
};

/**
 * Browser-safe parent directory extraction for the native path returned by
 * the Tauri .nfab file picker. This deliberately returns null for a bare
 * filename: callers must never invent a project root.
 */
export function dirnameFromDesktopFilePath(filePath: string | null | undefined): string | null {
  const value = typeof filePath === 'string' ? filePath.trim() : '';
  if (!value) return null;
  const separator = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  if (separator < 0) return null;
  if (separator === 0) return value.slice(0, 1);
  return value.slice(0, separator);
}

function isDesktopProvider(provider: string | undefined): provider is DesktopProvider {
  return provider === 'openai' || provider === 'anthropic';
}

function usableBinding(binding: unknown): binding is RemotePrecisionCadProjectBinding {
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return false;
  const candidate = binding as Record<string, unknown>;
  return typeof candidate.projectId === 'string'
    && Boolean(candidate.projectId.trim())
    && Number.isSafeInteger(candidate.revision)
    && Number(candidate.revision) >= 0
    && Number.isSafeInteger(candidate.updatedAt)
    && Number(candidate.updatedAt) > 0;
}

type BindingLoadState = 'idle' | 'loading' | 'ready' | 'missing' | 'failed';
type WorkspaceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function loadRemotePrecisionCadBinding(
  projectId: string,
  fetcher: WorkspaceFetch = fetch,
): Promise<RemotePrecisionCadProjectBinding | null> {
  const id = projectId.trim();
  if (!id) return null;
  const encoded = encodeURIComponent(id);
  const [projectResponse, revisionResponse] = await Promise.all([
    fetcher(`/api/nexyfab/projects/${encoded}/`, { credentials: 'include', cache: 'no-store' }),
    fetcher(`/api/nexyfab/projects/${encoded}/cad-revisions`, { credentials: 'include', cache: 'no-store' }),
  ]);
  if (!projectResponse.ok) throw new Error('REMOTE_BINDING_LOAD_FAILED');
  if (revisionResponse.status === 404) return null;
  if (!revisionResponse.ok) throw new Error('REMOTE_BINDING_LOAD_FAILED');
  const projectPayload = await projectResponse.json() as { project?: { id?: unknown; updatedAt?: unknown } };
  const revisionPayload = await revisionResponse.json() as { envelope?: { workspace?: { projectId?: unknown; revision?: unknown } } };
  const binding = {
    projectId: projectPayload.project?.id,
    revision: revisionPayload.envelope?.workspace?.revision,
    updatedAt: projectPayload.project?.updatedAt,
  };
  if (binding.projectId !== id || revisionPayload.envelope?.workspace?.projectId !== id || !usableBinding(binding)) {
    throw new Error('REMOTE_BINDING_INVALID');
  }
  return binding;
}

function Notice({ lang, message }: { lang: string; message: string }) {
  const copy = COPY[toIsoLang(lang)];
  return (
    <section
      dir={langDir(lang)}
      aria-label={copy.title}
      data-testid="precision-cad-agent-notice"
      style={styles.notice}
    >
      <strong>{copy.title}</strong>
      <span>{message}</span>
    </section>
  );
}

function PrecisionCadAgentControllerMount({
  projectRoot,
  binding,
  provider,
  model,
  lang,
}: {
  projectRoot?: string;
  binding?: RemotePrecisionCadProjectBinding;
  provider: DesktopProvider;
  model: string;
  lang: string;
}) {
  const executor = useMemo<PrecisionCadAgentExecutor | undefined>(() => {
    if (binding) return createRemotePrecisionCadExecutor();
    if (projectRoot) return createTauriPrecisionCadExecutor();
    return undefined;
  }, [binding, projectRoot]);
  const controller = usePrecisionCadAgentController({
    ...(projectRoot ? { projectRoot } : {}),
    ...(binding ? { binding } : {}),
    provider,
    model,
    lang,
    executor,
    autoLoadCatalog: true,
  });

  return (
    <div dir={langDir(lang)} data-testid="precision-cad-agent-workspace" style={styles.workspace}>
      <PrecisionCadAgentPanel lang={lang} controller={controller} />
    </div>
  );
}

export default function PrecisionCadAgentWorkspace({
  lang,
  desktopFilePath,
  aiModelId,
  projectBinding,
  cloudProjectId,
}: {
  lang: string;
  desktopFilePath: string | null;
  aiModelId: string;
  /** Authoritative cloud binding; never synthesize revision or updatedAt here. */
  projectBinding?: RemotePrecisionCadProjectBinding | null;
  /** Cloud identity used to load authoritative project/CAD revision tokens. */
  cloudProjectId?: string | null;
}) {
  const desktopReady = isTauriApp()
    && hasDesktopPower('nativeFilesystem')
    && hasDesktopPower('nativeSidecar');
  const projectRoot = useMemo(() => dirnameFromDesktopFilePath(desktopFilePath), [desktopFilePath]);
  const suppliedBinding = usableBinding(projectBinding) ? projectBinding : undefined;
  const [loadedBinding, setLoadedBinding] = useState<RemotePrecisionCadProjectBinding>();
  const [bindingState, setBindingState] = useState<BindingLoadState>(suppliedBinding ? 'ready' : 'idle');
  useEffect(() => {
    if (suppliedBinding) {
      setLoadedBinding(suppliedBinding);
      setBindingState('ready');
      return;
    }
    const projectId = cloudProjectId?.trim();
    if (!projectId) {
      setLoadedBinding(undefined);
      setBindingState('idle');
      return;
    }
    const abort = new AbortController();
    setLoadedBinding(undefined);
    setBindingState('loading');
    void loadRemotePrecisionCadBinding(projectId, (input, init) => fetch(input, { ...init, signal: abort.signal }))
      .then(binding => {
        if (abort.signal.aborted) return;
        setLoadedBinding(binding ?? undefined);
        setBindingState(binding ? 'ready' : 'missing');
      })
      .catch(() => {
        if (!abort.signal.aborted) setBindingState('failed');
      });
    return () => abort.abort();
  }, [cloudProjectId, suppliedBinding]);
  const remoteBinding = suppliedBinding ?? loadedBinding;
  const remoteReady = Boolean(remoteBinding);
  const localReady = desktopReady && Boolean(projectRoot);
  const selectedModel = useMemo(() => findCodegenModel(aiModelId), [aiModelId]);
  const initialProvider: DesktopProvider = isDesktopProvider(selectedModel?.provider) ? selectedModel.provider : 'openai';
  const [provider, setProvider] = useState<DesktopProvider>(initialProvider);
  const [model, setModel] = useState(
    isDesktopProvider(selectedModel?.provider) && selectedModel?.model.trim()
      ? selectedModel.model
      : PROVIDER_MODELS[initialProvider][0]?.model ?? '',
  );
  const [open, setOpen] = useState(false);
  const copy = COPY[toIsoLang(lang)];

  // Browser mode is remote only when an authoritative binding exists. Native
  // sidecar remains a fallback for a saved local file; no cwd/root is guessed.
  if (!remoteReady && !localReady && !cloudProjectId?.trim()) return <Notice lang={lang} message={copy.saveFirst} />;

  // Remounting on all three authority inputs clears stale catalog/run state.
  const authorityKey = remoteBinding
    ? `${remoteBinding.projectId}\u0000${remoteBinding.revision}\u0000${remoteBinding.updatedAt}`
    : projectRoot ?? 'no-project-root';
  const controllerKey = `${authorityKey}\u0000${projectRoot ?? ''}\u0000${provider}\u0000${model}`;
  return (
    <div dir={langDir(lang)} style={styles.dock}>
      <button type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} style={styles.launcher}>
        {open ? copy.close : copy.open}
      </button>
      {open && (
        <div style={styles.popover}>
          <div style={styles.settings}>
            <label style={styles.settingLabel}>{copy.provider}
              <select value={provider} onChange={(event) => {
                const next = event.target.value as DesktopProvider;
                setProvider(next);
                setModel(PROVIDER_MODELS[next][0]?.model ?? '');
              }} style={styles.select}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </label>
            <label style={styles.settingLabel}>{copy.model}
              <select value={model} onChange={(event) => setModel(event.target.value)} style={styles.select}>
                {PROVIDER_MODELS[provider].map(option => <option key={option.id} value={option.model}>{option.label}</option>)}
              </select>
            </label>
          </div>
          {remoteBinding
            ? <PrecisionCadAgentControllerMount key={controllerKey} binding={remoteBinding} projectRoot={projectRoot ?? undefined} provider={provider} model={model} lang={lang} />
            : localReady
              ? <PrecisionCadAgentControllerMount key={controllerKey} projectRoot={projectRoot ?? undefined} provider={provider} model={model} lang={lang} />
              : <Notice
                  lang={lang}
                  message={bindingState === 'loading'
                    ? copy.loading
                    : bindingState === 'missing'
                      ? copy.revisionMissing
                      : bindingState === 'failed'
                        ? copy.loadFailed
                        : copy.saveFirst}
                />}
        </div>
      )}
    </div>
  );
}

const styles = {
  dock: { position: 'fixed' as const, insetInlineEnd: 16, insetBlockEnd: 78, zIndex: 980, display: 'grid', justifyItems: 'end', gap: 8 },
  launcher: { padding: '10px 14px', border: '1px solid #388bfd', borderRadius: 9, background: '#1f6feb', color: '#fff', fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 24px rgba(0,0,0,.3)' },
  popover: { inlineSize: 'min(720px, calc(100vw - 32px))', maxBlockSize: 'min(760px, calc(100vh - 150px))', overflow: 'auto', padding: 10, border: '1px solid var(--nx-border, #30363d)', borderRadius: 14, background: 'var(--nx-bg, #0d1117)', boxShadow: '0 18px 50px rgba(0,0,0,.45)' },
  settings: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, padding: '4px 4px 10px' },
  settingLabel: { display: 'grid', gap: 4, minInlineSize: 180, color: 'var(--nx-text-2, #8b949e)', fontSize: 12, fontWeight: 700 },
  select: { padding: '7px 9px', border: '1px solid var(--nx-border, #30363d)', borderRadius: 7, background: 'var(--nx-panel, #161b22)', color: 'var(--nx-text, #e6edf3)' },
  workspace: {
    inlineSize: '100%',
  },
  notice: {
    display: 'grid',
    gap: 6,
    inlineSize: 'min(100%, 720px)',
    boxSizing: 'border-box' as const,
    marginBlock: 12,
    marginInline: 'auto',
    padding: 14,
    border: '1px solid var(--nx-border, #30363d)',
    borderRadius: 12,
    background: 'var(--nx-panel, #161b22)',
    color: 'var(--nx-text, #e6edf3)',
    fontSize: 13,
    lineHeight: 1.5,
  },
};
