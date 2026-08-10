import { describe, expect, it } from 'vitest';
import {
  buildSnsCanonicalMessage,
  isTrustedSnsActionUrl,
  isTrustedSnsCertUrl,
} from './aws-sns-signature';

describe('AWS SNS signature boundary', () => {
  it('builds the AWS canonical Notification message in documented field order', () => {
    expect(buildSnsCanonicalMessage({
      Type: 'Notification',
      Message: 'payload',
      MessageId: 'message-id',
      Subject: 'subject',
      Timestamp: '2026-08-10T00:00:00.000Z',
      TopicArn: 'arn:aws:sns:ap-northeast-2:123:ses',
    })).toBe('Message\npayload\nMessageId\nmessage-id\nSubject\nsubject\nTimestamp\n2026-08-10T00:00:00.000Z\nTopicArn\narn:aws:sns:ap-northeast-2:123:ses\nType\nNotification\n');
  });

  it('rejects incomplete or unknown message types', () => {
    expect(buildSnsCanonicalMessage({ Type: 'Notification' })).toBeNull();
    expect(buildSnsCanonicalMessage({ Type: 'Other' })).toBeNull();
  });

  it('allows only the fixed AWS SNS certificate origin and filename', () => {
    expect(isTrustedSnsCertUrl('https://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-abc_123.pem')).toBe(true);
    expect(isTrustedSnsCertUrl('https://sns.cn-north-1.amazonaws.com.cn/SimpleNotificationService-abc.pem')).toBe(true);
    expect(isTrustedSnsCertUrl('https://sns.amazonaws.com.evil.test/SimpleNotificationService-abc.pem')).toBe(false);
    expect(isTrustedSnsCertUrl('https://sns.ap-northeast-2.amazonaws.com/other.pem')).toBe(false);
    expect(isTrustedSnsCertUrl('http://sns.ap-northeast-2.amazonaws.com/SimpleNotificationService-abc.pem')).toBe(false);
  });

  it('allows confirmation fetches only to the SNS action endpoint', () => {
    expect(isTrustedSnsActionUrl('https://sns.ap-northeast-2.amazonaws.com/?Action=ConfirmSubscription&Token=x')).toBe(true);
    expect(isTrustedSnsActionUrl('https://sns.ap-northeast-2.amazonaws.com/admin?Action=ConfirmSubscription')).toBe(false);
    expect(isTrustedSnsActionUrl('https://sns.amazonaws.com.evil.test/?Action=ConfirmSubscription')).toBe(false);
  });
});
