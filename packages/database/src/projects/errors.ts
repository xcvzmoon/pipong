import * as v from 'valibot';

const scopedNameConflictSchema = v.object({
  code: v.literal('23505'),
  constraint: v.picklist(['projects_scoped_name_unique', 'environments_scoped_name_unique']),
});

/**
 * Recognizes a wrapped PostgreSQL conflict on a project or environment scoped name.
 *
 * @param error - Error whose cause may contain a PostgreSQL code and constraint name.
 * @returns True only for code 23505 and one of the known scoped name constraints.
 *
 * @example
 * ```ts
 * if (error instanceof Error && isResourceNameConflict(error)) {
 *   console.warn('RESOURCE_NAME_CONFLICT');
 * }
 * ```
 */
export function isResourceNameConflict(error: Error): boolean {
  return v.safeParse(scopedNameConflictSchema, error.cause).success;
}
