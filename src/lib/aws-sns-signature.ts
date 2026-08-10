import { createVerify, X509Certificate } from 'node:crypto';

export interface SnsEnvelope {
  Type?: string;
  Message?: string;
  MessageId?: string;
  Subject?: string;
  Timestamp?: string;
  TopicArn?: string;
  Token?: string;
  SubscribeURL?: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
}

const CERT_MAX_BYTES = 64 * 1024;
const CERT_CACHE_LIMIT = 16;
const CERT_CACHE_MS = 6 * 60 * 60_000;
const certificateCache = new Map<string, { pem: string; expiresAt: number }>();

function isTrustedSnsHostname(hostname: string): boolean {
  return hostname === 'sns.amazonaws.com'
    || /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/i.test(hostname);
}

export function isTrustedSnsCertUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && isTrustedSnsHostname(url.hostname)
      && /^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname)
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

export function isTrustedSnsActionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && isTrustedSnsHostname(url.hostname)
      && url.pathname === '/'
      && url.searchParams.get('Action') === 'ConfirmSubscription';
  } catch {
    return false;
  }
}

export function buildSnsCanonicalMessage(envelope: SnsEnvelope): string | null {
  const fields = envelope.Type === 'Notification'
    ? ['Message', 'MessageId', ...(envelope.Subject === undefined ? [] : ['Subject']), 'Timestamp', 'TopicArn', 'Type']
    : envelope.Type === 'SubscriptionConfirmation' || envelope.Type === 'UnsubscribeConfirmation'
      ? ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
      : null;
  if (!fields) return null;

  const values = fields.map(field => envelope[field as keyof SnsEnvelope]);
  if (values.some(value => typeof value !== 'string')) return null;
  return fields.map((field, index) => `${field}\n${values[index]}\n`).join('');
}

async function loadCertificate(url: string): Promise<string | null> {
  const cached = certificateCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.pem;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { accept: 'application/x-pem-file,text/plain' },
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > CERT_MAX_BYTES) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > CERT_MAX_BYTES) return null;
    const pem = new TextDecoder().decode(bytes);
    const certificate = new X509Certificate(pem);
    const now = Date.now();
    if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) return null;

    if (certificateCache.size >= CERT_CACHE_LIMIT) {
      certificateCache.delete(certificateCache.keys().next().value as string);
    }
    certificateCache.set(url, { pem, expiresAt: Math.min(now + CERT_CACHE_MS, Date.parse(certificate.validTo)) });
    return pem;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifySnsSignature(envelope: SnsEnvelope): Promise<boolean> {
  const canonical = buildSnsCanonicalMessage(envelope);
  if (!canonical || !envelope.Signature || !envelope.SigningCertURL) return false;
  if (!isTrustedSnsCertUrl(envelope.SigningCertURL)) return false;
  if (envelope.SignatureVersion !== '1' && envelope.SignatureVersion !== '2') return false;

  const certificate = await loadCertificate(envelope.SigningCertURL);
  if (!certificate) return false;
  try {
    const verifier = createVerify(envelope.SignatureVersion === '1' ? 'RSA-SHA1' : 'RSA-SHA256');
    verifier.update(canonical, 'utf8');
    verifier.end();
    return verifier.verify(certificate, envelope.Signature, 'base64');
  } catch {
    return false;
  }
}

export function configuredSnsTopicArns(): string[] {
  return (process.env.AWS_SES_SNS_TOPIC_ARNS ?? process.env.AWS_SNS_TOPIC_ARNS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}
