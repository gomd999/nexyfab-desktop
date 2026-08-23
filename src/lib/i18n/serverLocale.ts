import { toIsoLang, toRouteLang, type IsoLang, type RouteLang } from './normalize';

export type ServerLocale = {
  route: RouteLang;
  iso: IsoLang;
  languageName: string;
};

const LANGUAGE_NAMES: Record<RouteLang, string> = {
  kr: 'Korean',
  en: 'English',
  ja: 'Japanese',
  cn: 'Simplified Chinese',
  es: 'Spanish',
  ar: 'Arabic',
};

/** Accept route, ISO, and regional browser locale spellings. */
const LOCALE_ALIASES: Record<string, RouteLang> = {
  kr: 'kr', ko: 'kr', 'ko-kr': 'kr',
  jp: 'ja',
  en: 'en', 'en-us': 'en', 'en-gb': 'en',
  ja: 'ja', 'ja-jp': 'ja',
  cn: 'cn', zh: 'cn', 'zh-cn': 'cn', 'zh-hans': 'cn',
  es: 'es', 'es-es': 'es', 'es-mx': 'es',
  ar: 'ar', 'ar-sa': 'ar', 'ar-eg': 'ar',
};

function parseLocale(value: unknown): RouteLang | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === '*') return null;
  const exact = LOCALE_ALIASES[normalized];
  if (exact) return exact;
  const base = normalized.split('-')[0];
  return LOCALE_ALIASES[base] ?? null;
}

function acceptLanguageCandidates(value: string | null): string[] {
  if (!value) return [];
  return value.split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find(param => param.trim().toLowerCase().startsWith('q='));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag, q: Number.isFinite(q) ? q : 0, index };
    })
    .filter(item => item.q > 0 && item.tag !== '*')
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(item => item.tag);
}

export function resolveServerLocale(
  request: Pick<Request, 'headers'>,
  requested?: unknown,
  fallback: RouteLang = 'en',
): ServerLocale {
  const route = parseLocale(requested)
    ?? acceptLanguageCandidates(request.headers.get('accept-language'))
      .map(parseLocale)
      .find((value): value is RouteLang => value !== null)
    ?? toRouteLang(fallback);
  return { route, iso: toIsoLang(route), languageName: LANGUAGE_NAMES[route] };
}

export type LocalizedApiMessageKey =
  | 'rateLimited'
  | 'messageRequired'
  | 'quotaUnavailable'
  | 'quotaReached'
  | 'costBudget'
  | 'planLimit'
  | 'breaker'
  | 'providerNotConfigured'
  | 'providerFailed'
  | 'badRequest'
  | 'promptRequired'
  | 'promptTooLong'
  | 'planUpgrade'
  | 'unknownModel'
  | 'guestLimit'
  | 'visionNotConfigured'
  | 'visionBusy'
  | 'visionFailed'
  | 'invalidAiResponse'
  | 'unsupportedShape'
  | 'invalidAssembly'
  | 'invalidSketch'
  | 'converterRejected'
  | 'freeformSummary'
  | 'unauthorized'
  | 'forbidden';

type MessageVars = { limit?: number | string | null };

const API_MESSAGES: Record<RouteLang, Record<LocalizedApiMessageKey, string | ((vars: MessageVars) => string)>> = {
  kr: {
    rateLimited: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    messageRequired: '메시지가 필요합니다.',
    quotaUnavailable: '게스트 AI 할당량 서비스를 일시적으로 사용할 수 없습니다. 로그인하거나 잠시 후 다시 시도해 주세요.',
    quotaReached: (v) => `게스트 일일 AI 설계 한도(${v.limit ?? ''})에 도달했습니다. 계속하려면 로그인해 주세요.`,
    costBudget: (v) => `오늘의 AI 사용 한도($${v.limit ?? ''})에 도달했습니다. 내일 다시 이용할 수 있습니다.`,
    planLimit: (v) => `무료 플랜의 월 한도(${v.limit ?? ''}회)에 도달했습니다. Pro로 업그레이드하면 무제한으로 이용할 수 있습니다.`,
    breaker: 'AI가 일시적으로 중지되었습니다. 잠시 후 다시 시도해 주세요.',
    providerNotConfigured: 'AI 제공자가 설정되지 않았습니다.',
    providerFailed: 'AI 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    badRequest: '잘못된 요청입니다.',
    promptRequired: '프롬프트 또는 이미지가 필요합니다.',
    promptTooLong: '프롬프트가 너무 깁니다(최대 4000자).',
    planUpgrade: '이 AI 모델을 사용하려면 플랜을 업그레이드해야 합니다.',
    unknownModel: '알 수 없는 AI 모델입니다.',
    guestLimit: '무료 디자인을 사용했습니다. 계속하려면 무료로 로그인해 주세요.',
    visionNotConfigured: '이미지 분석 AI가 설정되지 않았습니다.',
    visionBusy: '이미지 분석이 현재 혼잡합니다. 잠시 후 다시 시도해 주세요.',
    visionFailed: '이미지를 이해하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    invalidAiResponse: 'AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.',
    unsupportedShape: 'AI가 지원되지 않는 형상을 선택했습니다.',
    invalidAssembly: '조립체에는 유효한 부품이 두 개 이상 필요합니다.',
    invalidSketch: '스케치에는 세 개 이상의 프로필 점이 필요합니다.',
    converterRejected: '요청한 형상을 생성할 수 없습니다.',
    freeformSummary: '자유 형식 OpenSCAD',
    unauthorized: '로그인이 필요합니다.',
    forbidden: '접근 권한이 없습니다.',
  },
  en: {
    rateLimited: 'Too many requests. Please try again shortly.',
    messageRequired: 'A message is required.',
    quotaUnavailable: 'The guest AI quota service is temporarily unavailable. Sign in or retry shortly.',
    quotaReached: (v) => `The guest daily AI design limit (${v.limit ?? ''}) has been reached. Sign in to continue.`,
    costBudget: (v) => `The daily AI spend limit ($${v.limit ?? ''}) has been reached. Please try again tomorrow.`,
    planLimit: (v) => `The monthly free-plan limit (${v.limit ?? ''} uses) has been reached. Upgrade to Pro to continue.`,
    breaker: 'AI is temporarily paused. Please try again later.',
    providerNotConfigured: 'The AI provider is not configured.',
    providerFailed: 'The AI request failed. Please try again later.',
    badRequest: 'Bad request.',
    promptRequired: 'A prompt or image is required.',
    promptTooLong: 'The prompt is too long (maximum 4000 characters).',
    planUpgrade: 'Upgrade your plan to use this AI model.',
    unknownModel: 'Unknown AI model.',
    guestLimit: 'Your free design has been used. Sign in for free to continue designing.',
    visionNotConfigured: 'No vision AI provider is configured.',
    visionBusy: 'Image analysis is busy right now. Please try again in a moment.',
    visionFailed: 'Image understanding failed. Please try again later.',
    invalidAiResponse: 'The AI response format is invalid. Please try again.',
    unsupportedShape: 'The AI selected an unsupported shape.',
    invalidAssembly: 'An assembly needs at least two valid parts.',
    invalidSketch: 'A sketch needs at least three profile points.',
    converterRejected: 'The requested shape could not be generated.',
    freeformSummary: 'Free-form OpenSCAD',
    unauthorized: 'Authentication is required.',
    forbidden: 'You do not have permission to access this resource.',
  },
  ja: {
    rateLimited: 'リクエストが多すぎます。しばらくしてからもう一度お試しください。',
    messageRequired: 'メッセージが必要です。',
    quotaUnavailable: 'ゲストAIクォータサービスは一時的に利用できません。ログインするか、しばらくしてから再試行してください。',
    quotaReached: (v) => `ゲストの1日あたりのAI設計上限（${v.limit ?? ''}）に達しました。続行するにはログインしてください。`,
    costBudget: (v) => `本日のAI利用上限（$${v.limit ?? ''}）に達しました。明日もう一度お試しください。`,
    planLimit: (v) => `無料プランの月間上限（${v.limit ?? ''}回）に達しました。続行するにはProへアップグレードしてください。`,
    breaker: 'AIは一時停止中です。後でもう一度お試しください。',
    providerNotConfigured: 'AIプロバイダーが設定されていません。',
    providerFailed: 'AIリクエストに失敗しました。後でもう一度お試しください。',
    badRequest: '不正なリクエストです。',
    promptRequired: 'プロンプトまたは画像が必要です。',
    promptTooLong: 'プロンプトが長すぎます（最大4000文字）。',
    planUpgrade: 'このAIモデルを使うにはプランをアップグレードしてください。',
    unknownModel: '不明なAIモデルです。',
    guestLimit: '無料デザインを1回使用しました。続行するには無料でログインしてください。',
    visionNotConfigured: '画像分析AIが設定されていません。',
    visionBusy: '画像分析が混雑しています。しばらくしてから再試行してください。',
    visionFailed: '画像を認識できませんでした。後でもう一度お試しください。',
    invalidAiResponse: 'AI応答の形式が正しくありません。もう一度お試しください。',
    unsupportedShape: 'AIが未対応の形状を選択しました。',
    invalidAssembly: 'アセンブリには有効な部品が2つ以上必要です。',
    invalidSketch: 'スケッチには3つ以上のプロファイル点が必要です。',
    converterRejected: '指定された形状を生成できませんでした。',
    freeformSummary: '自由形式 OpenSCAD',
    unauthorized: 'ログインが必要です。',
    forbidden: 'このリソースへのアクセス権がありません。',
  },
  cn: {
    rateLimited: '请求过多，请稍后再试。',
    messageRequired: '请输入消息。',
    quotaUnavailable: '访客 AI 配额服务暂时不可用，请登录或稍后重试。',
    quotaReached: (v) => `已达到访客每日 AI 设计上限（${v.limit ?? ''}）。请登录后继续。`,
    costBudget: (v) => `已达到今日 AI 使用上限（$${v.limit ?? ''}），请明天再试。`,
    planLimit: (v) => `已达到免费方案月度上限（${v.limit ?? ''} 次），升级 Pro 后即可继续。`,
    breaker: 'AI 暂时已暂停，请稍后再试。',
    providerNotConfigured: 'AI 服务提供商尚未配置。',
    providerFailed: 'AI 请求失败，请稍后再试。',
    badRequest: '请求无效。',
    promptRequired: '请输入提示词或上传图片。',
    promptTooLong: '提示词过长（最多 4000 个字符）。',
    planUpgrade: '请升级方案后使用此 AI 模型。',
    unknownModel: '未知的 AI 模型。',
    guestLimit: '免费设计次数已用完。请免费登录后继续设计。',
    visionNotConfigured: '尚未配置图像分析 AI。',
    visionBusy: '图像分析当前繁忙，请稍后再试。',
    visionFailed: '图像理解失败，请稍后再试。',
    invalidAiResponse: 'AI 响应格式无效，请重试。',
    unsupportedShape: 'AI 选择了不支持的形状。',
    invalidAssembly: '装配体至少需要两个有效部件。',
    invalidSketch: '草图至少需要三个轮廓点。',
    converterRejected: '无法生成请求的形状。',
    freeformSummary: '自由格式 OpenSCAD',
    unauthorized: '需要登录。',
    forbidden: '您没有访问此资源的权限。',
  },
  es: {
    rateLimited: 'Hay demasiadas solicitudes. Inténtalo de nuevo en unos momentos.',
    messageRequired: 'Se requiere un mensaje.',
    quotaUnavailable: 'El servicio de cuota de IA para invitados no está disponible temporalmente. Inicia sesión o vuelve a intentarlo pronto.',
    quotaReached: (v) => `Se alcanzó el límite diario de diseño con IA para invitados (${v.limit ?? ''}). Inicia sesión para continuar.`,
    costBudget: (v) => `Se alcanzó el límite diario de uso de IA ($${v.limit ?? ''}). Inténtalo de nuevo mañana.`,
    planLimit: (v) => `Se alcanzó el límite mensual del plan gratuito (${v.limit ?? ''} usos). Actualiza a Pro para continuar.`,
    breaker: 'La IA está pausada temporalmente. Inténtalo de nuevo más tarde.',
    providerNotConfigured: 'El proveedor de IA no está configurado.',
    providerFailed: 'La solicitud de IA falló. Inténtalo de nuevo más tarde.',
    badRequest: 'Solicitud incorrecta.',
    promptRequired: 'Se requiere un prompt o una imagen.',
    promptTooLong: 'El prompt es demasiado largo (máximo 4000 caracteres).',
    planUpgrade: 'Actualiza tu plan para usar este modelo de IA.',
    unknownModel: 'Modelo de IA desconocido.',
    guestLimit: 'Ya usaste tu diseño gratuito. Inicia sesión gratis para continuar.',
    visionNotConfigured: 'No hay un proveedor de IA visual configurado.',
    visionBusy: 'El análisis de imágenes está ocupado. Inténtalo de nuevo en un momento.',
    visionFailed: 'No se pudo entender la imagen. Inténtalo de nuevo más tarde.',
    invalidAiResponse: 'El formato de respuesta de la IA no es válido. Inténtalo de nuevo.',
    unsupportedShape: 'La IA seleccionó una forma no compatible.',
    invalidAssembly: 'Un ensamblaje necesita al menos dos piezas válidas.',
    invalidSketch: 'Un boceto necesita al menos tres puntos de perfil.',
    converterRejected: 'No se pudo generar la forma solicitada.',
    freeformSummary: 'OpenSCAD de forma libre',
    unauthorized: 'Es necesario iniciar sesión.',
    forbidden: 'No tienes permiso para acceder a este recurso.',
  },
  ar: {
    rateLimited: 'عدد الطلبات كبير جدًا. يُرجى المحاولة مرة أخرى بعد قليل.',
    messageRequired: 'الرسالة مطلوبة.',
    quotaUnavailable: 'خدمة حصة الذكاء الاصطناعي للزوار غير متاحة مؤقتًا. سجّل الدخول أو أعد المحاولة قريبًا.',
    quotaReached: (v) => `تم بلوغ الحد اليومي لتصميم الذكاء الاصطناعي للزوار (${v.limit ?? ''}). سجّل الدخول للمتابعة.`,
    costBudget: (v) => `تم بلوغ حد الإنفاق اليومي للذكاء الاصطناعي ($${v.limit ?? ''}). حاول مرة أخرى غدًا.`,
    planLimit: (v) => `تم بلوغ الحد الشهري للخطة المجانية (${v.limit ?? ''} استخدامًا). قم بالترقية إلى Pro للمتابعة.`,
    breaker: 'تم إيقاف الذكاء الاصطناعي مؤقتًا. حاول مرة أخرى لاحقًا.',
    providerNotConfigured: 'موفر الذكاء الاصطناعي غير مُعد.',
    providerFailed: 'فشل طلب الذكاء الاصطناعي. حاول مرة أخرى لاحقًا.',
    badRequest: 'طلب غير صالح.',
    promptRequired: 'المطلوب هو مطالبة أو صورة.',
    promptTooLong: 'المطالبة طويلة جدًا (الحد الأقصى 4000 حرف).',
    planUpgrade: 'قم بترقية خطتك لاستخدام نموذج الذكاء الاصطناعي هذا.',
    unknownModel: 'نموذج ذكاء اصطناعي غير معروف.',
    guestLimit: 'استخدمت التصميم المجاني. سجّل الدخول مجانًا للمتابعة.',
    visionNotConfigured: 'لم يتم إعداد موفر ذكاء اصطناعي للرؤية.',
    visionBusy: 'تحليل الصور مشغول حاليًا. حاول مرة أخرى بعد قليل.',
    visionFailed: 'فشل فهم الصورة. حاول مرة أخرى لاحقًا.',
    invalidAiResponse: 'تنسيق استجابة الذكاء الاصطناعي غير صالح. حاول مرة أخرى.',
    unsupportedShape: 'اختار الذكاء الاصطناعي شكلاً غير مدعوم.',
    invalidAssembly: 'تحتاج التجميعة إلى جزأين صالحين على الأقل.',
    invalidSketch: 'يحتاج الرسم إلى ثلاث نقاط ملف شخصي على الأقل.',
    converterRejected: 'تعذر إنشاء الشكل المطلوب.',
    freeformSummary: 'OpenSCAD حر',
    unauthorized: 'يجب تسجيل الدخول.',
    forbidden: 'ليس لديك إذن للوصول إلى هذا المورد.',
  },
};

export function localizedApiMessage(
  locale: ServerLocale,
  key: LocalizedApiMessageKey,
  vars: MessageVars = {},
): string {
  const message = API_MESSAGES[locale.route][key];
  return typeof message === 'function' ? message(vars) : message;
}
