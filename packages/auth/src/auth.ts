import type { DatabaseRuntime } from '@pipong/database';
import type { ApiConfig } from '@pipong/shared';
import type { PgBoss } from 'pg-boss';
import type { AuthClient, AuthTransaction } from './database.ts';
import type { AuthMail } from './mail/payload.ts';
import { apiKey } from '@better-auth/api-key';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { v7 } from 'uuid';
import { createAuthAdapter, createAuthClient } from './database.ts';
import { enqueueAuthMail } from './mail/queue.ts';
import { enforceMfaPolicy } from './policy.ts';

export type HumanAuth = {
  handler: (request: Request) => Promise<Response>;
  origin: string;
};

/** Creates Better Auth using the API database and an already-started auth mail queue. */
export function createAuth(database: DatabaseRuntime, config: ApiConfig, queue: PgBoss): HumanAuth {
  const auth = createAuthEngine(
    createAuthClient(database),
    config,
    (mail) => enqueueAuthMail(queue, mail),
    'http',
  );

  return {
    handler: auth.handler,
    origin: new URL(config.authBaseUrl).origin,
  };
}

type AuthEngine = {
  handler: HumanAuth['handler'];
  api: {
    signUpEmail: (input: {
      body: {
        name: string;
        email: string;
        password: string;
      };
    }) => Promise<{ user: { id: string } }>;
    createOrganization: (input: {
      body: {
        name: string;
        slug: string;
        userId: string;
      };
    }) => Promise<{ id: string } | null>;
  };
};

export function createAuthEngine(
  client: AuthClient | AuthTransaction,
  config: ApiConfig,
  sendMail: (mail: AuthMail) => Promise<void>,
  mode: 'http' | 'operator',
): AuthEngine {
  return betterAuth({
    appName: 'Pipong',
    logger: { disabled: mode === 'operator' },
    hooks: {
      before: enforceMfaPolicy,
    },
    baseURL: config.authBaseUrl,
    basePath: '/api/auth',
    secret: config.authSecret,
    trustedOrigins: [new URL(config.authBaseUrl).origin],
    database: createAuthAdapter(client),
    emailAndPassword: {
      enabled: true,
      disableSignUp: mode === 'http',
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        sendMail({
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
        sendMail({
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
      disableOriginCheck: false,
      disableCSRFCheck: false,
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
          sendMail({
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
}

function invitationUrl(config: ApiConfig, invitationId: string): string {
  const url = new URL('/api/auth/organization/get-invitation', config.authBaseUrl);
  url.searchParams.set('id', invitationId);
  return url.href;
}
