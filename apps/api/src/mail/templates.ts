import { DIGEST_LIST_LIMIT, type Digest, type DigestItem } from '../jobs/digest.ts';
import {
  BODY_FONT,
  MAIL_COLORS as C,
  DISPLAY_FONT,
  emailLayout,
  escapeHtml,
  mailAsset,
  mailButton,
  mailFallbackLink,
  mailIcon,
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

const eyebrow = (text: string, color: string, icon = '') =>
  `<p style="margin:0 0 12px;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${color};">${icon === '' ? '' : `${icon}&nbsp;&nbsp;`}${escapeHtml(text)}</p>`;

const heading = (text: string, color: string = C.canopy900) =>
  `<p style="margin:0 0 12px;font-family:${DISPLAY_FONT};font-size:16px;font-weight:600;color:${color};">${escapeHtml(text)}</p>`;

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

/** What the workspace offers, as `[title, detail, icon tile]`. */
const INVITE_FEATURES: readonly (readonly [string, string, string])[] = [
  ['Explore species', 'Search by family, genus and trait.', 'search.png'],
  [
    'Add what you know',
    'Record trait values, backed by a reference or by your own observation.',
    'leaf.png',
  ],
  [
    'Validate together',
    'Confirm the records of others, or offer a different value when the evidence says so.',
    'shield.png',
  ],
];

function inviteHtml(input: {
  name: string;
  link: string;
  expires: string;
  appOrigin: string;
  expiredLine: string;
}): string {
  const bg = escapeHtml(mailAsset(input.appOrigin, 'hero-bg.jpg'));
  // The pollen and the glow are baked into two images: mail clients drop
  // positioned elements, SVG and most shadows, but show a background image
  // (Outlook for Windows keeps the solid colour underneath).
  const hero = `<tr><td class="tr-hero-pad" align="center" background="${bg}" bgcolor="${C.canopy900}" style="padding:40px 40px 44px;background-color:${C.canopy900};background-image:url('${bg}');background-size:cover;background-position:center top;">
<img src="${escapeHtml(mailAsset(input.appOrigin, 'rings.png'))}" width="300" height="190" alt="TreeRepro" style="display:block;border:0;width:300px;height:190px;margin:-24px auto -20px;">
${spacer(12)}
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:4px 14px;border:1px solid ${C.pollen600};border-radius:999px;background-color:#1f3a26;font-family:${BODY_FONT};font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${C.pollen300};">${mailIcon(input.appOrigin, 'mail.png', 14)}&nbsp;&nbsp;You are invited</td></tr></table>
${spacer(22)}
<h1 style="margin:0 0 16px;font-family:${DISPLAY_FONT};font-size:34px;line-height:1.18;font-weight:700;letter-spacing:-0.02em;color:${C.mist50};">${escapeHtml(`Welcome to TreeRepro, ${input.name}`)}</h1>
<p style="margin:0 0 28px;font-family:${BODY_FONT};font-size:17px;line-height:26px;color:${C.mist100};">Collaborate with us in assembling the largest repository of tree reproductive traits across all stages — flowers, fruits and seeds.</p>
${mailButton(input.appOrigin, input.link, 'Join')}
${spacer(20)}
<p style="margin:0;font-family:${BODY_FONT};font-size:14px;color:${C.mist300};">${mailIcon(input.appOrigin, 'clock.png', 16)}&nbsp;&nbsp;Valid until <strong style="color:${C.mist50};">${escapeHtml(input.expires)}</strong></p>
</td></tr>`;
  const steps = INVITE_STEPS.map(
    ([title, detail], i) =>
      `<td class="tr-stack" valign="top" width="33%" style="padding:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tr-step" valign="top" height="112" style="height:112px;padding:16px;border-radius:14px;background-color:${C.mist50};"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="28" height="28" style="width:28px;height:28px;border-radius:50%;background-color:${C.canopy800};font-family:${DISPLAY_FONT};font-size:13px;font-weight:700;color:${C.pollen300};">${i + 1}</td></tr></table><p style="margin:10px 0 4px;font-family:${BODY_FONT};font-size:14px;font-weight:700;color:${C.canopy900};">${escapeHtml(title)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:13px;line-height:19px;color:${C.text};">${escapeHtml(detail)}</p></td></tr></table></td>`,
  ).join('');
  const features = INVITE_FEATURES.map(
    ([title, detail, tile]) =>
      `<tr><td valign="top" width="54" style="padding:0 14px 16px 0;">${mailIcon(input.appOrigin, tile, 40)}</td><td valign="top" style="padding:0 0 14px;"><p style="margin:0 0 2px;font-family:${BODY_FONT};font-size:15px;font-weight:700;color:${C.canopy900};">${escapeHtml(title)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.text};">${escapeHtml(detail)}</p></td></tr>`,
  ).join('');
  const body = `${heading('Three steps and you are in')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="tr-grid" style="margin:0 -6px 22px;"><tr>${steps}</tr></table>
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
      body: `${eyebrow('Account security', C.canopy700, mailIcon(input.appOrigin, 'lock.png', 16))}${h1('Reset your TreeRepro password')}
${mailParagraph(`Hello ${input.name},`)}
${mailParagraph('Someone asked to reset the password of your TreeRepro account. Choose a new one with the button below.')}
${spacer(8)}${mailButton(input.appOrigin, input.link, 'Choose a new password')}${spacer(24)}
${mailNote(`The link expires on <strong>${escapeHtml(expires)}</strong>.`, 'mist', mailIcon(input.appOrigin, 'clock-dark.png', 18))}
${mailNote('Did not ask for this? Ignore this email. Your password stays unchanged.', 'amber', mailIcon(input.appOrigin, 'alert.png', 18))}
${mailFallbackLink(input.link)}`,
      footer:
        'You receive this email because a password reset was requested for this address on TreeRepro.',
    }),
  };
}

/**
 * The digest's contest list: a heading, one entry per contest with a link —
 * to the drawer of the record it created, or to the species page when it
 * created none — or `None.`
 */
function digestSection(title: string, items: readonly DigestItem[], appOrigin: string): string[] {
  if (items.length === 0) return [title, '', 'None.', ''];
  return [
    title,
    '',
    ...items.flatMap((item) => [
      `- ${item.speciesName} — ${item.traitKey}: contests ${item.contested} (${item.actorName})`,
      // The `?record=` search param opens the record drawer on the species page.
      `  ${appOrigin}/app/species/${item.speciesId}${item.recordId ? `?record=${item.recordId}` : ''}`,
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
  const head = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding-bottom:8px;border-bottom:1px solid ${C.rule};font-family:${DISPLAY_FONT};font-size:15px;font-weight:600;color:${C.canopy800};">${escapeHtml(title)}</td><td align="right" style="padding-bottom:8px;border-bottom:1px solid ${C.rule};font-family:${BODY_FONT};font-size:13px;color:${C.muted};">Up to ${DIGEST_LIST_LIMIT} listed</td></tr></table>`;
  if (items.length === 0)
    return `${head}${spacer(8)}${mailNote('None in this window.', 'grey', mailIcon(appOrigin, 'check.png', 18))}`;
  const rows = items
    .map((item, i) => {
      // The `?record=` search param opens the record drawer; a contest that
      // created none links to the species page instead (same rule as the
      // plain-text list).
      const href = `${appOrigin}/app/species/${item.speciesId}${item.recordId ? `?record=${item.recordId}` : ''}`;
      const border = i === items.length - 1 ? '' : `border-bottom:1px solid ${C.mist50};`;
      return `<tr><td valign="middle" style="padding:14px 12px 14px 0;${border}"><p style="margin:0 0 4px;font-family:${BODY_FONT};font-size:15px;font-weight:600;font-style:italic;color:${C.canopy900};">${escapeHtml(item.speciesName)}</p><p style="margin:0;font-family:${BODY_FONT};font-size:14px;line-height:21px;color:${C.text};"><span style="font-family:Menlo,Consolas,monospace;font-size:12px;padding:2px 6px;border-radius:6px;background-color:${C.mist50};color:${C.canopy800};">${escapeHtml(item.traitKey)}</span> contests ${escapeHtml(item.contested)} &middot; by ${escapeHtml(item.actorName)}</p></td><td align="right" valign="middle" style="padding:14px 0;${border}white-space:nowrap;"><a href="${escapeHtml(href)}" style="font-family:${BODY_FONT};font-size:14px;font-weight:600;color:${C.canopy700};text-decoration:none;">Open record</a></td></tr>`;
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
            `<td class="tr-tile" valign="top" width="${Math.floor(100 / columns)}%" style="padding:5px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:${dark ? '18px 20px' : '14px'};border-radius:12px;background-color:${dark ? C.canopy900 : C.mist50};"><p style="margin:0;font-family:${DISPLAY_FONT};font-size:${dark ? 32 : 24}px;font-weight:600;line-height:1.2;color:${dark ? C.pollen400 : C.canopy900};">${value}</p><p style="margin:2px 0 0;font-family:${BODY_FONT};font-size:13px;line-height:18px;color:${dark ? C.mist100 : C.text};">${escapeHtml(label)}</p></td></tr></table></td>`,
        )
        .join('')}${pad.join('')}</tr>`,
    );
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="tr-grid" style="margin:0 -5px;">${rows.join('')}</table>`;
}

function digestHtml(input: {
  digest: Digest;
  appOrigin: string;
  date: string;
  resent: boolean;
}): string {
  const { counts, window, contests } = input.digest;
  const beforeCard = input.resent
    ? mailNote(
        `<strong>Resent:</strong> ${escapeHtml(DIGEST_RESENT_LINE.replace(/^Resent: /, ''))}`,
        'amber',
        mailIcon(input.appOrigin, 'refresh.png', 18),
      )
    : '';
  const body = `${eyebrow('Daily digest', C.bark700)}${h1('Activity on TreeRepro', C.canopy900, 26)}
<p style="margin:-10px 0 28px;font-family:${BODY_FONT};font-size:15px;color:${C.muted};">From ${escapeHtml(formatUtc(window.start))} to ${escapeHtml(formatUtc(window.end))}</p>
${heading('Waiting for review right now', C.canopy800)}
${tiles(
  [
    ['Pending groups', counts.pendingGroups],
    ['Open contests', counts.contestedNow],
  ],
  2,
  true,
)}
${spacer(14)}${mailButton(input.appOrigin, `${input.appOrigin}/app/curation/pending`, 'Open the review queue')}${spacer(30)}
${heading('In this window', C.canopy800)}
${tiles(
  [
    ['Records added', counts.records],
    ['Contests', counts.contests],
    ['Complements', counts.complements],
    ['Validations', counts.validations],
    ['Withdrawals', counts.withdrawals],
    ['Species proposals', counts.proposals],
  ],
  4,
  false,
)}
<p style="margin:8px 0 28px;font-family:${BODY_FONT};font-size:13px;color:${C.muted};">Records added includes contests and complements, which are records too.</p>
${digestSectionHtml('Contests', contests, input.appOrigin)}`;
  return emailLayout({
    appOrigin: input.appOrigin,
    title: `TreeRepro digest — ${input.date}`,
    preheader: `${counts.pendingGroups} pending groups and ${counts.contestedNow} open contests waiting for review.`,
    headerNote: `Daily digest · ${input.date}`,
    beforeCard,
    body,
    footer:
      'You receive this digest because your role can review records on TreeRepro. It is sent once a day, on days with activity.',
  });
}

/**
 * The daily digest as plain text: the window's counts, the queues as they
 * stand and the newest contests, each linking to its record drawer.
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
  const { counts, window, contests } = input.digest;
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
      `Withdrawals: ${counts.withdrawals}`,
      `Species proposals: ${counts.proposals}`,
      '',
      'Waiting for review right now:',
      '',
      `Pending groups: ${counts.pendingGroups}`,
      `Open contests: ${counts.contestedNow}`,
      '',
      ...digestSection('Contests', contests, input.appOrigin),
      'TreeRepro',
    ].join('\n'),
    html: digestHtml({ ...input, resent: input.resent === true }),
  };
}
