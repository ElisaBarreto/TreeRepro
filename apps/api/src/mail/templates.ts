import type { Digest, DigestItem } from '../jobs/digest.ts';

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

/** One list of the digest: a heading, one entry per item with its link, or `None.` */
function digestSection(title: string, items: readonly DigestItem[], appOrigin: string): string[] {
  if (items.length === 0) return [title, '', 'None.', ''];
  return [
    title,
    '',
    ...items.flatMap((item) => [
      `- ${item.speciesName} — ${item.traitKey}: ${item.valueText} (${item.actorName})`,
      // The `?record=` search param opens the record drawer on the species page.
      `  ${appOrigin}/app/species/${item.speciesId}?record=${item.recordId}`,
    ]),
    '',
  ];
}

/**
 * The daily digest as plain text: the window's counts, the queues as they
 * stand and the two lists, each item linking to its record drawer.
 *
 * Actor names appear decrypted — every recipient holds `dataset.read` — but
 * no e-mail address ever does, neither a recipient's nor an actor's (R5).
 * @rfc RFC-74 R3, R5
 */
export function digestEmail(input: {
  digest: Digest;
  appOrigin: string;
  date: string;
}): MailContent {
  const { counts, window, contests, disputes } = input.digest;
  return {
    subject: `TreeRepro digest — ${input.date}`,
    text: [
      `Activity on TreeRepro from ${formatUtc(window.start)} to ${formatUtc(window.end)}.`,
      '',
      `Records added: ${counts.records}`,
      `Contests: ${counts.contests}`,
      `Complements: ${counts.complements}`,
      `Validations: ${counts.validations}`,
      `Disputes: ${counts.disputes}`,
      `Withdrawals: ${counts.withdrawals}`,
      `Species proposals: ${counts.proposals}`,
      '',
      'Waiting for review right now:',
      '',
      `Pending groups: ${counts.pendingGroups}`,
      `Disputed records: ${counts.disputedNow}`,
      '',
      ...digestSection('Contests', contests, input.appOrigin),
      ...digestSection('Disputes', disputes, input.appOrigin),
      'TreeRepro',
    ].join('\n'),
  };
}
