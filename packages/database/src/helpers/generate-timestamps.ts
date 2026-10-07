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

/**
 * Builds creation, update, and nullable soft-deletion timestamp columns.
 *
 * All columns use timezone-aware millisecond precision. Drizzle refreshes updatedAt
 * on updates; this is not a PostgreSQL trigger.
 *
 * @returns Timestamp builders with database defaults for creation and initial update times.
 *
 * @example
 * ```ts
 * const records = pgTable('records', {
 *   id: generateUuid(),
 *   ...generateTimestamps(),
 * });
 * ```
 */
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
 * Adds UUID audit actor columns to the standard timestamp columns.
 *
 * createdBy is required. Actor IDs must be supplied by the caller; they are not
 * inferred from the session. Omit userId to create columns without foreign keys.
 *
 * @param [userId] - Lazy reference to the users primary key for all actor columns.
 * @param [createdByOnDelete='restrict'] - Foreign-key action for the required creator.
 * @param [updatedByOnDelete='set null'] - Foreign-key action for the nullable updater.
 * @param [deletedByOnDelete='set null'] - Foreign-key action for the nullable deletion actor.
 * @returns Timestamp and actor column builders.
 *
 * @example
 * ```ts
 * const records = pgTable('records', {
 *   id: generateUuid(),
 *   ...generateTimestampsWithAudit(() => users.id),
 * });
 * ```
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
