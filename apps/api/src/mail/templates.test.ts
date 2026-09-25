import { describe, expect, it } from 'vitest';
import type { Digest, DigestItem } from '../jobs/digest.ts';
import { digestEmail, inviteEmail, passwordResetEmail } from './templates.ts';

const expiresAt = new Date('2026-09-15T10:00:00Z');

const ORIGIN = 'http://localhost';

describe('RFC-20 R4, RFC-21 R5 email templates', () => {
  it('invitation carries the link, the expiry and the name', () => {
    const mail = inviteEmail({
      name: 'Ada',
      link: 'http://localhost/invite/abc',
      expiresAt,
      appOrigin: ORIGIN,
    });
    expect(mail.subject).toBe('You have been invited to TreeRepro');
    expect(mail.text).toContain('Ada');
    expect(mail.text).toContain('http://localhost/invite/abc');
    expect(mail.text).toContain('2026-09-15 10:00 UTC');
  });

  it('password reset carries the link and says to ignore it if not requested', () => {
    const mail = passwordResetEmail({
      name: 'Ada',
      link: 'http://localhost/reset-password/abc',
      expiresAt,
      appOrigin: ORIGIN,
    });
    expect(mail.subject).toBe('Reset your TreeRepro password');
    expect(mail.text).toContain('http://localhost/reset-password/abc');
    expect(mail.text).toMatch(/ignore this email/i);
  });
});

describe('RFC-10 R16 HTML parts of the account e-mails', () => {
  it('the invitation welcomes by name and links the button and the fallback to the invite', () => {
    const mail = inviteEmail({
      name: 'Ada',
      link: 'http://localhost/invite/abc',
      expiresAt,
      appOrigin: ORIGIN,
    });
    expect(mail.html).toContain('Welcome to TreeRepro, Ada');
    expect(mail.html.match(/href="http:\/\/localhost\/invite\/abc"/g)).toHaveLength(2);
    expect(mail.html).toContain('2026-09-15 10:00 UTC');
    expect(mail.html).toContain('>Join&nbsp;&nbsp;<img');
    // Every design element the canvas shows reaches the markup (issue #173).
    for (const file of [
      'hero-bg.jpg',
      'rings.png',
      'mail.png',
      'clock.png',
      'arrow.png',
      'search.png',
      'leaf.png',
      'shield.png',
      'emblem.png',
    ])
      expect(mail.html).toContain(`${ORIGIN}/email/${file}`);
    expect(mail.html).toContain(
      'Collaborate with us in assembling the largest repository of tree reproductive traits',
    );
  });

  it('RFC-20 R4 an expired invitation points to the configured contact, else to an administrator', () => {
    const base = { name: 'Ada', link: 'http://localhost/invite/abc', expiresAt, appOrigin: ORIGIN };
    const withContact = inviteEmail({ ...base, contactEmail: 'help@treerepro.test' });
    expect(withContact.text).toContain('ask help@treerepro.test for a new invitation');
    expect(withContact.html).toContain('ask help@treerepro.test for a new invitation');
    const without = inviteEmail(base);
    expect(without.text).toContain('ask an administrator for a new invitation');
    expect(without.html).toContain('ask an administrator for a new invitation');
  });

  it('the password reset links to the reset page and says to ignore it if not requested', () => {
    const mail = passwordResetEmail({
      name: 'Ada',
      link: 'http://localhost/reset-password/abc',
      expiresAt,
      appOrigin: ORIGIN,
    });
    expect(mail.html).toContain('href="http://localhost/reset-password/abc"');
    expect(mail.html).toContain('2026-09-15 10:00 UTC');
    expect(mail.html).toMatch(/ignore this email/i);
  });

  it('escapes a name and a link that carry markup', () => {
    const hostile = { name: '<img src=x onerror=alert(1)>', link: 'http://localhost/x?a="><b>' };
    for (const mail of [
      inviteEmail({ ...hostile, expiresAt, appOrigin: ORIGIN }),
      passwordResetEmail({ ...hostile, expiresAt, appOrigin: ORIGIN }),
    ]) {
      expect(mail.html).not.toContain('<img src=x');
      expect(mail.html).not.toContain('"><b>');
      expect(mail.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
});

const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  speciesId: '018f2a00-0000-7000-8000-000000000001',
  speciesName: 'Cecropia pachystachya',
  traitKey: 'fruit_type',
  valueText: 'berry',
  actorName: 'Ada Lovelace',
  recordId: '018f2a00-0000-7000-8000-0000000000aa',
  createdAt: new Date('2026-09-17T09:30:00Z'),
  ...over,
});

const digest = (over: Partial<Digest> = {}): Digest => ({
  window: { start: new Date('2026-09-16T06:00:00Z'), end: new Date('2026-09-17T06:00:00Z') },
  counts: {
    records: 2,
    contests: 1,
    complements: 1,
    validations: 3,
    disputes: 1,
    withdrawals: 1,
    proposals: 0,
    pendingGroups: 4,
    disputedNow: 2,
  },
  contests: [item()],
  disputes: [
    item({
      speciesId: '018f2a00-0000-7000-8000-000000000002',
      speciesName: 'Inga edulis',
      traitKey: 'leaf_type',
      valueText: 'compound',
      actorName: 'Grace Hopper',
      recordId: '018f2a00-0000-7000-8000-0000000000bb',
    }),
  ],
  ...over,
});

const APP_ORIGIN = 'https://treerepro.example';

describe('RFC-74 R5 digestEmail', () => {
  it('the subject names the digest and its date', () => {
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    expect(mail.subject).toBe('TreeRepro digest — 2026-09-17');
  });

  it('carries every count of R3, the window activity and the current queue sizes apart', () => {
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    expect(mail.text).toContain('Records added (contests and complements included): 2');
    expect(mail.text).toContain('Contests: 1');
    expect(mail.text).toContain('Complements: 1');
    expect(mail.text).toContain('Validations: 3');
    expect(mail.text).toContain('Disputes: 1');
    expect(mail.text).toContain('Withdrawals: 1');
    expect(mail.text).toContain('Species proposals: 0');
    expect(mail.text).toContain('Pending groups: 4');
    expect(mail.text).toContain('Disputed records: 2');
    expect(mail.text).toContain('2026-09-16 06:00 UTC');
    expect(mail.text).toContain('2026-09-17 06:00 UTC');
  });

  it('lists both sets with the species, the trait, the value and the actor name', () => {
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    expect(mail.text).toContain('Cecropia pachystachya');
    expect(mail.text).toContain('fruit_type');
    expect(mail.text).toContain('berry');
    expect(mail.text).toContain('Ada Lovelace');
    expect(mail.text).toContain('Inga edulis');
    expect(mail.text).toContain('leaf_type');
    expect(mail.text).toContain('compound');
    expect(mail.text).toContain('Grace Hopper');
  });

  it('links each item to the record drawer on the species page', () => {
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    expect(mail.text).toContain(
      `${APP_ORIGIN}/app/species/018f2a00-0000-7000-8000-000000000001?record=018f2a00-0000-7000-8000-0000000000aa`,
    );
    expect(mail.text).toContain(
      `${APP_ORIGIN}/app/species/018f2a00-0000-7000-8000-000000000002?record=018f2a00-0000-7000-8000-0000000000bb`,
    );
  });

  it('never carries an e-mail address', () => {
    // RFC-74 R5: names are decrypted for the recipients, addresses never travel.
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    expect(mail.text).not.toContain('@');
    expect(mail.subject).not.toContain('@');
  });

  it('opens with the resend line, and leaves the subject alone, when the run is a repeat', () => {
    const mail = digestEmail({
      digest: digest(),
      appOrigin: APP_ORIGIN,
      date: '2026-09-17',
      resent: true,
    });
    // R5 fixes the subject; a repeat must not change what an inbox filter or
    // a thread groups on.
    expect(mail.subject).toBe('TreeRepro digest — 2026-09-17');
    expect(mail.text.split('\n')[0]).toBe(
      'Resent: the previous run for this window did not finish, so part of this summary may have reached you already.',
    );
    // The rest of the e-mail is untouched — the line is a prefix, not a mode.
    expect(mail.text).toContain('Records added (contests and complements included): 2');
    expect(mail.text).not.toContain('@');
  });

  it('RFC-10 R16 the HTML part carries the counts, the queues and each item linked to its drawer', () => {
    const mail = digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' });
    for (const label of [
      'Records added',
      'Contests',
      'Complements',
      'Validations',
      'Disputes',
      'Withdrawals',
      'Species proposals',
      'Pending groups',
      'Disputed records',
    ])
      expect(mail.html).toContain(label);
    expect(mail.html).toContain('Cecropia pachystachya');
    expect(mail.html).toContain('Grace Hopper');
    expect(mail.html).toContain(
      `href="${APP_ORIGIN}/app/species/018f2a00-0000-7000-8000-000000000001?record=018f2a00-0000-7000-8000-0000000000aa"`,
    );
    expect(mail.html).toContain(`href="${APP_ORIGIN}/app/curation/pending"`);
    expect(mail.html).toContain('2026-09-16 06:00 UTC');
    // RFC-74 R5: no address; the layout's own `@` are its CSS at-rules.
    expect(mail.html.replace(/@(media|font-face)/g, '')).not.toContain('@');
    expect(mail.html).not.toContain('Resent');
  });

  it('RFC-10 R16 the HTML part shows the resend line on a repeat and escapes record text', () => {
    const mail = digestEmail({
      digest: digest({
        contests: [
          item({
            speciesName: '<i>s</i>',
            traitKey: '<u>k</u>',
            valueText: '<b>x</b>',
            actorName: 'A & B',
          }),
        ],
      }),
      appOrigin: APP_ORIGIN,
      date: '2026-09-17',
      resent: true,
    });
    expect(mail.html).toContain('the previous run for this window did not finish');
    expect(mail.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(mail.html).toContain('A &amp; B');
    expect(mail.html).toContain('&lt;i&gt;s&lt;/i&gt;');
    expect(mail.html).toContain('&lt;u&gt;k&lt;/u&gt;');
  });

  it('RFC-10 R16 the HTML part says so when a set is empty', () => {
    const mail = digestEmail({
      digest: digest({ contests: [], disputes: [] }),
      appOrigin: APP_ORIGIN,
      date: '2026-09-17',
    });
    expect(mail.html.match(/None in this window\./g)).toHaveLength(2);
    expect(mail.html).not.toContain(`${APP_ORIGIN}/app/species/`);
  });

  it('carries no resend line on an ordinary run', () => {
    for (const mail of [
      digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17' }),
      digestEmail({ digest: digest(), appOrigin: APP_ORIGIN, date: '2026-09-17', resent: false }),
    ]) {
      expect(mail.text).not.toContain('Resent');
      expect(mail.text.split('\n')[0]).toContain('Activity on TreeRepro from');
    }
  });

  it('says so rather than showing an empty list when a set is empty', () => {
    const mail = digestEmail({
      digest: digest({ contests: [], disputes: [] }),
      appOrigin: APP_ORIGIN,
      date: '2026-09-17',
    });
    // Whole lines, not substrings: `Contests: 1` would satisfy a `toContain`
    // and leave the heading itself unasserted.
    const lines = mail.text.split('\n');
    expect(lines).toContain('Contests');
    expect(lines).toContain('Disputes');
    expect(lines.filter((line) => line === 'None.')).toHaveLength(2);
    expect(mail.text).not.toContain(`${APP_ORIGIN}/app/species/`);
  });
});
