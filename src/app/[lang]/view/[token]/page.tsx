'use client';

import Link from 'next/link';
import { use, useEffect, useRef, useState, useCallback } from 'react';
import { toIsoLang, toRouteLang, type IsoLang } from '@/lib/i18n/normalize';
import { formatDate, formatNumber } from '@/lib/i18n/format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Annotation {
  id: string;
  authorName: string;
  authorRole: string;
  position: { x: number; y: number; z: number };
  text: string;
  color: string;
  resolved: boolean;
  createdAt: string;
}

interface ShareMetadata {
  name: string;
  material?: string;
  bbox?: { w: number; h: number; d: number };
  watermark?: string;
  allowDownload?: boolean;
}

interface ShareVersion {
  token: string;
  version: number;
  createdAt: number;
}

interface ShareData {
  meshDataBase64: string;
  metadata: ShareMetadata;
  expiresAt: number;
  viewCount: number;
  version: number;
  versions: ShareVersion[];
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

type ViewCopy = {
  loading: string; annotationAdded: string; addFailed: string; networkError: string;
  extended: string; extendFailed: string; expiredTitle: string; checkLink: string;
  openNexyfab: string; sharedModel: string; expires: string; extendTitle: string;
  extend: string; annotationPlaceholder: string; color: string; add: string; cancel: string;
  clickPin: string; addNote: string; material: string; annotations: string; open: string;
  noAnnotations: string; useAddNote: string; markOpen: string; markResolved: string;
  reopen: string; resolved: string; loginPro: string;
};

const VIEW_COPY: Record<IsoLang, ViewCopy> = {
  ko: { loading: '로드 중...', annotationAdded: '주석이 추가되었습니다!', addFailed: '추가 실패', networkError: '네트워크 오류', extended: '1년 연장되었습니다!', extendFailed: '연장 실패 (소유자만 가능)', expiredTitle: '링크가 만료되었거나 존재하지 않습니다', checkLink: '공유 링크를 다시 확인해 주세요.', openNexyfab: 'NexyFab으로 이동 →', sharedModel: '공유된 3D 모델', expires: '만료', extendTitle: '공유 링크 1년 연장', extend: '+ 연장', annotationPlaceholder: '주석 내용 입력...', color: '색상', add: '추가', cancel: '취소', clickPin: '클릭하여 핀 추가', addNote: '주석 추가', material: '재료', annotations: '3D 주석', open: '미해결', noAnnotations: '아직 주석이 없습니다.', useAddNote: '왼쪽 "주석 추가" 버튼을 눌러 추가하세요.', markOpen: '미해결로 변경', markResolved: '해결됨으로 표시', reopen: '재오픈', resolved: '해결됨', loginPro: 'Pro 로그인하면 주석을 추가할 수 있습니다 →' },
  en: { loading: 'Loading...', annotationAdded: 'Annotation added!', addFailed: 'Failed to add', networkError: 'Network error', extended: 'Extended by 1 year!', extendFailed: 'Failed — owner only', expiredTitle: 'Link expired or not found', checkLink: 'Please check the share link.', openNexyfab: 'Open NexyFab →', sharedModel: 'Shared 3D Model', expires: 'Expires', extendTitle: 'Extend link by 1 year', extend: '+ Extend', annotationPlaceholder: 'Enter annotation text...', color: 'Color', add: 'Add', cancel: 'Cancel', clickPin: 'Click to place pin', addNote: 'Add note', material: 'Material', annotations: '3D Annotations', open: 'open', noAnnotations: 'No annotations yet.', useAddNote: 'Use "Add note" to place one.', markOpen: 'Mark open', markResolved: 'Mark resolved', reopen: 'Reopen', resolved: 'Resolved', loginPro: 'Log in with Pro to add annotations →' },
  ja: { loading: '読み込み中...', annotationAdded: '注釈を追加しました！', addFailed: '追加に失敗しました', networkError: 'ネットワークエラー', extended: '1年延長しました！', extendFailed: '延長に失敗しました（所有者のみ）', expiredTitle: 'リンクの有効期限が切れているか、存在しません', checkLink: '共有リンクを確認してください。', openNexyfab: 'NexyFabを開く →', sharedModel: '共有3Dモデル', expires: '期限', extendTitle: 'リンクを1年間延長', extend: '+ 延長', annotationPlaceholder: '注釈を入力...', color: '色', add: '追加', cancel: 'キャンセル', clickPin: 'クリックしてピンを配置', addNote: '注釈を追加', material: '素材', annotations: '3D注釈', open: '未解決', noAnnotations: '注釈はまだありません。', useAddNote: '左の「注釈を追加」ボタンから追加できます。', markOpen: '未解決に戻す', markResolved: '解決済みにする', reopen: '再開', resolved: '解決済み', loginPro: 'Proにログインすると注釈を追加できます →' },
  zh: { loading: '加载中...', annotationAdded: '注释已添加！', addFailed: '添加失败', networkError: '网络错误', extended: '已延长一年！', extendFailed: '延长失败（仅所有者可操作）', expiredTitle: '链接已过期或不存在', checkLink: '请检查共享链接。', openNexyfab: '打开 NexyFab →', sharedModel: '共享 3D 模型', expires: '到期', extendTitle: '将链接延长一年', extend: '+ 延长', annotationPlaceholder: '输入注释内容...', color: '颜色', add: '添加', cancel: '取消', clickPin: '点击放置标记', addNote: '添加注释', material: '材料', annotations: '3D 注释', open: '未解决', noAnnotations: '暂无注释。', useAddNote: '使用左侧“添加注释”按钮。', markOpen: '标记为未解决', markResolved: '标记为已解决', reopen: '重新打开', resolved: '已解决', loginPro: '登录 Pro 后即可添加注释 →' },
  es: { loading: 'Cargando...', annotationAdded: '¡Anotación añadida!', addFailed: 'No se pudo añadir', networkError: 'Error de red', extended: '¡Ampliado un año!', extendFailed: 'No se pudo ampliar (solo el propietario)', expiredTitle: 'El enlace ha caducado o no existe', checkLink: 'Comprueba el enlace compartido.', openNexyfab: 'Abrir NexyFab →', sharedModel: 'Modelo 3D compartido', expires: 'Caduca', extendTitle: 'Ampliar el enlace un año', extend: '+ Ampliar', annotationPlaceholder: 'Escribe una anotación...', color: 'Color', add: 'Añadir', cancel: 'Cancelar', clickPin: 'Haz clic para colocar un pin', addNote: 'Añadir nota', material: 'Material', annotations: 'Anotaciones 3D', open: 'abiertas', noAnnotations: 'Aún no hay anotaciones.', useAddNote: 'Usa «Añadir nota» para colocar una.', markOpen: 'Marcar como abierta', markResolved: 'Marcar como resuelta', reopen: 'Reabrir', resolved: 'Resuelta', loginPro: 'Inicia sesión con Pro para añadir anotaciones →' },
  ar: { loading: 'جارٍ التحميل...', annotationAdded: 'تمت إضافة التعليق!', addFailed: 'تعذرت الإضافة', networkError: 'خطأ في الشبكة', extended: 'تم التمديد سنة واحدة!', extendFailed: 'تعذر التمديد — للمالك فقط', expiredTitle: 'انتهت صلاحية الرابط أو أنه غير موجود', checkLink: 'يرجى التحقق من الرابط المشترك.', openNexyfab: 'فتح NexyFab ←', sharedModel: 'نموذج ثلاثي الأبعاد مشترك', expires: 'ينتهي', extendTitle: 'تمديد الرابط سنة واحدة', extend: '+ تمديد', annotationPlaceholder: 'أدخل نص التعليق...', color: 'اللون', add: 'إضافة', cancel: 'إلغاء', clickPin: 'انقر لوضع دبوس', addNote: 'إضافة تعليق', material: 'المادة', annotations: 'تعليقات ثلاثية الأبعاد', open: 'مفتوح', noAnnotations: 'لا توجد تعليقات بعد.', useAddNote: 'استخدم زر «إضافة تعليق» لوضع تعليق.', markOpen: 'وضع علامة مفتوح', markResolved: 'وضع علامة محلول', reopen: 'إعادة فتح', resolved: 'محلول', loginPro: 'سجّل الدخول بحساب Pro لإضافة التعليقات ←' },
};

function Spinner({ lang }: { lang: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0d1117', color: '#8b949e', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 48, height: 48, border: '3px solid #30363d',
          borderTopColor: '#388bfd', borderRadius: '50%',
          animation: 'spin 0.9s linear infinite', margin: '0 auto 16px',
        }} />
        <p style={{ color: '#6e7681', fontSize: 14, margin: 0 }}>{VIEW_COPY[toIsoLang(lang)].loading}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ViewTokenPage({ params }: { params: Promise<{ lang: string; token: string }> }) {
  const { lang, token } = use(params);
  const routeLang = toRouteLang(lang);
  const t = VIEW_COPY[toIsoLang(routeLang)];

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const cameraRef = useRef<import('three').PerspectiveCamera | null>(null);
  const meshRef = useRef<import('three').Mesh | null>(null);

  const [shareData, setShareData] = useState<ShareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth (read NexyFab auth token from localStorage if present)
  const [authToken, setAuthToken] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const t = localStorage.getItem('nf_auth_token') ?? localStorage.getItem('nf-auth-token');
      setAuthToken(t);
    }
  }, []);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annPanelOpen, setAnnPanelOpen] = useState(false);
  const [hoveredAnnId, setHoveredAnnId] = useState<string | null>(null);

  // Add annotation form state
  const [addMode, setAddMode] = useState(false);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number; z: number } | null>(null);
  const [pendingScreenPos, setPendingScreenPos] = useState<{ sx: number; sy: number } | null>(null);
  const [annText, setAnnText] = useState('');
  const [annColor, setAnnColor] = useState('#f59e0b');
  const [annSubmitting, setAnnSubmitting] = useState(false);
  const [annMsg, setAnnMsg] = useState<string | null>(null);

  // Share extend state
  const [extending, setExtending] = useState(false);
  const [extendMsg, setExtendMsg] = useState<string | null>(null);

  // Fetch share data
  useEffect(() => {
    fetch(`/api/nexyfab/share?token=${token}`)
      .then(async r => {
        const d = await r.json() as ShareData & { error?: string };
        if (d.error) throw new Error(d.error);
        setShareData(d);
      })
      .catch(e => setError((e as Error).message ?? 'Network error'))
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch annotations
  const reloadAnnotations = useCallback(() => {
    fetch(`/api/nexyfab/annotations?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { annotations?: Annotation[] } | null) => {
        if (d?.annotations) setAnnotations(d.annotations);
      })
      .catch(() => {/* annotations are optional */});
  }, [token]);

  useEffect(() => { reloadAnnotations(); }, [reloadAnnotations]);

  // THREE.js canvas setup
  const setupScene = useCallback(async (canvas: HTMLCanvasElement, data: ShareData) => {
    const THREE = await import('three');

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setClearColor(0x0d1117);

    const scene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
    dirLight.position.set(50, 80, 60);
    scene.add(dirLight);

    const { bufferGeometryFromShareMeshBase64 } = await import('@/lib/nexyfab/shareMeshFromBase64');
    const decoded = bufferGeometryFromShareMeshBase64(data.meshDataBase64);
    const geometry: import('three').BufferGeometry = decoded ?? new THREE.BoxGeometry(60, 60, 60);

    const material = new THREE.MeshStandardMaterial({ color: 0x8b9cf4, roughness: 0.3, metalness: 0.45 });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    const bbox = data.metadata.bbox;
    const maxDim = bbox ? Math.max(bbox.w, bbox.h, bbox.d) : 100;
    const camDist = maxDim > 0 ? maxDim * 2.2 : 300;
    const camera = new THREE.PerspectiveCamera(42, canvas.clientWidth / canvas.clientHeight, 0.1, camDist * 20);
    camera.position.set(camDist, camDist * 0.7, camDist);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const onResize = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      mesh.rotation.y += 0.005;
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, []);

  useEffect(() => {
    if (!shareData || !canvasRef.current) return;
    let cleanup: (() => void) | undefined;
    setupScene(canvasRef.current, shareData).then(fn => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, [shareData, setupScene]);

  // Draw annotation pins on overlay canvas
  useEffect(() => {
    if (!annotations.length || !overlayCanvasRef.current) return;
    const oc = overlayCanvasRef.current;
    let rafId: number;

    async function drawPins() {
      const THREE = await import('three');
      const ctx = oc.getContext('2d');
      function frame() {
        rafId = requestAnimationFrame(frame);
        if (!ctx || !cameraRef.current) return;
        oc.width = oc.clientWidth;
        oc.height = oc.clientHeight;
        ctx.clearRect(0, 0, oc.width, oc.height);
        const w = oc.width, h = oc.height;
        annotations.forEach(ann => {
          const v = new THREE.Vector3(ann.position.x, ann.position.y, ann.position.z);
          v.project(cameraRef.current!);
          if (v.z >= 1) return;
          const sx = (v.x * 0.5 + 0.5) * w;
          const sy = (-v.y * 0.5 + 0.5) * h;
          const color = ann.resolved ? '#8b949e' : (ann.color ?? '#f59e0b');
          ctx.beginPath();
          ctx.arc(sx, sy, 9, 0, Math.PI * 2);
          ctx.fillStyle = color + 'cc';
          ctx.fill();
          ctx.strokeStyle = ann.id === hoveredAnnId ? '#ffffff' : color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        });
      }
      frame();
    }
    void drawPins();
    return () => cancelAnimationFrame(rafId);
  }, [annotations, hoveredAnnId]);

  // Canvas click → raycast for annotation placement
  const handleCanvasClick = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!addMode || !canvasRef.current || !cameraRef.current || !meshRef.current) return;
    const THREE = await import('three');
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), cameraRef.current);
    const hits = raycaster.intersectObject(meshRef.current, false);

    let pos: { x: number; y: number; z: number };
    if (hits.length > 0) {
      const p = hits[0].point;
      pos = { x: parseFloat(p.x.toFixed(3)), y: parseFloat(p.y.toFixed(3)), z: parseFloat(p.z.toFixed(3)) };
    } else {
      pos = { x: 0, y: 0, z: 0 };
    }
    setPendingPos(pos);
    setPendingScreenPos({ sx: e.clientX - rect.left, sy: e.clientY - rect.top });
  }, [addMode]);

  // Submit annotation
  const submitAnnotation = useCallback(async () => {
    if (!pendingPos || !annText.trim() || !authToken) return;
    setAnnSubmitting(true);
    setAnnMsg(null);
    try {
      const res = await fetch('/api/nexyfab/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          shareToken: token,
          x: pendingPos.x, y: pendingPos.y, z: pendingPos.z,
          text: annText.trim(),
          color: annColor,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnnText('');
        setPendingPos(null);
        setPendingScreenPos(null);
        setAddMode(false);
        reloadAnnotations();
        setAnnMsg(t.annotationAdded);
        setTimeout(() => setAnnMsg(null), 3000);
      } else {
        setAnnMsg(data.error ?? t.addFailed);
      }
    } catch {
      setAnnMsg(t.networkError);
    } finally {
      setAnnSubmitting(false);
    }
  }, [pendingPos, annText, annColor, authToken, token, reloadAnnotations, t]);

  // Toggle resolved
  const toggleResolved = useCallback(async (ann: Annotation) => {
    if (!authToken) return;
    const optimistic = annotations.map(a => a.id === ann.id ? { ...a, resolved: !a.resolved } : a);
    setAnnotations(optimistic);
    try {
      await fetch('/api/nexyfab/annotations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ id: ann.id, resolved: !ann.resolved }),
      });
    } catch { /* optimistic UI — ignore */ }
  }, [authToken, annotations]);

  // Extend share link
  const extendShare = useCallback(async () => {
    if (!authToken) return;
    setExtending(true);
    setExtendMsg(null);
    try {
      const res = await fetch('/api/nexyfab/share/extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ token, expiresInDays: 365 }),
      });
      const data = await res.json() as { ok?: boolean; expiresAt?: string; error?: string };
      if (res.ok && data.ok) {
        const newExpiry = data.expiresAt ? new Date(data.expiresAt).getTime() : Date.now() + 365 * 86400000;
        setShareData(prev => prev ? { ...prev, expiresAt: newExpiry } : prev);
        setExtendMsg(t.extended);
      } else {
        setExtendMsg(data.error ?? t.extendFailed);
      }
    } catch {
      setExtendMsg(t.networkError);
    } finally {
      setExtending(false);
      setTimeout(() => setExtendMsg(null), 4000);
    }
  }, [authToken, token, t]);

  // ── Format helpers ────────────────────────────────────────────────────────
  function fmtDate(ts: number) {
    return formatDate(ts, routeLang, { year: 'numeric', month: 'short', day: 'numeric' }) ?? '';
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return <Spinner lang={routeLang} />;

  if (error || !shareData) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0d1117', color: '#e6edf3',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: '0 24px' }}>
          <div style={{ fontSize: 56, marginBottom: 20 }}>🔒</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, color: '#e6edf3' }}>
            {t.expiredTitle}
          </h2>
          <p style={{ color: '#8b949e', fontSize: 14, margin: '0 0 24px' }}>
            {error ?? t.checkLink}
          </p>
          <Link
            prefetch
            href={`/${lang}/shape-generator`}
            style={{
              display: 'inline-block', padding: '10px 22px', borderRadius: 8,
              background: '#388bfd', color: '#fff', fontWeight: 700,
              fontSize: 14, textDecoration: 'none',
            }}
          >
            {t.openNexyfab}
          </Link>
        </div>
      </div>
    );
  }

  const { metadata, expiresAt, viewCount, version, versions } = shareData;
  const multiVersion = versions.length > 1;
  const isExpiringSoon = expiresAt - Date.now() < 7 * 86_400_000;

  return (
    <div style={{
      minHeight: '100vh', background: '#0d1117', color: '#e6edf3',
      fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column',
    }}>
      {/* ── Header ── */}
      <header style={{
        borderBottom: '1px solid #30363d', padding: '12px 24px',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
        position: 'sticky', top: 0, background: '#0d1117', zIndex: 100,
      }}>
        <Link prefetch href={`/${lang}/shape-generator`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 0 }}>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#388bfd' }}>Nexy</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#3fb950' }}>Fab</span>
        </Link>
        <span style={{ color: '#30363d' }}>•</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3' }}>
          {metadata.name || t.sharedModel}
        </span>
        <span style={{
          fontSize: 11, padding: '2px 9px', borderRadius: 20,
          background: '#21262d', color: '#8b949e', border: '1px solid #30363d',
        }}>
          👁 {formatNumber(viewCount, routeLang) ?? viewCount}
        </span>

        <div style={{ flex: 1 }} />

        {/* Expiry with extend button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: isExpiringSoon ? '#d29922' : '#8b949e' }}>
            {isExpiringSoon ? '⚠️ ' : ''}{t.expires}: {fmtDate(expiresAt)}
          </span>
          {authToken && (
            <button
              onClick={() => void extendShare()}
              disabled={extending}
              title={t.extendTitle}
              style={{
                padding: '3px 9px', borderRadius: 5, border: '1px solid #30363d',
                background: 'transparent', color: '#6e7681', fontSize: 10, cursor: 'pointer',
                opacity: extending ? 0.6 : 1,
              }}
            >
              {extending ? '...' : t.extend}
            </button>
          )}
        </div>

        {extendMsg && (
          <span style={{
            fontSize: 11, padding: '3px 9px', borderRadius: 5,
            background: '#1a2e1a', border: '1px solid #3fb950', color: '#3fb950',
          }}>
            {extendMsg}
          </span>
        )}

        {/* Version chips */}
        {multiVersion && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {versions.map(v => (
              <a
                key={v.token}
                href={`/${lang}/view/${v.token}`}
                style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
                  background: v.version === version ? '#388bfd22' : '#21262d',
                  color: v.version === version ? '#388bfd' : '#8b949e',
                  border: `1px solid ${v.version === version ? '#388bfd66' : '#30363d'}`,
                  textDecoration: 'none', transition: 'all 0.15s',
                }}
              >
                v{v.version}
              </a>
            ))}
          </div>
        )}
      </header>

      {/* ── Canvas Area ── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 400 }}>
        <div
          onContextMenu={metadata.allowDownload === false ? e => e.preventDefault() : undefined}
          style={{ width: '100%', height: '100%', minHeight: 'calc(100vh - 53px)', position: 'relative' }}
        >
          <canvas
            ref={canvasRef}
            onClick={addMode ? (e) => void handleCanvasClick(e) : undefined}
            style={{
              width: '100%', height: '100%', display: 'block',
              cursor: addMode ? 'crosshair' : 'default',
            }}
          />

          {/* Annotation pin overlay canvas */}
          <canvas
            ref={overlayCanvasRef}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              pointerEvents: 'none',
            }}
          />

          {/* Annotation input popup (shows near click point) */}
          {pendingPos && pendingScreenPos && (
            <div style={{
              position: 'absolute',
              left: Math.min(pendingScreenPos.sx + 12, (canvasRef.current?.clientWidth ?? 800) - 260),
              top: Math.min(pendingScreenPos.sy + 12, (canvasRef.current?.clientHeight ?? 600) - 180),
              width: 240, zIndex: 20,
              background: '#161b22', border: '1px solid #388bfd66',
              borderRadius: 10, padding: 14,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: '#6e7681' }}>
                📍 {pendingPos.x}, {pendingPos.y}, {pendingPos.z}
              </p>
              <textarea
                value={annText}
                onChange={e => setAnnText(e.target.value)}
                placeholder={t.annotationPlaceholder}
                rows={3}
                style={{
                  width: '100%', padding: '7px 9px', borderRadius: 6, resize: 'none',
                  background: '#0d1117', border: '1px solid #30363d',
                  color: '#e6edf3', fontSize: 12, outline: 'none', boxSizing: 'border-box',
                  marginBottom: 8,
                }}
              />
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                <label style={{ fontSize: 10, color: '#6e7681' }}>{t.color}:</label>
                {['#f59e0b', '#388bfd', '#3fb950', '#f85149', '#a371f7'].map(c => (
                  <button
                    key={c}
                    onClick={() => setAnnColor(c)}
                    style={{
                      width: 16, height: 16, borderRadius: '50%', border: annColor === c ? '2px solid #fff' : '2px solid transparent',
                      background: c, cursor: 'pointer', padding: 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => void submitAnnotation()}
                  disabled={annSubmitting || !annText.trim()}
                  style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, border: 'none',
                    background: annText.trim() ? '#388bfd' : '#21262d',
                    color: annText.trim() ? '#fff' : '#6e7681',
                    fontSize: 12, fontWeight: 700, cursor: annText.trim() ? 'pointer' : 'default',
                  }}
                >
                  {annSubmitting ? '...' : t.add}
                </button>
                <button
                  onClick={() => { setPendingPos(null); setPendingScreenPos(null); setAnnText(''); }}
                  style={{
                    padding: '6px 10px', borderRadius: 6, border: '1px solid #30363d',
                    background: 'transparent', color: '#6e7681', fontSize: 12, cursor: 'pointer',
                  }}
                >
                  {t.cancel}
                </button>
              </div>
            </div>
          )}

          {/* Add annotation mode toggle */}
          {authToken && !pendingPos && (
            <button
              onClick={() => { setAddMode(p => !p); setPendingPos(null); }}
              style={{
                position: 'absolute', top: 16, left: 16,
                padding: '6px 12px', borderRadius: 20,
                background: addMode ? '#388bfd22' : '#21262d',
                border: `1px solid ${addMode ? '#388bfd' : '#30363d'}`,
                color: addMode ? '#388bfd' : '#8b949e',
                fontSize: 12, fontWeight: 700, cursor: 'pointer', zIndex: 10,
              }}
            >
              📌 {addMode
                ? t.clickPin
                : t.addNote}
            </button>
          )}

          {/* Annotation success message */}
          {annMsg && (
            <div style={{
              position: 'absolute', top: 60, left: 16, zIndex: 20,
              padding: '7px 13px', borderRadius: 7,
              background: '#1a2e1a', border: '1px solid #3fb950',
              color: '#3fb950', fontSize: 12, fontWeight: 700,
            }}>
              ✓ {annMsg}
            </div>
          )}
        </div>

        {/* ── Metadata overlay (bottom-left) ── */}
        <div style={{
          position: 'absolute', bottom: 24, left: 24,
          background: '#161b22cc', border: '1px solid #30363d',
          borderRadius: 10, padding: '12px 16px',
          backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', gap: 6,
          pointerEvents: 'none',
        }}>
          {metadata.material && (
            <span style={{ fontSize: 11, color: '#8b949e' }}>
              {t.material}: <b style={{ color: '#e6edf3' }}>{metadata.material}</b>
            </span>
          )}
          {metadata.bbox && (
            <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'monospace' }}>
              {metadata.bbox.w} × {metadata.bbox.h} × {metadata.bbox.d} mm
            </span>
          )}
        </div>

        {/* ── Annotation panel toggle badge ── */}
        <button
          onClick={() => setAnnPanelOpen(p => !p)}
          style={{
            position: 'absolute', top: 16, right: 16,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 20,
            background: annPanelOpen ? '#388bfd22' : '#21262d',
            border: `1px solid ${annPanelOpen ? '#388bfd' : '#30363d'}`,
            color: annPanelOpen ? '#388bfd' : '#8b949e',
            fontSize: 12, fontWeight: 700,
            cursor: 'pointer', zIndex: 10,
          }}
        >
          💬 {annotations.length}
          <span style={{ fontSize: 10, opacity: 0.7 }}>{annPanelOpen ? '▲' : '▼'}</span>
        </button>

        {/* ── Annotation panel ── */}
        {annPanelOpen && (
          <div style={{
            position: 'absolute', top: 52, right: 16, width: 300, maxHeight: 420,
            background: '#161b22ee', border: '1px solid #30363d',
            borderRadius: 12, overflow: 'hidden', zIndex: 10,
            backdropFilter: 'blur(12px)',
            display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #30363d', fontSize: 12, fontWeight: 700, color: '#8b949e' }}>
              {t.annotations} ({annotations.filter(a => !a.resolved).length} {t.open})
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
              {annotations.length === 0 ? (
                <p style={{ padding: '16px', color: '#6e7681', fontSize: 12, textAlign: 'center', margin: 0 }}>
                  {t.noAnnotations}
                  {authToken && (
                    <><br /><span style={{ color: '#8b949e' }}>{t.useAddNote}</span></>
                  )}
                </p>
              ) : annotations.map(ann => (
                <div
                  key={ann.id}
                  onMouseEnter={() => setHoveredAnnId(ann.id)}
                  onMouseLeave={() => setHoveredAnnId(null)}
                  style={{
                    padding: '10px 14px', borderBottom: '1px solid #21262d',
                    background: hoveredAnnId === ann.id ? 'rgba(56,139,253,0.07)' : 'transparent',
                    transition: 'background 0.15s',
                    opacity: ann.resolved ? 0.6 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: ann.resolved ? '#8b949e' : (ann.color ?? '#f59e0b'),
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ann.authorName}
                    </span>
                    {/* Resolved toggle (only if authed) */}
                    {authToken && (
                      <button
                        onClick={() => void toggleResolved(ann)}
                        title={ann.resolved ? t.markOpen : t.markResolved}
                        style={{
                          padding: '1px 6px', borderRadius: 4, border: `1px solid ${ann.resolved ? '#6e7681' : '#3fb950'}`,
                          background: 'transparent', color: ann.resolved ? '#6e7681' : '#3fb950',
                          fontSize: 9, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        }}
                      >
                        {ann.resolved ? t.reopen : '✓'}
                      </button>
                    )}
                    {!authToken && ann.resolved && (
                      <span style={{ fontSize: 9, color: '#3fb950', background: '#3fb95022', padding: '1px 5px', borderRadius: 4 }}>
                        {t.resolved}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: '#6e7681', flexShrink: 0 }}>
                      {formatDate(ann.createdAt, routeLang, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.5, wordBreak: 'break-word' }}>
                    {ann.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Not logged in hint */}
            {!authToken && (
              <div style={{ padding: '10px 14px', borderTop: '1px solid #21262d', fontSize: 11, color: '#6e7681', textAlign: 'center' }}>
                <a href={`/login?lang=${routeLang}`} style={{ color: '#388bfd', fontWeight: 700, textDecoration: 'none' }}>
                  {t.loginPro}
                </a>
              </div>
            )}
          </div>
        )}

        {/* ── Watermark overlay (bottom-right) ── */}
        {metadata.watermark && (
          <div style={{
            position: 'fixed', bottom: 24, right: 24,
            fontSize: 13, color: '#e6edf366',
            pointerEvents: 'none', userSelect: 'none',
            letterSpacing: '0.03em', textShadow: '0 1px 4px #0009',
          }}>
            {metadata.watermark}
          </div>
        )}
      </div>
    </div>
  );
}
