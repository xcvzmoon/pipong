import type { AuthClient, AuthTransaction } from '@pipong/database/auth';
import type { AuthMiddleware } from 'better-auth/api';
import { authTables } from '@pipong/database/auth';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { and, eq, gt } from 'drizzle-orm';
import * as v from 'valibot';
import { enforceMfaPolicy } from './policy.ts';

const { enrollmentAudit, mfaAssurance } = authTables;

const privilegedOperations = new Set([
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/two-factor/generate-backup-codes',
  '/two-factor/disable',
]);

const privilegedAuditActions = new Map([
  ['/organization/invite-member', 'invitation-created'],
  ['/organization/cancel-invitation', 'invitation-canceled'],
  ['/two-factor/generate-backup-codes', 'backup-codes-regenerated'],
  ['/two-factor/disable', 'two-factor-disabled'],
]);

const privilegedResultSchema = v.union([
  v.object({ status: v.literal(true) }),
  v.object({ id: v.string() }),
]);

const verificationResultSchema = v.union([
  v.object({ status: v.literal(true) }),
  v.object({ token: v.optional(v.string()), user: v.object({ id: v.string() }) }),
]);

export function enrollmentBefore(client: AuthClient | AuthTransaction): AuthMiddleware {
  return createAuthMiddleware(async (context) => {
    await enforceMfaPolicy(context);

    const changesFactor =
      context.path === '/two-factor/enable' || context.path === '/two-factor/get-totp-uri';

    if (!context.path || (!privilegedOperations.has(context.path) && !changesFactor)) {
      return;
    }

    const active = await getSessionFromCtx(context);

    if (!active) {
      throw new APIError('UNAUTHORIZED', {
        code: 'AUTH_SESSION_REQUIRED',
        message: 'Sign in first.',
      });
    }

    if (changesFactor && !active.user.twoFactorEnabled) {
      return;
    }

    if (!active.user.emailVerified || !active.user.twoFactorEnabled) {
      throw new APIError('FORBIDDEN', {
        code: 'AUTH_MFA_ENROLLMENT_REQUIRED',
        message: 'Verify your email and enroll TOTP before this operation.',
      });
    }

    const [assurance] = await client
      .select()
      .from(mfaAssurance)
      .where(
        and(
          eq(mfaAssurance.sessionId, active.session.id),
          gt(mfaAssurance.verifiedAt, new Date(Date.now() - 300_000)),
        ),
      );

    if (!assurance) {
      throw new APIError('FORBIDDEN', {
        code: 'AUTH_RECENT_MFA_REQUIRED',
        message: 'Verify TOTP or a backup code within five minutes before this operation.',
      });
    }

    if (context.path === '/organization/invite-member') {
      const parsed = v.safeParse(
        v.object({ role: v.optional(v.literal('member'), 'member') }),
        context.body,
      );

      if (!parsed.success) {
        throw new APIError('FORBIDDEN', {
          code: 'AUTH_INVITATION_ROLE_INVALID',
          message: 'Enrollment invitations may only grant the member role.',
        });
      }
    }
  });
}

export function enrollmentAfter(client: AuthClient | AuthTransaction): AuthMiddleware {
  return createAuthMiddleware(async (context) => {
    const isTotp = context.path === '/two-factor/verify-totp';
    const isRecovery = context.path === '/two-factor/verify-backup-code';
    const action = context.path ? privilegedAuditActions.get(context.path) : undefined;

    if (!isTotp && !isRecovery && !action) {
      return;
    }

    if (isAPIError(context.context.returned)) {
      return;
    }

    const result = v.safeParse(
      action ? privilegedResultSchema : verificationResultSchema,
      context.context.returned,
    );

    if (!result.success) {
      return;
    }

    const active = context.context.newSession ?? (await getSessionFromCtx(context));

    if (!active?.user.twoFactorEnabled && !isRecovery && !action) {
      return;
    }

    const userId = active?.user.id ?? ('user' in result.output ? result.output.user.id : undefined);

    if (!userId) {
      return;
    }

    const auditAction = isRecovery ? 'backup-code-recovery' : action;

    await client.transaction(async (transaction) => {
      if ((isTotp || isRecovery) && active?.user.twoFactorEnabled) {
        await transaction
          .insert(mfaAssurance)
          .values({ sessionId: active.session.id, verifiedAt: new Date() })
          .onConflictDoUpdate({ target: mfaAssurance.sessionId, set: { verifiedAt: new Date() } });
      }

      if (auditAction) {
        await transaction.insert(enrollmentAudit).values({
          action: auditAction,
          userId,
          sessionId: active?.session.id ?? null,
        });
      }
    });
  });
}
