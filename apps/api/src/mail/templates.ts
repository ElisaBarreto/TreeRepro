export interface MailContent {
  subject: string;
  text: string;
}

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** @rfc RFC-20 R4 */
export function inviteEmail(input: { name: string; link: string; expiresAt: Date }): MailContent {
  return {
    subject: 'You have been invited to TreeRepro',
    text: [
      `Hello ${input.name},`,
      '',
      'You have been invited to TreeRepro. Open the link below to set your password:',
      '',
      input.link,
      '',
      `The link expires on ${formatUtc(input.expiresAt)}. If it has expired, ask an administrator for a new invitation.`,
      '',
      'TreeRepro',
    ].join('\n'),
  };
}

/** @rfc RFC-21 R5 */
export function passwordResetEmail(input: {
  name: string;
  link: string;
  expiresAt: Date;
}): MailContent {
  return {
    subject: 'Reset your TreeRepro password',
    text: [
      `Hello ${input.name},`,
      '',
      'Someone asked to reset the password of your TreeRepro account. Open the link below to choose a new one:',
      '',
      input.link,
      '',
      `The link expires on ${formatUtc(input.expiresAt)}. If you did not ask for this, ignore this email; your password stays unchanged.`,
      '',
      'TreeRepro',
    ].join('\n'),
  };
}
