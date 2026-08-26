'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

export type ChatShareCadResult = {
  composeIntent?: unknown;
  isAssembly?: boolean;
  assembly?: unknown;
  scad?: string;
  gateErrors?: string[];
};

type ShareLang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
type ArtifactKind = 'ga' | 'step' | 'package' | 'source';
type ArtifactSpec = {
  kind: ArtifactKind;
  name: string;
  description: string;
  enabled: boolean;
};
type ArtifactReceipt = {
  revisionId?: string;
  sha256?: string;
  manifestSha256?: string;
  reviewRequired: boolean;
};
type CreatedArtifact = { file: File; receipt: ArtifactReceipt };

type ShareCopy = {
  title: string;
  privacy: string;
  ga: string;
  step: string;
  package: string;
  source: string;
  defaultLabel: string;
  ready: string;
  waiting: string;
  unavailable: string;
  open: string;
  share: string;
  download: string;
  working: string;
  opened: string;
  shared: string;
  downloaded: string;
  shareFallback: string;
  popupBlocked: string;
  failed: string;
  generated: string;
  reviewRequired: string;
  gatePass: string;
  gateBlock: string;
  gateNotRun: string;
};

export const RESULT_SHARE_COPY: Record<ShareLang, ShareCopy> = {
  kr: {
    title: '결과물 공유', privacy: '파일 자체를 공유하며 공개 링크를 만들지 않습니다.',
    ga: '브라우저에서 바로 확인하는 자립형 3D 결과물', step: '정밀 CAD에서 여는 B-rep 교환 파일',
    package: '도면·검토서·CAD 원본을 묶은 전체 패키지', source: '수정 가능한 OpenSCAD 원본', defaultLabel: '기본',
    ready: '준비됨', waiting: '설계 결과 대기', unavailable: '이 결과 유형에서는 제공되지 않음',
    open: '열기', share: '공유', download: '받기', working: '생성 중…', opened: '새 창에서 열었습니다.',
    shared: '공유했습니다.', downloaded: '다운로드했습니다.',
    shareFallback: '이 기기는 파일 공유를 지원하지 않아 다운로드했습니다.',
    popupBlocked: '팝업이 차단되었습니다. 받기를 이용해 주세요.', failed: '결과물을 만들지 못했습니다.',
    generated: '생성됨', reviewRequired: '제조 전 검토 필요', gatePass: '생성 검사 통과',
    gateBlock: '생성 검사 수정 필요', gateNotRun: '생성 검사 미실행',
  },
  en: {
    title: 'Share results', privacy: 'Shares the file itself without creating a public link.',
    ga: 'Self-contained 3D result that opens in a browser', step: 'B-rep exchange file for precision CAD',
    package: 'Complete package with drawings, reviews, and CAD sources', source: 'Editable OpenSCAD source', defaultLabel: 'Default',
    ready: 'Ready', waiting: 'Waiting for a design result', unavailable: 'Not available for this result type',
    open: 'Open', share: 'Share', download: 'Download', working: 'Generating…', opened: 'Opened in a new window.',
    shared: 'Shared.', downloaded: 'Downloaded.', shareFallback: 'File sharing is unavailable on this device, so the file was downloaded.',
    popupBlocked: 'The popup was blocked. Use Download instead.', failed: 'Could not create the result file.',
    generated: 'Generated', reviewRequired: 'Review required before manufacturing', gatePass: 'Generation check passed',
    gateBlock: 'Generation check needs correction', gateNotRun: 'Generation check not run',
  },
  ja: {
    title: '結果を共有', privacy: '公開リンクを作らず、ファイル自体を共有します。',
    ga: 'ブラウザーですぐ確認できる自己完結型3D結果', step: '精密CADで開くB-rep交換ファイル',
    package: '図面・検討書・CADソースをまとめた全体パッケージ', source: '編集可能なOpenSCADソース', defaultLabel: '既定',
    ready: '準備完了', waiting: '設計結果を待機中', unavailable: 'この結果形式では利用できません',
    open: '開く', share: '共有', download: '保存', working: '生成中…', opened: '新しいウィンドウで開きました。',
    shared: '共有しました。', downloaded: 'ダウンロードしました。',
    shareFallback: 'この端末はファイル共有に未対応のため、ダウンロードしました。',
    popupBlocked: 'ポップアップがブロックされました。「保存」を使用してください。', failed: '結果ファイルを作成できませんでした。',
    generated: '生成済み', reviewRequired: '製造前の確認が必要', gatePass: '生成チェック合格',
    gateBlock: '生成チェックの修正が必要', gateNotRun: '生成チェック未実行',
  },
  cn: {
    title: '分享结果', privacy: '直接分享文件，不创建公开链接。',
    ga: '可在浏览器直接查看的独立3D结果', step: '用于精密CAD的B-rep交换文件',
    package: '包含图纸、审查报告和CAD源文件的完整包', source: '可编辑的OpenSCAD源文件', defaultLabel: '默认',
    ready: '已就绪', waiting: '等待设计结果', unavailable: '此结果类型不提供',
    open: '打开', share: '分享', download: '下载', working: '正在生成…', opened: '已在新窗口中打开。',
    shared: '已分享。', downloaded: '已下载。', shareFallback: '此设备不支持文件分享，已改为下载。',
    popupBlocked: '弹出窗口被拦截，请使用“下载”。', failed: '无法创建结果文件。',
    generated: '已生成', reviewRequired: '制造前需要审核', gatePass: '生成检查通过',
    gateBlock: '生成检查需要修正', gateNotRun: '生成检查未执行',
  },
  es: {
    title: 'Compartir resultados', privacy: 'Comparte el archivo sin crear un enlace público.',
    ga: 'Resultado 3D autónomo que se abre en el navegador', step: 'Archivo de intercambio B-rep para CAD de precisión',
    package: 'Paquete completo con planos, revisiones y fuentes CAD', source: 'Fuente OpenSCAD editable', defaultLabel: 'Predeterminado',
    ready: 'Listo', waiting: 'Esperando un resultado de diseño', unavailable: 'No disponible para este tipo de resultado',
    open: 'Abrir', share: 'Compartir', download: 'Descargar', working: 'Generando…', opened: 'Abierto en una ventana nueva.',
    shared: 'Compartido.', downloaded: 'Descargado.', shareFallback: 'Este dispositivo no permite compartir archivos; se descargó el archivo.',
    popupBlocked: 'Se bloqueó la ventana emergente. Usa Descargar.', failed: 'No se pudo crear el archivo de resultado.',
    generated: 'Generado', reviewRequired: 'Revisión necesaria antes de fabricar', gatePass: 'Comprobación de generación aprobada',
    gateBlock: 'La generación necesita corrección', gateNotRun: 'Comprobación de generación no ejecutada',
  },
  ar: {
    title: 'مشاركة النتائج', privacy: 'تتم مشاركة الملف نفسه من دون إنشاء رابط عام.',
    ga: 'نتيجة ثلاثية الأبعاد مستقلة تُفتح مباشرة في المتصفح', step: 'ملف تبادل B-rep لبرامج CAD الدقيقة',
    package: 'حزمة كاملة تضم الرسومات والمراجعات ومصادر CAD', source: 'مصدر OpenSCAD قابل للتعديل', defaultLabel: 'افتراضي',
    ready: 'جاهز', waiting: 'بانتظار نتيجة التصميم', unavailable: 'غير متاح لهذا النوع من النتائج',
    open: 'فتح', share: 'مشاركة', download: 'تنزيل', working: 'جارٍ الإنشاء…', opened: 'تم الفتح في نافذة جديدة.',
    shared: 'تمت المشاركة.', downloaded: 'تم التنزيل.', shareFallback: 'هذا الجهاز لا يدعم مشاركة الملفات، لذلك تم تنزيل الملف.',
    popupBlocked: 'تم حظر النافذة المنبثقة. استخدم التنزيل.', failed: 'تعذر إنشاء ملف النتيجة.',
    generated: 'تم الإنشاء', reviewRequired: 'يلزم التحقق قبل التصنيع', gatePass: 'نجح فحص التوليد',
    gateBlock: 'يحتاج فحص التوليد إلى تصحيح', gateNotRun: 'لم يُنفذ فحص التوليد',
  },
};

function toShareLang(langCode: string): ShareLang {
  const code = langCode.toLowerCase();
  if (code === 'ko' || code === 'kr') return 'kr';
  if (code === 'ja' || code === 'jp') return 'ja';
  if (code === 'zh' || code === 'cn') return 'cn';
  if (code === 'es') return 'es';
  if (code === 'ar') return 'ar';
  return 'en';
}

export function describeChatResultArtifacts(cad: ChatShareCadResult | null, langCode: string): ArtifactSpec[] {
  const lang = toShareLang(langCode);
  const copy = RESULT_SHARE_COPY[lang];
  const canRenderGa = Boolean(cad?.assembly || cad?.composeIntent);
  const isAssembly = Boolean(cad?.isAssembly && cad.assembly);
  return [
    { kind: 'ga', name: 'GA_3D.html', description: copy.ga, enabled: canRenderGa },
    { kind: 'step', name: 'model.step', description: copy.step, enabled: Boolean(cad?.composeIntent) },
    isAssembly
      ? { kind: 'package', name: `design_package_${lang}.zip`, description: copy.package, enabled: true }
      : { kind: 'source', name: 'model.scad', description: copy.source, enabled: Boolean(cad?.scad) },
  ];
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_500);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

const validSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
const optionalString = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

async function sha256File(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle || typeof file.arrayBuffer !== 'function') return undefined;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function receiptFor(file: File, data: Record<string, unknown> = {}, artifactShaKey?: string): Promise<ArtifactReceipt> {
  const serverArtifactSha = artifactShaKey && validSha256(data[artifactShaKey]) ? data[artifactShaKey] as string : undefined;
  return {
    revisionId: optionalString(data.revisionId) ?? optionalString(data.rev),
    sha256: serverArtifactSha ?? await sha256File(file),
    manifestSha256: validSha256(data.artifactManifestSha256) ? data.artifactManifestSha256 : undefined,
    // Artifact identity is not manufacturing approval. The governed routes
    // currently return false/review_required, while local sources have no
    // signed manufacturing receipt and therefore remain review-required too.
    reviewRequired: data.manufacturingAllowed !== true,
  };
}

async function createArtifactFile(kind: ArtifactKind, cad: ChatShareCadResult, lang: ShareLang): Promise<CreatedArtifact> {
  if (kind === 'source') {
    if (!cad.scad) throw new Error('source_unavailable');
    const file = new File([cad.scad], 'model.scad', { type: 'text/plain' });
    return { file, receipt: await receiptFor(file) };
  }

  if (kind === 'ga') {
    const body = cad.assembly ? { assembly: cad.assembly } : { intent: cad.composeIntent };
    const response = await fetch('/api/nexyfab/drawing/render-html/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await readJson(response);
    if (!response.ok || data.ok !== true || typeof data.html !== 'string') throw new Error(String(data.error ?? 'ga_failed'));
    const file = new File([data.html], 'GA_3D.html', { type: 'text/html' });
    return { file, receipt: await receiptFor(file, data, 'artifactSha256') };
  }

  if (kind === 'step') {
    if (!cad.composeIntent) throw new Error('step_unavailable');
    const response = await fetch('/api/nexyfab/drawing/export-step/', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ intent: cad.composeIntent }),
    });
    const data = await readJson(response);
    if (!response.ok || data.ok !== true || typeof data.step !== 'string') throw new Error(String(data.error ?? 'step_failed'));
    const file = new File([data.step], 'model.step', { type: 'application/step' });
    return { file, receipt: await receiptFor(file, data, 'stepSha256') };
  }

  if (!cad.assembly) throw new Error('package_unavailable');
  const response = await fetch('/api/nexyfab/drawing/package/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assembly: cad.assembly, options: { lang, member: { section: 'SHS50x50x3', spanMm: 1000 } } }),
  });
  const data = await readJson(response);
  if (!response.ok || data.ok !== true) throw new Error(String(data.error ?? 'package_failed'));
  if (typeof data.zipBase64 === 'string') {
    const bytes = Uint8Array.from(atob(data.zipBase64), (char) => char.charCodeAt(0));
    const file = new File([bytes.buffer], `design_package_${lang}.zip`, { type: 'application/zip' });
    return { file, receipt: await receiptFor(file, data) };
  }
  if (Array.isArray(data.files)) {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const item of data.files as Array<{ name?: unknown; content?: unknown; b64?: unknown }>) {
      if (typeof item.name === 'string' && typeof item.content === 'string') zip.file(item.name, item.content, { base64: item.b64 === true });
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const file = new File([blob], `design_package_${lang}.zip`, { type: 'application/zip' });
    return { file, receipt: await receiptFor(file, data) };
  }
  throw new Error('package_empty');
}

function generationGateLabel(cad: ChatShareCadResult | null, copy: ShareCopy): string | null {
  if (!cad) return null;
  if (!Array.isArray(cad.gateErrors)) return copy.gateNotRun;
  return cad.gateErrors.length === 0 ? copy.gatePass : copy.gateBlock;
}

function receiptLabel(receipt: ArtifactReceipt, copy: ShareCopy): string {
  const parts = [copy.generated];
  if (receipt.revisionId) parts.push(`REV ${receipt.revisionId}`);
  if (receipt.sha256) parts.push(`SHA-256 ${receipt.sha256.slice(0, 12)}…`);
  if (receipt.manifestSha256) parts.push(`MANIFEST ${receipt.manifestSha256.slice(0, 12)}…`);
  if (receipt.reviewRequired) parts.push(copy.reviewRequired);
  return parts.join(' · ');
}

function receiptTitle(receipt: ArtifactReceipt): string {
  return [
    receipt.revisionId ? `REV ${receipt.revisionId}` : null,
    receipt.sha256 ? `SHA-256 ${receipt.sha256}` : null,
    receipt.manifestSha256 ? `MANIFEST SHA-256 ${receipt.manifestSha256}` : null,
  ].filter(Boolean).join('\n');
}

export function ChatResultShareTray({ cad, langCode, accent }: { cad: ChatShareCadResult | null; langCode: string; accent: string }) {
  const lang = toShareLang(langCode);
  const copy = RESULT_SHARE_COPY[lang];
  const rows = useMemo(() => describeChatResultArtifacts(cad, lang), [cad, lang]);
  const cacheRef = useRef(new Map<ArtifactKind, Promise<CreatedArtifact>>());
  const [busy, setBusy] = useState<ArtifactKind | null>(null);
  const [notice, setNotice] = useState<{ kind: ArtifactKind; text: string; error?: boolean } | null>(null);
  const [receipts, setReceipts] = useState<Partial<Record<ArtifactKind, ArtifactReceipt>>>({});

  useEffect(() => {
    cacheRef.current.clear();
    setNotice(null);
    setReceipts({});
  }, [cad]);

  const getFile = (kind: ArtifactKind): Promise<CreatedArtifact> => {
    if (!cad) return Promise.reject(new Error('result_unavailable'));
    const cached = cacheRef.current.get(kind);
    if (cached) return cached;
    const promise = createArtifactFile(kind, cad, lang).catch((error) => {
      cacheRef.current.delete(kind);
      throw error;
    });
    cacheRef.current.set(kind, promise);
    return promise;
  };

  const run = async (kind: ArtifactKind, action: 'open' | 'share' | 'download') => {
    if (busy) return;
    let popup: Window | null = null;
    if (action === 'open') {
      popup = window.open('about:blank', '_blank');
      if (popup) popup.opener = null;
    }
    setBusy(kind);
    setNotice(null);
    try {
      const { file, receipt } = await getFile(kind);
      setReceipts((current) => ({ ...current, [kind]: receipt }));
      if (action === 'open') {
        if (!popup) {
          setNotice({ kind, text: copy.popupBlocked, error: true });
          return;
        }
        const url = URL.createObjectURL(file);
        popup.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setNotice({ kind, text: copy.opened });
      } else if (action === 'download') {
        downloadFile(file);
        setNotice({ kind, text: copy.downloaded });
      } else {
        const shareData: ShareData = { title: file.name, files: [file] };
        const canShare = typeof navigator.share === 'function'
          && (typeof navigator.canShare !== 'function' || navigator.canShare(shareData));
        if (canShare) {
          try {
            await navigator.share(shareData);
            setNotice({ kind, text: copy.shared });
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            throw error;
          }
        } else {
          downloadFile(file);
          setNotice({ kind, text: copy.shareFallback });
        }
      }
    } catch {
      popup?.close();
      setNotice({ kind, text: copy.failed, error: true });
    } finally {
      setBusy(null);
    }
  };

  const actionStyle: CSSProperties = {
    padding: '4px 9px', borderRadius: 8, border: '1px solid rgba(148,163,184,0.28)',
    background: 'rgba(255,255,255,0.04)', color: '#cbd5e1', fontSize: 10.5, fontWeight: 750, cursor: 'pointer',
  };

  return (
    <section data-testid="chat-result-share-tray" aria-label={copy.title} style={{
      flexShrink: 0, marginTop: 9, padding: '7px 10px', borderRadius: 13,
      border: '1px solid rgba(148,163,184,0.2)', background: 'rgba(8,15,31,0.72)', textAlign: 'start',
    }}>
      <style>{`
        .nf-share-row { grid-template-columns: minmax(116px, .9fr) minmax(155px, 1.45fr) auto; }
        @media (max-width: 620px) {
          .nf-share-privacy { display: none; }
          .nf-share-row { grid-template-columns: minmax(0, 1fr) auto; }
          .nf-share-detail { grid-column: 1 / -1; grid-row: 2; }
          .nf-share-name { grid-column: 1; grid-row: 1; }
          .nf-share-actions { grid-column: 2; grid-row: 1; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '1px 4px 6px' }}>
        <strong style={{ color: '#e2e8f0', fontSize: 11.5 }}>↗ {copy.title}</strong>
        <span className="nf-share-privacy" style={{ color: '#64748b', fontSize: 9.5 }}>{copy.privacy}</span>
      </div>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map((row) => {
          const isBusy = busy === row.kind;
          const state = cad ? (row.enabled ? copy.ready : copy.unavailable) : copy.waiting;
          const gate = row.enabled ? generationGateLabel(cad, copy) : null;
          const receipt = receipts[row.kind];
          return (
            <div key={row.kind} data-testid={`share-artifact-${row.kind}`} className="nf-share-row" style={{
              minHeight: 40, display: 'grid',
              alignItems: 'center', gap: 8, padding: '5px 7px', borderRadius: 9,
              background: row.kind === 'ga' ? `${accent}12` : 'rgba(255,255,255,0.025)',
              border: row.kind === 'ga' ? `1px solid ${accent}35` : '1px solid transparent',
              opacity: cad && !row.enabled ? 0.55 : 1,
            }}>
              <div className="nf-share-name" style={{ minWidth: 0 }}>
                <code style={{ color: row.kind === 'ga' ? '#bfdbfe' : '#e2e8f0', fontSize: 11, fontWeight: 800 }}>{row.name}</code>
                {row.kind === 'ga' && <span style={{ marginInlineStart: 6, padding: '1px 5px', borderRadius: 999, background: `${accent}30`, color: '#bfdbfe', fontSize: 8.5, fontWeight: 900 }}>{copy.defaultLabel}</span>}
              </div>
              <div className="nf-share-detail" style={{ minWidth: 0 }}>
                <div style={{ color: '#94a3b8', fontSize: 9.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.description}</div>
                <div role="status" style={{ color: notice?.kind === row.kind ? (notice.error ? '#fca5a5' : '#86efac') : (row.enabled ? '#64748b' : '#6b7280'), fontSize: 9.5 }}>
                  {isBusy ? copy.working : notice?.kind === row.kind ? notice.text : `${state}${gate ? ` · ${gate}` : ''}`}
                </div>
                {receipt && (
                  <div data-testid={`artifact-receipt-${row.kind}`} title={receiptTitle(receipt)} style={{
                    marginTop: 1, color: '#7dd3fc', fontSize: 9, lineHeight: 1.35,
                    fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere',
                  }}>
                    {receiptLabel(receipt, copy)}
                  </div>
                )}
              </div>
              <div className="nf-share-actions" style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {row.kind === 'ga' && (
                  <button type="button" onClick={() => { void run(row.kind, 'open'); }} disabled={!row.enabled || busy !== null} style={{ ...actionStyle, opacity: row.enabled && busy === null ? 1 : 0.4 }}>{copy.open}</button>
                )}
                <button type="button" onClick={() => { void run(row.kind, 'share'); }} disabled={!row.enabled || busy !== null} style={{ ...actionStyle, borderColor: row.enabled ? `${accent}55` : 'rgba(148,163,184,0.28)', opacity: row.enabled && busy === null ? 1 : 0.4 }}>{copy.share}</button>
                <button type="button" onClick={() => { void run(row.kind, 'download'); }} disabled={!row.enabled || busy !== null} style={{ ...actionStyle, opacity: row.enabled && busy === null ? 1 : 0.4 }}>{copy.download}</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
