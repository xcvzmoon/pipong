import { describe, expect, it } from 'vitest';
import { loadMailConfig } from '../src/mail/config.ts';

const settings = { AUTH_MAIL_FROM: 'auth@example.com', SMTP_HOST: 'smtp.example.com' };

describe('authentication mail configuration', () => {
  it('requires TLS by default and supports implicit TLS', () => {
    expect(loadMailConfig(settings)).toMatchObject({ port: 587, secure: false, requireTLS: true });
    expect(loadMailConfig({ ...settings, SMTP_SECURITY: 'tls', SMTP_PORT: '465' })).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false,
    });
  });

  it('permits plaintext only on loopback', () => {
    expect(
      loadMailConfig({ ...settings, SMTP_HOST: '127.0.0.1', SMTP_SECURITY: 'local' }).requireTLS,
    ).toBe(false);
    expect(() => loadMailConfig({ ...settings, SMTP_SECURITY: 'local' })).toThrow(
      'AUTH_MAIL_CONFIG_INVALID',
    );
  });

  it('validates sender, port, and paired credentials without leaking secrets', () => {
    for (const invalid of [
      { ...settings, AUTH_MAIL_FROM: 'invalid' },
      { ...settings, SMTP_PORT: '0' },
      { ...settings, SMTP_PORT: '65536' },
      { ...settings, SMTP_USER: 'operator' },
      { ...settings, SMTP_PASSWORD: 'secret-password' },
    ]) {
      expect(() => loadMailConfig(invalid)).toThrow('AUTH_MAIL_CONFIG_INVALID');
      expect(() => loadMailConfig(invalid)).not.toThrow('secret-password');
    }
  });
});
