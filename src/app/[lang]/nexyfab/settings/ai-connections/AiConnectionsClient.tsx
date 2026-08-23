'use client';

import { useEffect, useMemo, useState } from 'react';
import { toIsoLang, langDir, type IsoLang } from '@/lib/i18n/normalize';
import {
  DEFAULT_AGENT_SCOPE,
  generateConnectionSnippet,
  isAbsoluteAgentPath,
  type AgentClient,
  type AgentGatewayMode,
  type AgentScope,
} from '@/lib/desktop-agent/connectionConfig';
import {
  AI_PROVIDERS,
  getProviderStatus,
  getAgentRuntimeInfo,
  saveProviderCredential,
  deleteProviderCredential,
  testProviderConnection,
  ProviderBridgeError,
  usableAgentRuntime,
  type AiProvider,
} from '@/lib/desktop-agent/providerCredentials';

type Copy = {
  title: string;
  intro: string;
  gateway: string;
  project: string;
  scope: string;
  client: string;
  snippet: string;
  copy: string;
  copied: string;
  security: string;
  securityText: string;
  support: string;
  supportText: string;
  gatewayPlaceholder: string;
  projectPlaceholder: string;
};

type ProviderCopy = {
  title: string;
  intro: string;
  desktopOnly: string;
  present: string;
  missing: string;
  loading: string;
  error: string;
  placeholder: string;
  keyLabel: string;
  save: string;
  remove: string;
  test: string;
  refresh: string;
  saving: string;
  testing: string;
  ok: string;
  unauthorized: string;
  forbidden: string;
  timeout: string;
  network: string;
  http: string;
  invalidCredential: string;
  keyring: string;
  missingError: string;
  genericError: string;
};

const COPY: Record<IsoLang, Copy> = {
  ko: { title: '로컬 AI 연결', intro: 'NexyFab의 로컬 MCP 게이트웨이를 코딩 에이전트에 연결합니다.', gateway: '게이트웨이 절대 경로', project: '프로젝트 루트', scope: '권한 범위', client: '클라이언트', snippet: '생성된 설정', copy: '복사', copied: '복사됨', security: '보안 요약', securityText: '기본 권한은 읽기입니다. 경로는 프로젝트 루트 안으로 제한되며 API 키는 브라우저나 설정에 저장하지 않습니다.', support: '지원 상태', supportText: 'Claude Desktop, Claude Code, Codex/MCP 클라이언트를 지원합니다. ChatGPT가 로컬 게이트웨이에 직접 연결되는 기능은 제공하지 않습니다.', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
  en: { title: 'Local AI connections', intro: 'Connect NexyFab’s local MCP gateway to a coding agent.', gateway: 'Gateway absolute path', project: 'Project root', scope: 'Permission scope', client: 'Client', snippet: 'Generated configuration', copy: 'Copy', copied: 'Copied', security: 'Security summary', securityText: 'Read is the default scope. Paths stay inside the project root. No API keys are stored in the browser or generated configuration.', support: 'Support status', supportText: 'Supported: Claude Desktop, Claude Code, and Codex/MCP clients. ChatGPT does not directly connect to a local gateway.', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
  ja: { title: 'ローカルAI接続', intro: 'NexyFabのローカルMCPゲートウェイをコーディングエージェントに接続します。', gateway: 'ゲートウェイの絶対パス', project: 'プロジェクトルート', scope: '権限スコープ', client: 'クライアント', snippet: '生成された設定', copy: 'コピー', copied: 'コピー済み', security: 'セキュリティ概要', securityText: '既定のスコープは読み取りです。パスはプロジェクトルート内に制限され、APIキーは保存されません。', support: '対応状況', supportText: 'Claude Desktop、Claude Code、Codex/MCPクライアントに対応します。ChatGPTからローカルゲートウェイへ直接接続する機能はありません。', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
  zh: { title: '本地 AI 连接', intro: '将 NexyFab 本地 MCP 网关连接到编码代理。', gateway: '网关绝对路径', project: '项目根目录', scope: '权限范围', client: '客户端', snippet: '生成的配置', copy: '复制', copied: '已复制', security: '安全摘要', securityText: '默认范围为只读。路径限制在项目根目录内，不会在浏览器或配置中保存 API 密钥。', support: '支持状态', supportText: '支持 Claude Desktop、Claude Code 和 Codex/MCP 客户端。ChatGPT 不会直接连接本地网关。', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
  es: { title: 'Conexiones de IA local', intro: 'Conecta la puerta de enlace MCP local de NexyFab a un agente de código.', gateway: 'Ruta absoluta de la puerta de enlace', project: 'Raíz del proyecto', scope: 'Alcance de permisos', client: 'Cliente', snippet: 'Configuración generada', copy: 'Copiar', copied: 'Copiado', security: 'Resumen de seguridad', securityText: 'El alcance predeterminado es lectura. Las rutas quedan dentro de la raíz del proyecto y no se guardan claves API.', support: 'Estado de compatibilidad', supportText: 'Compatible con Claude Desktop, Claude Code y clientes Codex/MCP. ChatGPT no se conecta directamente a una puerta de enlace local.', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
  ar: { title: 'اتصالات الذكاء الاصطناعي المحلي', intro: 'صِل بوابة MCP المحلية في NexyFab بعميل برمجة.', gateway: 'المسار المطلق للبوابة', project: 'جذر المشروع', scope: 'نطاق الصلاحيات', client: 'العميل', snippet: 'الإعداد المُنشأ', copy: 'نسخ', copied: 'تم النسخ', security: 'ملخص الأمان', securityText: 'النطاق الافتراضي هو القراءة. تبقى المسارات داخل جذر المشروع ولا تُحفظ مفاتيح API في المتصفح أو الإعدادات.', support: 'حالة الدعم', supportText: 'مدعوم: Claude Desktop وClaude Code وعملاء Codex/MCP. لا يتصل ChatGPT مباشرة ببوابة محلية.', gatewayPlaceholder: 'C:\\NexyFab\\scripts\\drawing-to-3d\\agent-mcp-server.mjs', projectPlaceholder: 'C:\\NexyFab\\project' },
};

const PROVIDER_COPY: Record<IsoLang, ProviderCopy> = {
  ko: { title: 'AI 제공자 자격 증명', intro: 'API 키는 데스크톱 앱의 운영체제 자격 증명 저장소에만 저장됩니다.', desktopOnly: '보안 제공자 저장소는 데스크톱 앱에서만 사용할 수 있습니다.', present: '자격 증명 저장됨', missing: '자격 증명 없음', loading: '상태 확인 중…', error: '상태를 확인할 수 없습니다.', placeholder: 'API 키를 입력하세요', keyLabel: 'API 키', save: '안전하게 저장', remove: '삭제', test: '연결 테스트', refresh: '상태 새로 고침', saving: '저장 중…', testing: '테스트 중…', ok: '연결 성공', unauthorized: '인증되지 않은 키', forbidden: '접근이 거부됨', timeout: '요청 시간 초과', network: '네트워크 오류', http: '서비스 응답 오류', invalidCredential: '키가 비어 있거나 형식이 올바르지 않습니다.', keyring: '운영체제 보안 저장소를 사용할 수 없습니다.', missingError: '먼저 자격 증명을 저장하세요.', genericError: '작업을 완료할 수 없습니다.' },
  en: { title: 'AI provider credentials', intro: 'API keys are stored only in the desktop app’s operating-system credential store.', desktopOnly: 'Secure provider storage is available in the desktop app only.', present: 'Credential stored', missing: 'No credential', loading: 'Checking status…', error: 'Status unavailable.', placeholder: 'Enter an API key', keyLabel: 'API key', save: 'Save securely', remove: 'Delete', test: 'Test connection', refresh: 'Refresh status', saving: 'Saving…', testing: 'Testing…', ok: 'Connected', unauthorized: 'Key was not accepted', forbidden: 'Access was denied', timeout: 'Request timed out', network: 'Network error', http: 'Service returned an error', invalidCredential: 'The key is empty or contains invalid characters.', keyring: 'The operating-system secure store is unavailable.', missingError: 'Save a credential first.', genericError: 'The operation could not be completed.' },
  ja: { title: 'AI プロバイダーの認証情報', intro: 'API キーはデスクトップアプリの OS 認証情報ストアにのみ保存されます。', desktopOnly: '安全なプロバイダー保存領域はデスクトップアプリでのみ利用できます。', present: '認証情報を保存済み', missing: '認証情報なし', loading: '状態を確認中…', error: '状態を取得できません。', placeholder: 'API キーを入力', keyLabel: 'API キー', save: '安全に保存', remove: '削除', test: '接続をテスト', refresh: '状態を更新', saving: '保存中…', testing: 'テスト中…', ok: '接続成功', unauthorized: 'キーが認証されませんでした', forbidden: 'アクセスが拒否されました', timeout: 'リクエストがタイムアウトしました', network: 'ネットワークエラー', http: 'サービスがエラーを返しました', invalidCredential: 'キーが空か、使用できない文字を含んでいます。', keyring: 'OS の安全な保存領域を利用できません。', missingError: '先に認証情報を保存してください。', genericError: '操作を完了できませんでした。' },
  zh: { title: 'AI 提供商凭据', intro: 'API 密钥只会保存到桌面应用的操作系统凭据存储中。', desktopOnly: '安全的提供商存储仅适用于桌面应用。', present: '凭据已保存', missing: '没有凭据', loading: '正在检查状态…', error: '无法获取状态。', placeholder: '输入 API 密钥', keyLabel: 'API 密钥', save: '安全保存', remove: '删除', test: '测试连接', refresh: '刷新状态', saving: '正在保存…', testing: '正在测试…', ok: '连接成功', unauthorized: '密钥未被接受', forbidden: '访问被拒绝', timeout: '请求超时', network: '网络错误', http: '服务返回错误', invalidCredential: '密钥为空或包含无效字符。', keyring: '无法使用操作系统安全存储。', missingError: '请先保存凭据。', genericError: '无法完成此操作。' },
  es: { title: 'Credenciales de proveedores de IA', intro: 'Las claves API solo se guardan en el almacén de credenciales del sistema operativo de la aplicación de escritorio.', desktopOnly: 'El almacenamiento seguro del proveedor solo está disponible en la aplicación de escritorio.', present: 'Credencial guardada', missing: 'Sin credencial', loading: 'Comprobando estado…', error: 'Estado no disponible.', placeholder: 'Introduzca una clave API', keyLabel: 'Clave API', save: 'Guardar de forma segura', remove: 'Eliminar', test: 'Probar conexión', refresh: 'Actualizar estado', saving: 'Guardando…', testing: 'Probando…', ok: 'Conectado', unauthorized: 'La clave no fue aceptada', forbidden: 'Acceso denegado', timeout: 'La solicitud agotó el tiempo', network: 'Error de red', http: 'El servicio devolvió un error', invalidCredential: 'La clave está vacía o contiene caracteres no válidos.', keyring: 'El almacén seguro del sistema operativo no está disponible.', missingError: 'Guarde primero una credencial.', genericError: 'No se pudo completar la operación.' },
  ar: { title: 'بيانات اعتماد مزوّدي الذكاء الاصطناعي', intro: 'تُحفظ مفاتيح API فقط في مخزن بيانات اعتماد نظام التشغيل داخل تطبيق سطح المكتب.', desktopOnly: 'يتوفر التخزين الآمن للمزوّد في تطبيق سطح المكتب فقط.', present: 'تم حفظ بيانات الاعتماد', missing: 'لا توجد بيانات اعتماد', loading: 'جارٍ التحقق من الحالة…', error: 'الحالة غير متاحة.', placeholder: 'أدخل مفتاح API', keyLabel: 'مفتاح API', save: 'حفظ آمن', remove: 'حذف', test: 'اختبار الاتصال', refresh: 'تحديث الحالة', saving: 'جارٍ الحفظ…', testing: 'جارٍ الاختبار…', ok: 'تم الاتصال', unauthorized: 'لم يُقبل المفتاح', forbidden: 'تم رفض الوصول', timeout: 'انتهت مهلة الطلب', network: 'خطأ في الشبكة', http: 'أعاد الخادم خطأً', invalidCredential: 'المفتاح فارغ أو يحتوي على أحرف غير صالحة.', keyring: 'مخزن النظام الآمن غير متاح.', missingError: 'احفظ بيانات الاعتماد أولاً.', genericError: 'تعذر إكمال العملية.' },
};

const SCOPE_COPY: Record<IsoLang, Record<AgentScope, string>> = {
  ko: { read: '읽기 — 조회 및 검증', propose: '제안 — 메모리에서 계획', apply: '적용 — 제한된 형상 변경', export: '내보내기 — 파일·패키지·원격 작업' },
  en: { read: 'Read — inspect and verify', propose: 'Propose — plan in memory', apply: 'Apply — bounded geometry edits', export: 'Export — files, packages, and remote work' },
  ja: { read: '読み取り — 確認と検証', propose: '提案 — メモリ内で計画', apply: '適用 — 範囲を限定した形状編集', export: 'エクスポート — ファイル・パッケージ・リモート処理' },
  zh: { read: '只读 — 查看与验证', propose: '建议 — 在内存中规划', apply: '应用 — 有范围的几何修改', export: '导出 — 文件、软件包和远程操作' },
  es: { read: 'Lectura — inspeccionar y verificar', propose: 'Proponer — planificar en memoria', apply: 'Aplicar — ediciones geométricas limitadas', export: 'Exportar — archivos, paquetes y operaciones remotas' },
  ar: { read: 'قراءة — الفحص والتحقق', propose: 'اقتراح — التخطيط في الذاكرة', apply: 'تطبيق — تعديلات هندسية محدودة', export: 'تصدير — ملفات وحزم وعمليات بعيدة' },
};

const VALIDATION_COPY: Record<IsoLang, string> = {
  ko: '게이트웨이와 프로젝트 루트의 실제 절대 경로를 모두 입력하세요.',
  en: 'Enter real absolute paths for both the gateway and project root.',
  ja: 'ゲートウェイとプロジェクトルートの実際の絶対パスを入力してください。',
  zh: '请输入网关和项目根目录的实际绝对路径。',
  es: 'Introduzca rutas absolutas reales para la puerta de enlace y la raíz del proyecto.',
  ar: 'أدخل مسارين مطلقين فعليين للبوابة وجذر المشروع.',
};

const SUPPORT_COPY: Record<IsoLang, string> = {
  ko: '현재 로컬 설정 생성 대상은 Claude Desktop, Claude Code, Codex/MCP 클라이언트입니다. ChatGPT용 로컬 설정 자동 생성은 아직 제공하지 않습니다.',
  en: 'Local setup generation currently targets Claude Desktop, Claude Code, and Codex/MCP clients. Automatic local ChatGPT setup is not provided yet.',
  ja: '現在のローカル設定生成は Claude Desktop、Claude Code、Codex/MCP クライアント向けです。ChatGPT のローカル設定自動生成はまだ提供していません。',
  zh: '当前本地配置生成功能面向 Claude Desktop、Claude Code 和 Codex/MCP 客户端，尚未提供 ChatGPT 本地配置的自动生成。',
  es: 'La configuración local se genera actualmente para Claude Desktop, Claude Code y clientes Codex/MCP. Aún no se genera automáticamente una configuración local para ChatGPT.',
  ar: 'يستهدف إنشاء الإعداد المحلي حالياً Claude Desktop وClaude Code وعملاء Codex/MCP. لا يتوفر بعد إنشاء إعداد ChatGPT المحلي تلقائياً.',
};

const RUNTIME_COPY: Record<IsoLang, { title: string; checking: string; installed: string; missing: string; manual: string }> = {
  ko: { title: '설치형 MCP 런타임', checking: '설치된 로컬 코어 런타임을 확인하는 중입니다…', installed: '설치된 로컬 코어 런타임을 자동으로 선택했습니다.', missing: '이 설치본에 로컬 코어 런타임이 없습니다. 릴리스 빌드에서 사이드카를 포함해야 합니다.', manual: '웹에서는 개발용 Node 게이트웨이 절대 경로를 직접 입력할 수 있습니다.' },
  en: { title: 'Installed MCP runtime', checking: 'Checking the installed local-core runtime…', installed: 'The installed local-core runtime was selected automatically.', missing: 'This installation has no local-core runtime. The release build must include the sidecar.', manual: 'On the web, enter the development Node gateway absolute path manually.' },
  ja: { title: 'インストール済み MCP ランタイム', checking: 'インストール済みローカルコアを確認しています…', installed: 'インストール済みローカルコアを自動選択しました。', missing: 'このインストールにはローカルコアがありません。リリースビルドにサイドカーを含めてください。', manual: 'Web では開発用 Node ゲートウェイの絶対パスを手動入力できます。' },
  zh: { title: '已安装的 MCP 运行时', checking: '正在检查已安装的本地核心运行时…', installed: '已自动选择安装的本地核心运行时。', missing: '此安装不包含本地核心运行时，发布构建必须包含 sidecar。', manual: '在网页中可手动输入开发用 Node 网关的绝对路径。' },
  es: { title: 'Entorno MCP instalado', checking: 'Comprobando el entorno local-core instalado…', installed: 'Se seleccionó automáticamente el entorno local-core instalado.', missing: 'Esta instalación no incluye local-core. La compilación de lanzamiento debe incluir el sidecar.', manual: 'En la web, introduzca manualmente la ruta absoluta de la puerta Node de desarrollo.' },
  ar: { title: 'بيئة MCP المثبتة', checking: 'جارٍ التحقق من بيئة النواة المحلية المثبتة…', installed: 'تم اختيار بيئة النواة المحلية المثبتة تلقائياً.', missing: 'لا تتضمن هذه النسخة بيئة النواة المحلية. يجب أن تتضمن حزمة الإصدار البرنامج الجانبي.', manual: 'على الويب، أدخل يدوياً المسار المطلق لبوابة Node المخصصة للتطوير.' },
};

const scopeValues: AgentScope[] = ['read', 'propose', 'apply', 'export'];

const CLIENT_COPY: Record<IsoLang, Record<AgentClient, string>> = {
  ko: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'Claude Code 명령줄', codex: 'Codex / MCP 클라이언트 (TOML)' },
  en: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'Claude Code CLI', codex: 'Codex / MCP client (TOML)' },
  ja: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'Claude Code コマンドライン', codex: 'Codex / MCP クライアント (TOML)' },
  zh: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'Claude Code 命令行', codex: 'Codex / MCP 客户端 (TOML)' },
  es: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'Línea de comandos de Claude Code', codex: 'Cliente Codex / MCP (TOML)' },
  ar: { 'claude-desktop': 'Claude Desktop (JSON)', 'claude-code': 'سطر أوامر Claude Code', codex: 'عميل Codex / MCP ‏(TOML)' },
};

const clientValues: AgentClient[] = ['claude-desktop', 'claude-code', 'codex'];

const STORAGE_KEY = 'nexyfab-agent-connection-inputs';

type SavedInputs = Partial<{ gatewayPath: string; projectRoot: string; scope: AgentScope; client: AgentClient; mode: AgentGatewayMode }>;

function readSavedInputs(): SavedInputs {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as SavedInputs; } catch { return {}; }
}

type ProviderState = { hasCredential: boolean; busy: boolean; errorCode?: string; connectionCode?: string };
type RuntimeState = 'web' | 'checking' | 'installed' | 'missing';

function isDesktopRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function providerErrorText(copy: ProviderCopy, code?: string): string | undefined {
  if (!code) return undefined;
  if (code === 'invalid_credential') return copy.invalidCredential;
  if (code === 'keyring_unavailable') return copy.keyring;
  if (code === 'credential_missing') return copy.missingError;
  return copy.genericError;
}

function connectionText(copy: ProviderCopy, code?: string): string | undefined {
  if (code === 'ok') return copy.ok;
  if (code === 'unauthorized') return copy.unauthorized;
  if (code === 'forbidden') return copy.forbidden;
  if (code === 'timeout') return copy.timeout;
  if (code === 'network_error') return copy.network;
  if (code === 'http_error') return copy.http;
  return undefined;
}

export default function AiConnectionsClient({ lang }: { lang: string }) {
  const locale = toIsoLang(lang);
  const t = COPY[locale];
  const [gatewayPath, setGatewayPath] = useState('');
  const [projectRoot, setProjectRoot] = useState('');
  const [scope, setScope] = useState<AgentScope>(DEFAULT_AGENT_SCOPE);
  const [client, setClient] = useState<AgentClient>('claude-desktop');
  const [gatewayMode, setGatewayMode] = useState<AgentGatewayMode>('node-script');
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('web');
  const [copied, setCopied] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const providerCopy = PROVIDER_COPY[locale];
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [providerKeys, setProviderKeys] = useState<Record<AiProvider, string>>({ openai: '', anthropic: '' });
  const [providerStates, setProviderStates] = useState<Record<AiProvider, ProviderState>>({
    openai: { hasCredential: false, busy: false },
    anthropic: { hasCredential: false, busy: false },
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = readSavedInputs();
      if (saved.gatewayPath) setGatewayPath(saved.gatewayPath);
      if (saved.projectRoot) setProjectRoot(saved.projectRoot);
      if (saved.scope && scopeValues.includes(saved.scope)) setScope(saved.scope);
      if (saved.client && clientValues.includes(saved.client)) setClient(saved.client);
      if (saved.mode === 'binary' || saved.mode === 'node-script') setGatewayMode(saved.mode);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ gatewayPath, projectRoot, scope, client, mode: gatewayMode })); } catch { /* optional persistence */ }
  }, [gatewayPath, projectRoot, scope, client, gatewayMode, hydrated]);

  const snippet = useMemo(() => generateConnectionSnippet(client, { gatewayPath, projectRoot, scope, mode: gatewayMode }), [client, gatewayPath, projectRoot, scope, gatewayMode]);
  const direction = langDir(lang);
  const pathsValid = isAbsoluteAgentPath(gatewayPath) && isAbsoluteAgentPath(projectRoot);

  async function copySnippet() {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); }
  }

  async function refreshProvider(provider: AiProvider) {
    setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: true, errorCode: undefined } }));
    try {
      const status = await getProviderStatus(provider);
      setProviderStates((current) => ({ ...current, [provider]: { hasCredential: status.has_credential, busy: false } }));
    } catch (error) {
      const code = error instanceof ProviderBridgeError ? error.code : 'unknown';
      setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: false, errorCode: code } }));
    }
  }

  useEffect(() => {
    const available = isDesktopRuntime();
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setDesktopAvailable(available);
      if (!available) return;
      setRuntimeState('checking');
      void getAgentRuntimeInfo().then((info) => {
        if (!active) return;
        if (usableAgentRuntime(info) && isAbsoluteAgentPath(info.path)) {
          setGatewayPath(info.path);
          setGatewayMode('binary');
          setRuntimeState('installed');
        } else {
          setRuntimeState('missing');
        }
      }).catch(() => { if (active) setRuntimeState('missing'); });
      for (const provider of AI_PROVIDERS) void refreshProvider(provider);
    });
    return () => { active = false; };
  // The bridge is stable; this effect intentionally runs once per page.
  }, []);

  async function saveProvider(provider: AiProvider) {
    const apiKey = providerKeys[provider];
    if (!apiKey || !desktopAvailable) return;
    setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: true, errorCode: undefined } }));
    try {
      const status = await saveProviderCredential(provider, apiKey);
      setProviderKeys((current) => ({ ...current, [provider]: '' }));
      setProviderStates((current) => ({ ...current, [provider]: { hasCredential: status.has_credential, busy: false } }));
    } catch (error) {
      setProviderKeys((current) => ({ ...current, [provider]: '' }));
      const code = error instanceof ProviderBridgeError ? error.code : 'unknown';
      setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: false, errorCode: code } }));
    }
  }

  async function removeProvider(provider: AiProvider) {
    if (!desktopAvailable) return;
    setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: true, errorCode: undefined } }));
    try {
      await deleteProviderCredential(provider);
      setProviderStates((current) => ({ ...current, [provider]: { hasCredential: false, busy: false } }));
    } catch (error) {
      const code = error instanceof ProviderBridgeError ? error.code : 'unknown';
      setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: false, errorCode: code } }));
    }
  }

  async function testProvider(provider: AiProvider) {
    if (!desktopAvailable || !providerStates[provider].hasCredential) return;
    setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: true, errorCode: undefined, connectionCode: undefined } }));
    try {
      const result = await testProviderConnection(provider);
      setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: false, connectionCode: result.code } }));
    } catch (error) {
      const code = error instanceof ProviderBridgeError ? error.code : 'unknown';
      setProviderStates((current) => ({ ...current, [provider]: { ...current[provider], busy: false, errorCode: code } }));
    }
  }

  function renderProviderCard(provider: AiProvider) {
    const state = providerStates[provider];
    const label = provider === 'openai' ? 'OpenAI' : 'Anthropic';
    const disabled = !desktopAvailable || state.busy;
    return (
      <article key={provider} style={{ display: 'grid', gap: 10, padding: 18, border: '1px solid var(--nx-border, #30363d)', borderRadius: 10, background: 'var(--nx-panel, #161b22)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 18 }}>{label}</h3>
          <span role="status" style={{ color: state.hasCredential ? '#3fb950' : '#8b949e', fontSize: 13 }}>{state.busy ? providerCopy.loading : state.hasCredential ? providerCopy.present : providerCopy.missing}</span>
        </div>
        <input type="password" value={providerKeys[provider]} onChange={(event) => setProviderKeys((current) => ({ ...current, [provider]: event.target.value }))} placeholder={providerCopy.placeholder} autoComplete="off" spellCheck={false} disabled={disabled} style={inputStyle} aria-label={`${label} ${providerCopy.keyLabel}`} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => void saveProvider(provider)} disabled={disabled || providerKeys[provider].length === 0} style={buttonStyle(disabled || providerKeys[provider].length === 0)}>{state.busy ? providerCopy.saving : providerCopy.save}</button>
          <button type="button" onClick={() => void testProvider(provider)} disabled={disabled || !state.hasCredential} style={buttonStyle(disabled || !state.hasCredential)}>{state.busy ? providerCopy.testing : providerCopy.test}</button>
          <button type="button" onClick={() => void removeProvider(provider)} disabled={disabled || !state.hasCredential} style={buttonStyle(disabled || !state.hasCredential)}>{providerCopy.remove}</button>
          <button type="button" onClick={() => void refreshProvider(provider)} disabled={disabled} style={buttonStyle(disabled)}>{providerCopy.refresh}</button>
        </div>
        {state.errorCode && <p role="alert" style={{ margin: 0, color: '#f85149', fontSize: 13 }}>{providerErrorText(providerCopy, state.errorCode) ?? providerCopy.error}</p>}
        {state.connectionCode && <p role="status" style={{ margin: 0, color: state.connectionCode === 'ok' ? '#3fb950' : '#f0b429', fontSize: 13 }}>{connectionText(providerCopy, state.connectionCode)}</p>}
      </article>
    );
  }

  return (
    <main dir={direction} style={{ minHeight: '100vh', background: 'var(--nx-bg, #0d1117)', color: 'var(--nx-text, #e6edf3)', padding: '48px 24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: 30 }}>{t.title}</h1>
        <p style={{ color: 'var(--nx-text-2, #8b949e)', margin: '10px 0 28px' }}>{t.intro}</p>
        <section style={{ ...noticeStyle, marginTop: 0, marginBottom: 20 }}>
          <h2 style={noticeHeading}>{RUNTIME_COPY[locale].title}</h2>
          <p role="status" style={noticeText}>{runtimeState === 'checking' ? RUNTIME_COPY[locale].checking : runtimeState === 'installed' ? RUNTIME_COPY[locale].installed : runtimeState === 'missing' ? RUNTIME_COPY[locale].missing : RUNTIME_COPY[locale].manual}</p>
        </section>
        <section style={{ display: 'grid', gap: 14, marginBottom: 20 }} aria-labelledby="provider-credentials-title">
          <div>
            <h2 id="provider-credentials-title" style={{ margin: 0, fontSize: 20 }}>{providerCopy.title}</h2>
            <p style={{ color: 'var(--nx-text-2, #8b949e)', margin: '7px 0 0', fontSize: 13 }}>{providerCopy.intro}</p>
          </div>
          {!desktopAvailable && <p role="status" style={{ margin: 0, padding: 12, borderRadius: 8, background: '#2a2110', color: '#f0b429', fontSize: 13 }}>{providerCopy.desktopOnly}</p>}
          {AI_PROVIDERS.map(renderProviderCard)}
        </section>
        <section style={{ display: 'grid', gap: 16, background: 'var(--nx-panel, #161b22)', border: '1px solid var(--nx-border, #30363d)', borderRadius: 14, padding: 22 }}>
          <label>{t.gateway}<input value={gatewayPath} onChange={(event) => { setGatewayPath(event.target.value); setGatewayMode('node-script'); }} placeholder={t.gatewayPlaceholder} autoComplete="off" spellCheck={false} style={inputStyle} /></label>
          <label>{t.project}<input value={projectRoot} onChange={(event) => setProjectRoot(event.target.value)} placeholder={t.projectPlaceholder} autoComplete="off" spellCheck={false} style={inputStyle} /></label>
          <label>{t.scope}<select value={scope} onChange={(event) => setScope(event.target.value as AgentScope)} style={inputStyle}>{scopeValues.map((value) => <option value={value} key={value}>{SCOPE_COPY[locale][value]}</option>)}</select></label>
          <label>{t.client}<select value={client} onChange={(event) => setClient(event.target.value as AgentClient)} style={inputStyle}>{clientValues.map((value) => <option value={value} key={value}>{CLIENT_COPY[locale][value]}</option>)}</select></label>
          {!pathsValid && <p role="status" style={{ margin: 0, color: '#f0b429', fontSize: 13 }}>{VALIDATION_COPY[locale]}</p>}
        </section>
        <section style={{ marginTop: 20, position: 'relative' }}>
          <h2 style={{ fontSize: 17, marginBottom: 8 }}>{t.snippet}</h2>
          <pre style={{ overflowX: 'auto', padding: 18, paddingInlineEnd: 80, borderRadius: 10, background: '#010409', border: '1px solid var(--nx-border, #30363d)', color: '#c9d1d9', fontSize: 13, lineHeight: 1.5 }}>{snippet}</pre>
          <button type="button" onClick={copySnippet} disabled={!pathsValid} aria-live="polite" style={{ position: 'absolute', top: 40, insetInlineEnd: 10, padding: '7px 11px', borderRadius: 7, border: '1px solid #484f58', background: '#21262d', color: '#f0f6fc', cursor: pathsValid ? 'pointer' : 'not-allowed', opacity: pathsValid ? 1 : 0.55 }}>{copied ? t.copied : t.copy}</button>
        </section>
        <section style={noticeStyle}><h2 style={noticeHeading}>{t.security}</h2><p style={noticeText}>{t.securityText}</p></section>
        <section style={noticeStyle}><h2 style={noticeHeading}>{t.support}</h2><p style={noticeText}>{SUPPORT_COPY[locale]}</p></section>
      </div>
    </main>
  );
}

const inputStyle = { display: 'block', width: '100%', boxSizing: 'border-box' as const, marginTop: 7, padding: '10px 11px', borderRadius: 8, border: '1px solid var(--nx-border, #30363d)', background: 'var(--nx-bg, #0d1117)', color: 'inherit', fontSize: 14 };
const buttonStyle = (disabled: boolean) => ({ padding: '8px 11px', borderRadius: 7, border: '1px solid #484f58', background: '#21262d', color: '#f0f6fc', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1, fontSize: 13 });
const noticeStyle = { marginTop: 16, padding: '16px 18px', border: '1px solid var(--nx-border, #30363d)', borderRadius: 10, background: 'var(--nx-panel, #161b22)' };
const noticeHeading = { margin: 0, fontSize: 16 };
const noticeText = { margin: '7px 0 0', color: 'var(--nx-text-2, #8b949e)', fontSize: 13, lineHeight: 1.6 };
