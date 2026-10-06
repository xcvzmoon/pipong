import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from '../src/env.ts';

describe('database configuration', () => {
  it('validates each connection setting without exposing credentials', () => {
    expect(
      parseDatabaseUrl({ DATABASE_URL: 'postgres://api:secret@localhost/pipong' }, 'DATABASE_URL'),
    ).toBe('postgres://api:secret@localhost/pipong');
    expect(() => parseDatabaseUrl({}, 'DATABASE_URL')).toThrow(
      'DATABASE_CONFIG_INVALID: invalid DATABASE_URL',
    );
    expect(() =>
      parseDatabaseUrl(
        { MIGRATION_DATABASE_URL: 'https://user:secret@localhost/pipong' },
        'MIGRATION_DATABASE_URL',
      ),
    ).toThrow('DATABASE_CONFIG_INVALID: invalid MIGRATION_DATABASE_URL');
  });
  it('rejects an invalid environment name', () => {
    expect(() =>
      parseDatabaseUrl(
        { NODE_ENV: 'prod', DATABASE_URL: 'postgres://api@localhost/pipong' },
        'DATABASE_URL',
      ),
    ).toThrow('DATABASE_CONFIG_INVALID');
  });
  it('keeps production database TLS requirements', () => {
    expect(() =>
      parseDatabaseUrl(
        { NODE_ENV: 'production', DATABASE_URL: 'postgres://api:secret@remote/pipong' },
        'DATABASE_URL',
      ),
    ).toThrow('DATABASE_CONFIG_INVALID');
    expect(
      parseDatabaseUrl(
        {
          NODE_ENV: 'production',
          DATABASE_URL: 'postgres://api:secret@remote/pipong?sslmode=verify-full',
        },
        'DATABASE_URL',
      ),
    ).toContain('sslmode=verify-full');
  });
});
