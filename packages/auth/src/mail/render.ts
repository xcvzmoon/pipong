import type { AuthMail } from './payload.ts';
import Handlebars from 'handlebars';
import authEmailTemplate from './templates/auth-email.hbs';

type RenderedMail = {
  subject: string;
  html: string;
  text: string;
};

const handlebars = Handlebars.create();
const template = handlebars.compile(authEmailTemplate, { strict: true });
const subjects = {
  verification: 'Verify your Pipong email',
  reset: 'Reset your Pipong password',
  invitation: 'You have been invited to a Pipong organization',
};

export function renderAuthMail(mail: AuthMail): RenderedMail {
  const subject = subjects[mail.kind];

  return {
    subject,
    html: template({ name: mail.name, url: mail.url, subject }),
    text: `Hello ${mail.name},\n\n${subject}: ${mail.url}\n\nIf you did not request this email, you can ignore it.`,
  };
}
