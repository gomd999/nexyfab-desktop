import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  suppress: vi.fn(),
}));

vi.mock('@/lib/aws-sns-signature', () => ({
  configuredSnsTopicArns: () => (process.env.AWS_SES_SNS_TOPIC_ARNS ?? '').split(',').filter(Boolean),
  isTrustedSnsActionUrl: (value: string) => value.startsWith('https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription'),
  verifySnsSignature: mocks.verify,
}));
vi.mock('@/lib/email-suppression', () => ({ suppressEmail: mocks.suppress }));

import { POST } from './route';

const topic = 'arn:aws:sns:ap-northeast-2:123456789012:ses-events';
const request = (body: unknown, headers: Record<string, string> = {}) => new NextRequest(
  'https://nexyfab.com/api/nexyfab/ses-notifications',
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) },
);
const rawRequest = (body: BodyInit, headers: Record<string, string> = {}) => new NextRequest(
  'https://nexyfab.com/api/nexyfab/ses-notifications',
  { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body },
);
const streamedRequest = (body: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => new NextRequest(
  'https://nexyfab.com/api/nexyfab/ses-notifications',
  {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, duplex: 'half',
  } as unknown as NonNullable<ConstructorParameters<typeof NextRequest>[1]>,
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AWS_SES_SNS_TOPIC_ARNS', topic);
  mocks.verify.mockResolvedValue(true);
  mocks.suppress.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe('SES SNS ingress', () => {
  it('rejects a message whose SNS signature is invalid', async () => {
    mocks.verify.mockResolvedValue(false);
    const response = await POST(request({ Type: 'Notification', TopicArn: topic, Message: '{}' }));
    expect(response.status).toBe(401);
    expect(mocks.suppress).not.toHaveBeenCalled();
  });

  it('rejects a validly shaped message from a non-allowlisted topic', async () => {
    const response = await POST(request({ Type: 'Notification', TopicArn: `${topic}-attacker`, Message: '{}' }));
    expect(response.status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('suppresses recipients only after a verified permanent bounce', async () => {
    const response = await POST(request({
      Type: 'Notification',
      TopicArn: topic,
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: { bounceType: 'Permanent', bounceSubType: 'General', bouncedRecipients: [{ emailAddress: 'bad@example.com' }] },
      }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.suppress).toHaveBeenCalledWith('bad@example.com', 'bounce', 'General');
  });

  it('rejects an oversized declared body before signature work', async () => {
    const response = await POST(request(
      { Type: 'Notification', TopicArn: topic, Message: '{}' },
      { 'content-length': String(256 * 1024 + 1) },
    ));
    expect(response.status).toBe(413);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it('does not trust false-small Content-Length and cancels actual overflow', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x7b]));
        controller.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() { cancelled = true; },
    });
    const response = await POST(streamedRequest(stream, { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.suppress).not.toHaveBeenCalled();
  });

  it('rejects invalid UTF-8 before signature or suppression work', async () => {
    const response = await POST(rawRequest(new Uint8Array([0xff])));
    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.suppress).not.toHaveBeenCalled();
  });
});
