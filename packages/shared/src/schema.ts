import * as v from 'valibot';

const TRUE_VALUES = ['true', '1', 'yes', 'on'] as const;
const FALSE_VALUES = ['false', '0', 'no', 'off'] as const;

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
