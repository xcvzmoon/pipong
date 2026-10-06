import { describe, expect, it } from 'vitest';
import { renderAuthMail } from '../src/mail/render.ts';

describe('auth email rendering', () => {
  it('escapes recipient data and URLs in HTML while retaining plain text', () => {
    const mail = renderAuthMail({
      kind: 'verification',
      to: 'recipient@example.com',
      name: '<script>alert("test")</script>',
      url: 'https://example.com/verify?token=secret&callback=home',
      expiresAt: Date.now() + 60_000,
    });

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('secret&amp;callback');
    expect(mail.text).toContain('<script>alert("test")</script>');
    expect(mail.text).toContain('secret&callback');
  });

  it.each([
    ['reset', 'Reset your Pipong password'],
    ['invitation', 'You have been invited to a Pipong organization'],
    ['verification', 'Verify your Pipong email'],
  ] as const)('renders the %s action consistently', (kind, subject) => {
    const mail = renderAuthMail({
      kind,
      to: 'recipient@example.com',
      name: 'Recipient',
      url: 'https://example.com/action',
      expiresAt: Date.now() + 60_000,
    });

    expect(mail.subject).toBe(subject);
    expect(mail.html).toContain(subject);
    expect(mail.text).toContain(subject);
  });
});
