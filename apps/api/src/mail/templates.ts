import type { Digest, DigestItem } from '../jobs/digest.ts';
import {
  BODY_FONT,
  MAIL_COLORS as C,
  DISPLAY_FONT,
  emailLayout,
  escapeHtml,
  mailButton,
  mailFallbackLink,
  mailNote,
  mailParagraph,
} from './layout.ts';

export interface MailContent {
  subject: string;
  text: string;
  /** The same facts as `text`, in the shared frame (RFC-10 R16). */
  html: string;
}

const h1 = (text: string, color: string = C.canopy900, size = 28) =>
  `<h1 style="margin:0 0 20px;font-family:${DISPLAY_FONT};font-size:${size}px;line-height:1.25;font-weight:600;color:${color};">${escapeHtml(text)}</h1>`;

const eyebrow = (text: string, color: string) =>
  `<p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${color};">${escapeHtml(text)}</p>`;

const heading = (text: string) =>
  `<p style="margin:0 0 12px;font-family:${DISPLAY_FONT};font-size:16px;font-weight:600;color:${C.canopy900};">${escapeHtml(text)}</p>`;

const spacer = (px: number) =>
  `<div style="height:${px}px;line-height:${px}px;font-size:0;">&nbsp;</div>`;

function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** The invitation's three steps, as `[title, detail]`. */
const INVITE_STEPS: readonly (readonly [string, string])[] = [
  ['Open the link', 'The button above takes you to your invitation.'],
  ['Choose a password', 'It activates your account.'],
  ['Sign in', 'Use this email and your new password.'],
];

/** What the workspace offers, as `[title, detail, dot colour]`. */
const INVITE_FEATURES: readonly (readonly [string, string, string])[] = [
  ['Explore species', 'Search by family, genus and trait.', C.pollen500],
  [
    'Add what you know',
    'Record trait values, backed by a reference or by your own observation.',
    C.canopy600,
  ],
  [
    'Validate together',
    'Confirm the records of others, or offer a different value when the evidence says so.',
    C.canopy800,
  ],
];

function inviteHtml(input: {
  name: string;
  link: string;
  expires: string;
  appOrigin: string;
  expiredLine: string;
}): string {
  const emblem = escapeHtml(`${input.appOrigin}/email-emblem.png`);
  const hero = `<tr><td class="tr-hero-pad" align="center" style="padding:48px 40px 44px;background-color:${C.canopy900};background-image:radial-gradient(120% 90% at 50% 0%,${C.canopy700} 0%,${C.canopy800} 35%,${C.canopy900} 100%);">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:10px;border:2px solid ${C.pollen500};border-radius:50%;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:12px;border:1px dashed ${C.canopy600};border-radius:50%;"><img src="${emblem}" width="108" height="108" alt="TreeRepro" style="display:block;border:0;width:108px;height:108px;"></td></tr></table></td></tr></table>
${spacer(24)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:7px 14px;border:1px solid ${C.pollen400};border-radius:999px;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.pollen300};">You are invited</td></tr></table>
${spacer(20)}
${h1(`Welcome to TreeRepro, ${input.name}`, C.mist50, 32)}
<p style="margin:0 0 28px;font-family:${BODY_FONT};font-size:17px;line-height:26px;color:${C.mist100};">Collaborate with us in assembling the largest repository of tree reproductive traits across all stages — flowers, fruits and seeds.</p>
${mailButton(input.link, 'Join')}
${spacer(16)}
<p style="margin:0;font-family:${BODY_FONT};font-size:13px;color:${C.mist300};">Valid until <strong style="color:${C.mist50};">${escapeHtml(input.expires)}</strong></p>
</td></tr>`;
  const steps = INVITE_STEPS.map(
    ([title, detail], i) =>
      `<td class="tr-stack" valign="top" width="33%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tr-step" valign="top" height="128" style="height:128px;padding:16px;border-radius:14px;background-color:${C.mist50};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="28" height="28" style="width:28px;height:28px;border-radius:50%;background-color:${C.canopy800};font-family:${DISPLAY_FONT};font-size:13px;font-weight:700;color:${C.pollen300};">${i + 1}</td></tr></table><p style="margin:10px 0 4px;font-family:${BODY_FONT};font-size:14px;font-weight:700;color:${C.canopy900};">${escapeHtml(title)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:19px;color:${C.text};">${escapeHtml(detail)}</p></td></tr></table></td>`,
  ).join('');
  const features = INVITE_FEATURES.map(
    ([title, detail, dot]) =>
      `<tr><td valign="top" width="24" style="padding:5px 12px 14px 0;"><div style="width:12px;height:12px;border-radius:50%;background-color:${dot};font-size:0;line-height:0;">&nbsp;</div></td><td valign="top" style="padding:0 0 14px;"><p style="margin:0 0 2px;font-family:${BODY_FONT};font-size:15px;font-weight:700;color:${C.canopy900};">${escapeHtml(title)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.text};">${escapeHtml(detail)}</p></td></tr>`,
  ).join('');
  const body = `${heading('Three steps and you are in')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -6px 22px;"><tr>${steps}</tr></table>
${heading('What waits for you inside')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${features}</table>
${spacer(10)}
${mailFallbackLink(input.link, input.expiredLine)}`;
  return emailLayout({
    appOrigin: input.appOrigin,
    title: 'You have been invited to TreeRepro',
    preheader: `Welcome, ${input.name}: set your password to join TreeRepro.`,
    hero,
    body,
    footer:
      'You receive this email because an administrator invited this address to TreeRepro. If you were not expecting it, you can ignore it.',
  });
}

/**
 * @rfc RFC-20 R4
 * @rfc RFC-10 R16
 */
export function inviteEmail(input: {
  name: string;
  link: string;
  expiresAt: Date;
  appOrigin: string;
  /** `INVITE_CONTACT_EMAIL`: who to ask for a new invitation; unset names an administrator. */
  contactEmail?: string | undefined;
}): MailContent {
  const expires = formatUtc(input.expiresAt);
  const expiredLine = `If the link has expired, ask ${input.contactEmail ?? 'an administrator'} for a new invitation.`;
  return {
    subject: 'You have been invited to TreeRepro',
    text: [
      `Hello ${input.name},`,
      '',
      'You have been invited to TreeRepro. Open the link below to set your password:',
      '',
      input.link,
      '',
      `The link expires on ${expires}. ${expiredLine}`,
      '',
      'TreeRepro',
    ].join('\n'),
    html: inviteHtml({ ...input, expires, expiredLine }),
  };
}

/**
 * @rfc RFC-21 R5
 * @rfc RFC-10 R16
 */
export function passwordResetEmail(input: {
  name: string;
  link: string;
  expiresAt: Date;
  appOrigin: string;
}): MailContent {
  const expires = formatUtc(input.expiresAt);
  return {
    subject: 'Reset your TreeRepro password',
    text: [
      `Hello ${input.name},`,
      '',
      'Someone asked to reset the password of your TreeRepro account. Open the link below to choose a new one:',
      '',
      input.link,
      '',
      `The link expires on ${expires}. If you did not ask for this, ignore this email; your password stays unchanged.`,
      '',
      'TreeRepro',
    ].join('\n'),
    html: emailLayout({
      appOrigin: input.appOrigin,
      title: 'Reset your TreeRepro password',
      preheader: 'Choose a new password for your TreeRepro account.',
      accent: C.canopy600,
      body: `${eyebrow('Account security', C.canopy700)}${h1('Reset your TreeRepro password')}
${mailParagraph(`Hello ${input.name},`)}
${mailParagraph('Someone asked to reset the password of your TreeRepro account. Choose a new one with the button below.')}
${spacer(8)}${mailButton(input.link, 'Choose a new password')}${spacer(24)}
${mailNote(`The link expires on <strong>${escapeHtml(expires)}</strong>.`)}
${mailNote('Did not ask for this? Ignore this email. Your password stays unchanged.', 'amber')}
${mailFallbackLink(input.link)}`,
      footer:
        'You receive this email because a password reset was requested for this address on TreeRepro.',
    }),
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
 * The line a repeated run opens with. The previous run reached its send loop
 * over this same window and never finished, so some of these recipients may
 * have had part of it already (R2, R5).
 * @rfc RFC-74 R5
 */
export const DIGEST_RESENT_LINE =
  'Resent: the previous run for this window did not finish, so part of this summary may have reached you already.';

/** One list of the digest in HTML: a heading and a row per item, or an empty-state line. */
function digestSectionHtml(title: string, items: readonly DigestItem[], appOrigin: string): string {
  const head = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-bottom:8px;border-bottom:1px solid ${C.rule};font-family:${DISPLAY_FONT};font-size:15px;font-weight:600;color:${C.canopy800};">${escapeHtml(title)}</td></tr></table>`;
  if (items.length === 0) return `${head}${spacer(8)}${mailNote('None in this window.')}`;
  const rows = items
    .map((item, i) => {
      const href = `${appOrigin}/app/species/${item.speciesId}?record=${item.recordId}`;
      const border = i === items.length - 1 ? '' : `border-bottom:1px solid ${C.mist50};`;
      return `<tr><td valign="middle" style="padding:14px 12px 14px 0;${border}"><p style="margin:0 0 4px;font-family:${BODY_FONT};font-size:15px;font-weight:600;font-style:italic;color:${C.canopy900};">${escapeHtml(item.speciesName)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.text};"><span style="font-family:Menlo,Consolas,monospace;font-size:12px;padding:2px 6px;border-radius:6px;background-color:${C.mist50};color:${C.canopy800};">${escapeHtml(item.traitKey)}</span> ${escapeHtml(item.valueText)} &middot; by ${escapeHtml(item.actorName)}</p></td><td align="right" valign="middle" style="padding:14px 0;${border}white-space:nowrap;"><a href="${escapeHtml(href)}" style="font-family:${BODY_FONT};font-size:14px;font-weight:600;color:${C.canopy700};text-decoration:none;">Open record</a></td></tr>`;
    })
    .join('');
  return `${head}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">${rows}</table>`;
}

/** A row of count tiles, `dark` for the queues as they stand. */
function tiles(
  cells: readonly (readonly [string, number])[],
  columns: number,
  dark: boolean,
): string {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += columns) {
    const row = cells.slice(i, i + columns);
    const pad = Array.from(
      { length: columns - row.length },
      () => `<td width="${Math.floor(100 / columns)}%" style="padding:5px;"></td>`,
    );
    rows.push(
      `<tr>${row
        .map(
          ([label, value]) =>
            `<td valign="top" width="${Math.floor(100 / columns)}%" style="padding:5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${dark ? '18px 20px' : '14px'};border-radius:12px;background-color:${dark ? C.canopy900 : C.mist50};"><p style="margin:0;font-family:${DISPLAY_FONT};font-size:${dark ? 32 : 24}px;font-weight:600;line-height:1.2;color:${dark ? C.pollen400 : C.canopy900};">${value}</p><p style="margin:2px 0 0;font-family:${BODY_FONT};font-size:13px;line-height:18px;color:${dark ? C.mist100 : C.text};">${escapeHtml(label)}</p></td></tr></table></td>`,
        )
        .join('')}${pad.join('')}</tr>`,
    );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 -5px;">${rows.join('')}</table>`;
}

function digestHtml(input: {
  digest: Digest;
  appOrigin: string;
  date: string;
  resent: boolean;
}): string {
  const { counts, window, contests, disputes } = input.digest;
  const beforeCard = input.resent
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="padding:14px 18px;border-radius:12px;background-color:${C.amberTint};font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.amberText};"><strong>Resent:</strong> ${escapeHtml(DIGEST_RESENT_LINE.replace(/^Resent: /, ''))}</td></tr></table>`
    : '';
  const body = `${eyebrow('Daily digest', C.bark700)}${h1('Activity on TreeRepro', C.canopy900, 26)}
<p style="margin:-10px 0 28px;font-family:${BODY_FONT};font-size:15px;color:${C.muted};">From ${escapeHtml(formatUtc(window.start))} to ${escapeHtml(formatUtc(window.end))}</p>
${heading('Waiting for review right now')}
${tiles(
  [
    ['Pending groups', counts.pendingGroups],
    ['Disputed records', counts.disputedNow],
  ],
  2,
  true,
)}
${spacer(14)}${mailButton(`${input.appOrigin}/app/curation/pending`, 'Open the review queue')}${spacer(30)}
${heading('In this window')}
${tiles(
  [
    ['Records added', counts.records],
    ['Contests', counts.contests],
    ['Complements', counts.complements],
    ['Validations', counts.validations],
    ['Disputes', counts.disputes],
    ['Withdrawals', counts.withdrawals],
    ['Species proposals', counts.proposals],
  ],
  4,
  false,
)}
<p style="margin:8px 0 28px;font-family:${BODY_FONT};font-size:13px;color:${C.muted};">Records added includes contests and complements, which are records too.</p>
${digestSectionHtml('Contests', contests, input.appOrigin)}
${digestSectionHtml('Disputes', disputes, input.appOrigin)}`;
  return emailLayout({
    appOrigin: input.appOrigin,
    title: `TreeRepro digest — ${input.date}`,
    preheader: `${counts.pendingGroups} pending groups and ${counts.disputedNow} disputed records waiting for review.`,
    headerNote: `Daily digest · ${input.date}`,
    beforeCard,
    body,
    footer:
      'You receive this digest because your role can review records on TreeRepro. It is sent once a day, on days with activity.',
  });
}

/**
 * The daily digest as plain text: the window's counts, the queues as they
 * stand and the two lists, each item linking to its record drawer.
 *
 * Actor names appear decrypted — every recipient holds `dataset.read` — but
 * no e-mail address ever does, neither a recipient's nor an actor's (R5).
 *
 * `resent` prefixes `DIGEST_RESENT_LINE` and changes nothing else. The SUBJECT
 * in particular is untouched: R5 fixes it as `TreeRepro digest — <date>`, and
 * a repeat must not move what an inbox filter or a mail thread groups on.
 * @rfc RFC-74 R3, R5
 * @rfc RFC-10 R16
 */
export function digestEmail(input: {
  digest: Digest;
  appOrigin: string;
  date: string;
  /** Whether this run repeats a window a previous one had already begun mailing. */
  resent?: boolean;
}): MailContent {
  const { counts, window, contests, disputes } = input.digest;
  return {
    subject: `TreeRepro digest — ${input.date}`,
    text: [
      ...(input.resent === true ? [DIGEST_RESENT_LINE, ''] : []),
      `Activity on TreeRepro from ${formatUtc(window.start)} to ${formatUtc(window.end)}.`,
      '',
      // Spelt out because a contest and a complement are themselves records and
      // are counted on the first line too (R3); without this a reader adds the
      // three lines up and gets more records than were created.
      `Records added (contests and complements included): ${counts.records}`,
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
    html: digestHtml({ ...input, resent: input.resent === true }),
  };
}
