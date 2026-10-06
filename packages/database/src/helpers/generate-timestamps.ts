import type {
  AnyPgColumn,
  PgUUIDBuilder,
  PgTimestampBuilder,
  SetHasDefault,
  SetNotNull,
  UpdateDeleteAction,
} from 'drizzle-orm/pg-core';
import { uuid, timestamp } from 'drizzle-orm/pg-core';

export const TIMESTAMP_CONFIG = {
  mode: 'date',
  precision: 3,
  withTimezone: true,
} as const;

export type TimestampColumns = {
  createdAt: SetHasDefault<SetNotNull<PgTimestampBuilder>>;
  updatedAt: SetHasDefault<SetNotNull<PgTimestampBuilder>>;
  deletedAt: PgTimestampBuilder;
};

export type AuditTimestampColumns = TimestampColumns & {
  createdBy: SetNotNull<PgUUIDBuilder>;
  updatedBy: PgUUIDBuilder;
  deletedBy: PgUUIDBuilder;
};

/** Creation, Drizzle-managed update, and nullable soft-deletion timestamps. */
export function generateTimestamps(): TimestampColumns {
  return {
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG)
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp('deleted_at', TIMESTAMP_CONFIG),
  };
}

/**
 * Adds UUID audit actors; createdBy is required and restricts actor deletion.
 * Nullable update/deletion actors default to SET NULL; omit userId for unbound columns.
 */
export function generateTimestampsWithAudit(
  userId?: () => AnyPgColumn<{ data: string }>,
  createdByOnDelete: UpdateDeleteAction = 'restrict',
  updatedByOnDelete: UpdateDeleteAction = 'set null',
  deletedByOnDelete: UpdateDeleteAction = 'set null',
): AuditTimestampColumns {
  const createdBy = uuid('created_by').notNull();
  const updatedBy = uuid('updated_by');
  const deletedBy = uuid('deleted_by');

  if (userId) {
    createdBy.references(userId, { onDelete: createdByOnDelete });
    updatedBy.references(userId, { onDelete: updatedByOnDelete });
    deletedBy.references(userId, { onDelete: deletedByOnDelete });
  }

  return { createdBy, updatedBy, deletedBy, ...generateTimestamps() };
}
