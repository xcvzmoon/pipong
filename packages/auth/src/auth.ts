import type { DatabaseRuntime } from '@pipong/database';
import type { ApiConfig } from '@pipong/shared';
import type { PgBoss } from 'pg-boss';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth/minimal';
import { organization, twoFactor } from 'better-auth/plugins';
import { v7 } from 'uuid';
import { createAuthDatabase } from './database.ts';
import { enqueueAuthMail } from './mail/queue.ts';

export type HumanAuth = {
  handler: (request: Request) => Promise<Response>;
  origin: string;
};

/** Creates Better Auth using the API database and an already-started auth mail queue. */
export function createAuth(database: DatabaseRuntime, config: ApiConfig, queue: PgBoss): HumanAuth {
  const auth = betterAuth({
    appName: 'Pipong',
    baseURL: config.authBaseUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [new URL(config.authBaseUrl).origin],
    database: createAuthDatabase(database),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        enqueueAuthMail(queue, {
          kind: 'reset',
          to: user.email,
          name: user.name,
          url,
          expiresAt: Date.now() + 3_600_000,
        }),
    },
    emailVerification: {
      sendOnSignIn: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: ({ user, url }) =>
        enqueueAuthMail(queue, {
          kind: 'verification',
          to: user.email,
          name: user.name,
          url,
          expiresAt: Date.now() + 3_600_000,
        }),
    },
    session: {
      cookieCache: {
        enabled: false,
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
    },
    advanced: {
      database: {
        generateId: () => v7(),
      },
      ipAddress: {
        ipAddressHeaders: ['x-pipong-client-ip'],
      },
    },
    user: {
      deleteUser: {
        enabled: false,
      },
      changeEmail: {
        enabled: false,
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        disableOrganizationDeletion: true,
        sendInvitationEmail: ({ email, id, organization: invitedOrganization }) =>
          enqueueAuthMail(queue, {
            kind: 'invitation',
            to: email,
            name: invitedOrganization.name,
            url: invitationUrl(config, id),
            expiresAt: Date.now() + 172_800_000,
          }),
      }),
      twoFactor({
        issuer: 'Pipong',
      }),
      apiKey({
        references: 'organization',
        enableSessionForAPIKeys: false,
      }),
    ],
  });

  return {
    handler: auth.handler,
    origin: new URL(config.authBaseUrl).origin,
  };
}

function invitationUrl(config: ApiConfig, invitationId: string): string {
  const url = new URL('/api/auth/organization/get-invitation', config.authBaseUrl);
  url.searchParams.set('id', invitationId);
  return url.href;
}
