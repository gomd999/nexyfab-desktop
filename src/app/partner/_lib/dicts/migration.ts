// One-time legacy → NexySys SSO migration banner.
//
// Surfaced from the partner layout to every partner page so legacy
// access-code partners see a single nudge to upgrade. The banner
// self-snoozes for 7 days when dismissed.

import type { PartnerLang } from '../partnerLang';

export interface MigrationDict {
  kicker: string;
  title: string;
  body: string;
  cta: string;
  dismiss: string;
}

const KO: MigrationDict = {
  kicker: '권장 업그레이드',
  title: 'NexySys 통합 계정으로 전환할 시간입니다',
  body: '액세스 코드 로그인은 곧 폐지됩니다. 한 번의 클릭으로 NexySys 계정에 연결하세요.',
  cta: '지금 SSO로 업그레이드',
  dismiss: '7일 뒤에 다시 보기',
};

const EN: MigrationDict = {
  kicker: 'Recommended upgrade',
  title: 'Time to switch to your NexySys unified account',
  body: 'Access-code login is being phased out. Link to your NexySys account in one click.',
  cta: 'Upgrade to SSO now',
  dismiss: 'Remind me in 7 days',
};

const JA: MigrationDict = {
  ...EN,
  kicker: '推奨アップグレード',
  title: 'NexySys 統合アカウントへの切り替え時期です',
  body: 'アクセスコードログインは段階的に廃止されます。ワンクリックで NexySys アカウントに連携してください。',
  cta: '今すぐ SSO にアップグレード',
  dismiss: '7日後にもう一度通知',
};

const CN: MigrationDict = {
  ...EN,
  kicker: '推荐升级',
  title: '是时候切换到 NexySys 统一账户了',
  body: '访问码登录即将停用。一键关联到您的 NexySys 账户。',
  cta: '立即升级到 SSO',
  dismiss: '7天后再提醒',
};

const ES: MigrationDict = {
  ...EN,
  kicker: 'Actualización recomendada',
  title: 'Es momento de cambiar a tu cuenta unificada NexySys',
  body: 'El inicio de sesión con código de acceso se va a retirar. Vincúlalo a NexySys con un clic.',
  cta: 'Actualizar a SSO ahora',
  dismiss: 'Recordar en 7 días',
};

const AR: MigrationDict = {
  ...EN,
  kicker: 'ترقية موصى بها',
  title: 'حان وقت التبديل إلى حساب NexySys الموحد',
  body: 'سيتم إيقاف تسجيل الدخول برمز الوصول قريبًا. اربط حساب NexySys بنقرة واحدة.',
  cta: 'الترقية إلى SSO الآن',
  dismiss: 'تذكيري بعد 7 أيام',
};

export function migrationDict(lang: PartnerLang): MigrationDict {
  switch (lang) {
    case 'ko': return KO;
    case 'en': return EN;
    case 'ja': return JA;
    case 'cn': return CN;
    case 'es': return ES;
    case 'ar': return AR;
    default:   return EN;
  }
}
