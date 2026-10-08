import { ConfigError, parseApiConfig, parseWorkerConfig } from '@pipong/shared';
import { describe, expect, it } from 'vitest';

const validApiEnvironment = {
  AUTH_BASE_URL: 'https://notify.example.com',
  AUTH_SECRET: 'test-secret-that-must-not-appear-and-is-long-enough',
  CREDENTIAL_KEYRING_REF: '/run/secrets/credential-keyring.json',
};

describe('runtime configuration', () => {
  it('reports missing required secrets without including their values', () => {
    expect(() => parseApiConfig({ AUTH_BASE_URL: validApiEnvironment.AUTH_BASE_URL })).toThrow(
      expect.objectContaining({ code: 'API_CONFIG_INVALID' }),
    );
  });

  it('rejects non-canonical authentication URLs', () => {
    for (const authBaseUrl of [
      'https://user:password@example.com/login',
      'ftp://localhost',
      'http://notify.example.com',
      'https://[malformed',
    ]) {
      expect(() => parseApiConfig({ ...validApiEnvironment, AUTH_BASE_URL: authBaseUrl })).toThrow(
        expect.objectContaining({ code: 'API_CONFIG_INVALID' }),
      );
    }
    expect(
      parseApiConfig({ ...validApiEnvironment, AUTH_BASE_URL: 'http://localhost:3000' })
        .authBaseUrl,
    ).toBe('http://localhost:3000');
    expect(parseApiConfig(validApiEnvironment).authBaseUrl).toBe('https://notify.example.com');
  });

  it('requires a sufficiently long authentication secret', () => {
    expect(() => parseApiConfig({ ...validApiEnvironment, AUTH_SECRET: 'short' })).toThrow(
      expect.objectContaining({ code: 'API_CONFIG_INVALID' }),
    );
  });

  it('validates provider settings', () => {
    expect(() =>
      parseApiConfig({ ...validApiEnvironment, CREDENTIAL_KEYRING_REF: 'vault://unsupported' }),
    ).toThrow(expect.objectContaining({ code: 'API_CONFIG_INVALID' }));
    expect(() => parseWorkerConfig({ CREDENTIAL_KEYRING_REF: 'relative-keyring.json' })).toThrow(
      expect.objectContaining({ code: 'WORKER_CONFIG_INVALID' }),
    );

    const workerBase = { CREDENTIAL_KEYRING_REF: '/run/secrets/credential-keyring.json' };
    expect(parseWorkerConfig(workerBase).apnsEnvironment).toBe('production');
    expect(parseWorkerConfig({ ...workerBase, FCM_PROJECT_ID: ' project-123 ' }).fcmProjectId).toBe(
      'project-123',
    );
    expect(() => parseWorkerConfig({ ...workerBase, APNS_ENVIRONMENT: 'testing' })).toThrow(
      expect.objectContaining({ code: 'WORKER_CONFIG_INVALID' }),
    );
    for (const webPushSubject of [
      'not-a-subject',
      'mailto:not-an-email',
      'ftp://example.com/contact',
      'https://user:password@example.com/contact',
      'https://example.com/contact#fragment',
      'https://[malformed',
    ]) {
      expect(() => parseWorkerConfig({ ...workerBase, WEB_PUSH_SUBJECT: webPushSubject })).toThrow(
        expect.objectContaining({ code: 'WORKER_CONFIG_INVALID' }),
      );
    }
    expect(
      parseWorkerConfig({ ...workerBase, WEB_PUSH_SUBJECT: 'mailto:ops@example.com' })
        .webPushSubject,
    ).toBe('mailto:ops@example.com');
    expect(
      parseWorkerConfig({ ...workerBase, WEB_PUSH_SUBJECT: 'https://example.com/contact' })
        .webPushSubject,
    ).toBe('https://example.com/contact');
  });

  it('applies environment overrides and keeps errors redacted', () => {
    const apiConfig = parseApiConfig({
      ...validApiEnvironment,
    });
    const workerConfig = parseWorkerConfig({
      CREDENTIAL_KEYRING_REF: '/run/secrets/credential-keyring.json',
      APNS_ENVIRONMENT: 'sandbox',
    });

    expect(apiConfig.authBaseUrl).toBe(validApiEnvironment.AUTH_BASE_URL);
    expect(workerConfig.apnsEnvironment).toBe('sandbox');

    expect(() => {
      parseApiConfig({
        ...validApiEnvironment,
        AUTH_SECRET: 'sensitive-value-that-is-long-enough-to-pass-validation',
        AUTH_BASE_URL: 'invalid',
      });
    }).toThrow(expect.objectContaining({ code: 'API_CONFIG_INVALID' }));
    try {
      parseApiConfig({
        ...validApiEnvironment,
        AUTH_SECRET: 'sensitive-value-that-is-long-enough-to-pass-validation',
        AUTH_BASE_URL: 'invalid',
      });
      throw new Error('expected invalid configuration to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(error).toMatchObject({ code: 'API_CONFIG_INVALID' });
      expect(error).not.toHaveProperty('issues');
      expect(String(error)).not.toContain('sensitive-value-that-is-long-enough-to-pass-validation');
    }
  });
});
