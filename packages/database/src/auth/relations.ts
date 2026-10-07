import { defineRelations } from 'drizzle-orm';
import {
  users,
  sessions,
  accounts,
  verifications,
  organizations,
  members,
  invitations,
  twoFactors,
  apikeys,
  rateLimits,
} from './schema.ts';

export const authRelations = defineRelations(
  {
    users,
    sessions,
    accounts,
    verifications,
    organizations,
    members,
    invitations,
    twoFactors,
    apikeys,
    rateLimits,
  },
  (r) => ({
    users: {
      sessions: r.many.sessions({
        from: r.users.id,
        to: r.sessions.userId,
      }),
      accounts: r.many.accounts({
        from: r.users.id,
        to: r.accounts.userId,
      }),
      members: r.many.members({
        from: r.users.id,
        to: r.members.userId,
      }),
      invitations: r.many.invitations({
        from: r.users.id,
        to: r.invitations.inviterId,
      }),
      twoFactors: r.many.twoFactors({
        from: r.users.id,
        to: r.twoFactors.userId,
      }),
    },
    sessions: {
      user: r.one.users({
        from: r.sessions.userId,
        to: r.users.id,
      }),
    },
    accounts: {
      user: r.one.users({
        from: r.accounts.userId,
        to: r.users.id,
      }),
    },
    organizations: {
      members: r.many.members({
        from: r.organizations.id,
        to: r.members.organizationId,
      }),
      invitations: r.many.invitations({
        from: r.organizations.id,
        to: r.invitations.organizationId,
      }),
    },
    members: {
      organization: r.one.organizations({
        from: r.members.organizationId,
        to: r.organizations.id,
      }),
      user: r.one.users({
        from: r.members.userId,
        to: r.users.id,
      }),
    },
    invitations: {
      organization: r.one.organizations({
        from: r.invitations.organizationId,
        to: r.organizations.id,
      }),
      user: r.one.users({
        from: r.invitations.inviterId,
        to: r.users.id,
      }),
    },
    twoFactors: {
      user: r.one.users({
        from: r.twoFactors.userId,
        to: r.users.id,
      }),
    },
  }),
);
