import * as v from 'valibot';

const scopedNameConflictSchema = v.object({
  code: v.literal('23505'),
  constraint: v.picklist(['projects_scoped_name_unique', 'environments_scoped_name_unique']),
});

export function isResourceNameConflict(error: Error): boolean {
  return v.safeParse(scopedNameConflictSchema, error.cause).success;
}
