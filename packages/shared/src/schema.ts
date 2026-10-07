import * as v from 'valibot';

const TRUE_VALUES = ['true', '1', 'yes', 'on'] as const;
const FALSE_VALUES = ['false', '0', 'no', 'off'] as const;

/**
 * Parses a trimmed, case-insensitive environment boolean.
 *
 * Accepts true, 1, yes, and on as true; false, 0, no, and off as false.
 * Other values fail validation.
 *
 * @example
 * ```ts
 * const enabled = v.parse(booleanSchema, ' YES ');
 * console.info(enabled);
 * ```
 */
export const booleanSchema = v.pipe(
  v.string('Must be a boolean string'),
  v.trim(),
  v.toLowerCase(),
  v.picklist(
    [...TRUE_VALUES, ...FALSE_VALUES],
    'Must be one of: true, false, 1, 0, yes, no, on, off',
  ),
  v.transform((value) => TRUE_VALUES.some((trueValue) => trueValue === value)),
);
