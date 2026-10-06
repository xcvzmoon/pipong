import * as v from 'valibot';

export const authMailSchema = v.object({
  kind: v.picklist(['verification', 'reset', 'invitation']),
  to: v.pipe(v.string(), v.email()),
  name: v.string(),
  url: v.pipe(v.string(), v.url()),
  expiresAt: v.pipe(v.number(), v.integer()),
});

export type AuthMail = v.InferOutput<typeof authMailSchema>;
