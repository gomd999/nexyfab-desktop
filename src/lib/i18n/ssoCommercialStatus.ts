import { toIsoLang, type IsoLang } from './normalize';

export const SSO_COMMERCIAL_STATUS = 'hold' as const;
export const SSO_ACTIVATION_AVAILABLE = false as const;

export type SsoCommercialCopy = {
  availabilityBadge: string;
  pricingDisclosure: string;
  unavailableTitle: string;
  unavailableDescription: string;
  contactEnterprise: string;
  settingsTitle: string;
  settingsSubtitle: string;
  metadataBannerTitle: string;
  metadataBannerDescription: string;
  statusLabel: string;
  metadataSectionTitle: string;
  saveMetadata: string;
  auditDescription: string;
  sharedTeamBoms: string;
  teamRoleManagement: string;
  enterpriseSsoFeature: string;
  dedicatedDeploymentFeature: string;
  slaFeature: string;
};

const COPY: Record<IsoLang, SsoCommercialCopy> = {
  ko: {
    availabilityBadge: '출시 전 · 별도 Enterprise 계약',
    pricingDisclosure: 'SSO(SAML/OIDC)는 현재 제공되지 않습니다. 보안 검증 완료 후 별도 Enterprise 계약 범위로만 도입될 예정입니다.',
    unavailableTitle: 'SSO는 현재 사용할 수 없습니다',
    unavailableDescription: 'Team 또는 Enterprise 플랜만으로 SSO가 활성화되지 않습니다. 보안 검증 완료 후 별도 계약으로 제공할 예정입니다.',
    contactEnterprise: 'Enterprise 도입 문의',
    settingsTitle: 'SSO 메타데이터 준비',
    settingsSubtitle: 'SAML/OIDC 로그인은 현재 비활성화되어 있습니다.',
    metadataBannerTitle: '상용 SSO 출시 전',
    metadataBannerDescription: '여기서는 비활성 메타데이터만 미리 저장할 수 있습니다. 로그인, 연결 테스트 및 활성화는 지원하지 않습니다.',
    statusLabel: '사용 불가 · 메타데이터 준비만 가능',
    metadataSectionTitle: 'Provider 메타데이터 준비',
    saveMetadata: '비활성 메타데이터 저장',
    auditDescription: '일반 감사 로그를 확인합니다. SSO 로그인 이벤트는 아직 생성되지 않습니다.',
    sharedTeamBoms: '팀 공유 BOM',
    teamRoleManagement: '팀원 역할 관리',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — 출시 전, 별도 계약',
    dedicatedDeploymentFeature: '전용 배포 — 계약 범위에 따라 제공',
    slaFeature: 'SLA — 서면 계약 시에만 적용',
  },
  en: {
    availabilityBadge: 'Coming soon · Separate Enterprise contract',
    pricingDisclosure: 'SSO (SAML/OIDC) is not currently available. It is planned only under a separate Enterprise contract after security validation.',
    unavailableTitle: 'SSO is not currently available',
    unavailableDescription: 'A Team or Enterprise plan does not enable SSO. It is planned as a separate contract after security validation.',
    contactEnterprise: 'Contact Enterprise',
    settingsTitle: 'SSO metadata staging',
    settingsSubtitle: 'SAML/OIDC sign-in is currently disabled.',
    metadataBannerTitle: 'Commercial SSO is not yet released',
    metadataBannerDescription: 'You may stage disabled metadata only. Sign-in, connection testing, and activation are not supported.',
    statusLabel: 'Unavailable · Metadata staging only',
    metadataSectionTitle: 'Stage provider metadata',
    saveMetadata: 'Save disabled metadata',
    auditDescription: 'View general audit logs. SSO sign-in events are not generated yet.',
    sharedTeamBoms: 'Shared team BOMs',
    teamRoleManagement: 'Team member role management',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — coming soon, separate contract',
    dedicatedDeploymentFeature: 'Dedicated deployment — contract-dependent',
    slaFeature: 'SLA — written contract only',
  },
  ja: {
    availabilityBadge: '提供開始前・Enterprise別契約',
    pricingDisclosure: 'SSO（SAML/OIDC）は現在提供していません。セキュリティ検証完了後、Enterpriseの別契約範囲でのみ提供予定です。',
    unavailableTitle: 'SSOは現在利用できません',
    unavailableDescription: 'TeamまたはEnterpriseプランだけではSSOは有効になりません。セキュリティ検証完了後、別契約で提供予定です。',
    contactEnterprise: 'Enterprise導入について問い合わせ',
    settingsTitle: 'SSOメタデータ準備',
    settingsSubtitle: 'SAML/OIDCログインは現在無効です。',
    metadataBannerTitle: '商用SSOは提供開始前です',
    metadataBannerDescription: '無効なメタデータのみ事前保存できます。ログイン、接続テスト、有効化には対応していません。',
    statusLabel: '利用不可・メタデータ準備のみ',
    metadataSectionTitle: 'プロバイダーメタデータ準備',
    saveMetadata: '無効なメタデータを保存',
    auditDescription: '一般監査ログを表示します。SSOログインイベントはまだ生成されません。',
    sharedTeamBoms: 'チーム共有BOM',
    teamRoleManagement: 'メンバー権限管理',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — 提供開始前・別契約',
    dedicatedDeploymentFeature: '専用環境 — 契約内容による',
    slaFeature: 'SLA — 書面契約時のみ',
  },
  zh: {
    availabilityBadge: '尚未推出 · 需单独签订 Enterprise 合同',
    pricingDisclosure: 'SSO（SAML/OIDC）目前尚未提供。完成安全验证后，仅计划通过单独的 Enterprise 合同提供。',
    unavailableTitle: 'SSO 当前不可用',
    unavailableDescription: 'Team 或 Enterprise 方案本身不会启用 SSO。完成安全验证后，计划通过单独合同提供。',
    contactEnterprise: '咨询 Enterprise 部署',
    settingsTitle: 'SSO 元数据准备',
    settingsSubtitle: 'SAML/OIDC 登录当前已禁用。',
    metadataBannerTitle: '商业 SSO 尚未发布',
    metadataBannerDescription: '目前只能预存禁用状态的元数据，不支持登录、连接测试或启用。',
    statusLabel: '不可用 · 仅可准备元数据',
    metadataSectionTitle: '准备提供商元数据',
    saveMetadata: '保存禁用的元数据',
    auditDescription: '查看常规审计日志。当前不会生成 SSO 登录事件。',
    sharedTeamBoms: '团队共享 BOM',
    teamRoleManagement: '团队成员角色管理',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — 尚未推出，需单独合同',
    dedicatedDeploymentFeature: '专用部署 — 取决于合同范围',
    slaFeature: 'SLA — 仅以书面合同为准',
  },
  es: {
    availabilityBadge: 'Próximamente · Contrato Enterprise separado',
    pricingDisclosure: 'SSO (SAML/OIDC) no está disponible actualmente. Se prevé ofrecerlo solo mediante un contrato Enterprise separado tras la validación de seguridad.',
    unavailableTitle: 'SSO no está disponible actualmente',
    unavailableDescription: 'Los planes Team o Enterprise no habilitan SSO por sí solos. Se prevé ofrecerlo mediante un contrato separado tras la validación de seguridad.',
    contactEnterprise: 'Consultar implantación Enterprise',
    settingsTitle: 'Preparación de metadatos SSO',
    settingsSubtitle: 'El inicio de sesión SAML/OIDC está deshabilitado actualmente.',
    metadataBannerTitle: 'SSO comercial aún no disponible',
    metadataBannerDescription: 'Solo se pueden guardar metadatos deshabilitados. El inicio de sesión, las pruebas de conexión y la activación no están disponibles.',
    statusLabel: 'No disponible · Solo preparación de metadatos',
    metadataSectionTitle: 'Preparar metadatos del proveedor',
    saveMetadata: 'Guardar metadatos deshabilitados',
    auditDescription: 'Consulta los registros generales. Aún no se generan eventos de inicio de sesión SSO.',
    sharedTeamBoms: 'BOM compartidas del equipo',
    teamRoleManagement: 'Gestión de roles del equipo',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — próximamente, contrato separado',
    dedicatedDeploymentFeature: 'Despliegue dedicado — sujeto a contrato',
    slaFeature: 'SLA — solo mediante contrato escrito',
  },
  ar: {
    availabilityBadge: 'قريبًا · عقد Enterprise منفصل',
    pricingDisclosure: 'خدمة SSO ‏(SAML/OIDC) غير متاحة حاليًا. من المخطط توفيرها فقط ضمن عقد Enterprise منفصل بعد اكتمال التحقق الأمني.',
    unavailableTitle: 'خدمة SSO غير متاحة حاليًا',
    unavailableDescription: 'لا تؤدي خطة Team أو Enterprise وحدها إلى تفعيل SSO. من المخطط توفيرها بعقد منفصل بعد التحقق الأمني.',
    contactEnterprise: 'تواصل بشأن تطبيق Enterprise',
    settingsTitle: 'إعداد بيانات SSO الوصفية',
    settingsSubtitle: 'تسجيل الدخول عبر SAML/OIDC معطل حاليًا.',
    metadataBannerTitle: 'خدمة SSO التجارية لم تُطرح بعد',
    metadataBannerDescription: 'يمكن حفظ بيانات وصفية معطلة فقط. تسجيل الدخول واختبار الاتصال والتفعيل غير مدعومة.',
    statusLabel: 'غير متاح · إعداد البيانات الوصفية فقط',
    metadataSectionTitle: 'إعداد بيانات موفر الهوية',
    saveMetadata: 'حفظ البيانات الوصفية المعطلة',
    auditDescription: 'اعرض سجلات التدقيق العامة. لا يتم إنشاء أحداث تسجيل دخول SSO بعد.',
    sharedTeamBoms: 'قوائم BOM مشتركة للفريق',
    teamRoleManagement: 'إدارة أدوار أعضاء الفريق',
    enterpriseSsoFeature: 'SSO / SAML / OIDC — قريبًا، بعقد منفصل',
    dedicatedDeploymentFeature: 'نشر مخصص — حسب نطاق العقد',
    slaFeature: 'SLA — بعقد مكتوب فقط',
  },
};

export function getSsoCommercialCopy(lang: string | undefined | null): SsoCommercialCopy {
  return COPY[toIsoLang(lang)];
}

export function isSsoIncludedInPlan(_plan: 'free' | 'pro' | 'team' | 'enterprise'): false {
  return false;
}
