import {
  pgSchema,
  text,
  bigint,
  timestamp,
  boolean,
  integer,
  index,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { generateUuid, generateTimestamps, TIMESTAMP_CONFIG } from '../helpers/index.ts';

export const authSchema = pgSchema('auth');

export const users = authSchema.table('users', {
  id: generateUuid(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
  ...generateTimestamps(),
});

export const sessions = authSchema.table(
  'sessions',
  {
    id: generateUuid(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id'),
    ...generateTimestamps(),
  },
  (table) => [index('session_userId_idx').on(table.userId)],
);

export const accounts = authSchema.table(
  'accounts',
  {
    id: generateUuid(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', TIMESTAMP_CONFIG),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', TIMESTAMP_CONFIG),
    scope: text('scope'),
    password: text('password'),
    ...generateTimestamps(),
  },
  (table) => [index('account_userId_idx').on(table.userId)],
);

export const verifications = authSchema.table(
  'verifications',
  {
    id: generateUuid(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    ...generateTimestamps(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const organizations = authSchema.table(
  'organizations',
  {
    id: generateUuid(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    logo: text('logo'),
    metadata: text('metadata'),
    disabledAt: timestamp('disabled_at', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [uniqueIndex('organization_slug_uidx').on(table.slug)],
);

export const members = authSchema.table(
  'members',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').default('member').notNull(),
    ...generateTimestamps(),
  },
  (table) => [
    index('member_organizationId_idx').on(table.organizationId),
    index('member_userId_idx').on(table.userId),
  ],
);

export const invitations = authSchema.table(
  'invitations',
  {
    id: generateUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').default('pending').notNull(),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG).notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...generateTimestamps(),
  },
  (table) => [
    index('invitation_organizationId_idx').on(table.organizationId),
    index('invitation_email_idx').on(table.email),
  ],
);

export const twoFactors = authSchema.table(
  'two_factors',
  {
    id: generateUuid(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', TIMESTAMP_CONFIG),
    ...generateTimestamps(),
  },
  (table) => [
    index('twoFactor_secret_idx').on(table.secret),
    index('twoFactor_userId_idx').on(table.userId),
  ],
);

export const apikeys = authSchema.table(
  'api_keys',
  {
    id: generateUuid(),
    configId: text('config_id').default('default').notNull(),
    name: text('name'),
    start: text('start'),
    referenceId: uuid('reference_id').notNull(),
    prefix: text('prefix'),
    key: text('key').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: timestamp('last_refill_at', TIMESTAMP_CONFIG),
    enabled: boolean('enabled').default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window').default(86400000),
    rateLimitMax: integer('rate_limit_max').default(10),
    requestCount: integer('request_count').default(0),
    remaining: integer('remaining'),
    lastRequest: timestamp('last_request', TIMESTAMP_CONFIG),
    expiresAt: timestamp('expires_at', TIMESTAMP_CONFIG),
    permissions: text('permissions'),
    metadata: text('metadata'),
    ...generateTimestamps(),
  },
  (table) => [
    index('apikey_configId_idx').on(table.configId),
    index('apikey_referenceId_idx').on(table.referenceId),
    index('apikey_key_idx').on(table.key),
  ],
);

export const rateLimits = authSchema.table('rate_limits', {
  id: generateUuid(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  ...generateTimestamps(),
});

export const enrollmentAudits = authSchema.table('enrollment_audits', {
  id: generateUuid(),
  action: text('action').notNull(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id'),
  createdAt: timestamp('created_at', TIMESTAMP_CONFIG).defaultNow().notNull(),
});

export const mfaAssurances = authSchema.table('mfa_assurances', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  verifiedAt: timestamp('verified_at', TIMESTAMP_CONFIG).notNull(),
});
