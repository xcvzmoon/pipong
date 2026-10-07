import type { DatabaseRuntime } from '@pipong/database';
import type { AuthClient, AuthTransaction } from '@pipong/database/auth';
import type { ApiConfig } from '@pipong/shared';
import type { PgBoss } from 'pg-boss';
import type { AuthMail } from './mail/payload.ts';
import type { AuthenticationFailure, Principal } from './principal.ts';
import { apiKey } from '@better-auth/api-key';
import { createAuthClient } from '@pipong/database/auth';
import { betterAuth } from 'better-auth/minimal';
import { organization } from 'better-auth/plugins/organization';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { v7 } from 'uuid';
import { createAuthAdapter } from './adapter.ts';
import { enrollmentBefore, enrollmentAfter } from './assurance.ts';
import { enqueueAuthMail } from './mail/queue.ts';
import { authenticateRequest } from './principal.ts';

export type HumanAuth = {
  handler: (request: Request) => Promise<Response>;
  origin: string;
  authenticate: (request: Request) => Promise<Principal | AuthenticationFailure>;
};

/** Creates Better Auth using the API database and an already-started auth mail queue. */
export function createAuth(database: DatabaseRuntime, config: ApiConfig, queue: PgBoss): HumanAuth {
  const auth = createAuthEngine(
    createAuthClient(database),
    config,
    (mail) => enqueueAuthMail(queue, mail),
    'http',
  );

  const origin = new URL(config.authBaseUrl).origin;

  return {
    handler: auth.handler,
    origin,
    authenticate: (request) => authenticateRequest(auth, origin, request),
  };
}

export type AuthEngine = {
  handler: HumanAuth['handler'];
  api: {
    getSession: (input: {
      headers: Headers;
      query: { disableCookieCache: true; disableRefresh: true };
    }) => Promise<{ user: { id: string }; session: { id: string } } | null>;
    verifyApiKey: (input: { body: { key: string; configId: string } }) => Promise<{
      valid: boolean;
      error: { code?: string } | null;
      key: { id: string; referenceId: string } | null;
    }>;
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
    logger: {
      disabled: mode === 'operator',
    },
    hooks: {
      before: enrollmentBefore(client),
      after: enrollmentAfter(client),
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
        schema: {
          organization: {
            additionalFields: {
              disabledAt: { type: 'date', required: false, input: false },
            },
          },
        },
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
