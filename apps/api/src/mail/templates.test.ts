import { describe, expect, it } from 'vitest';
import type { Digest, DigestItem } from '../jobs/digest.ts';
import { digestEmail, inviteEmail, passwordResetEmail } from './templates.ts';

const expiresAt = new Date('2026-09-15T10:00:00Z');

describe('RFC-20 R4, RFC-21 R5 email templates', () => {
  it('invitation carries the link, the expiry and the name', () => {
    const mail = inviteEmail({ name: 'Ada', link: 'http://localhost/invite/abc', expiresAt });
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
    });
    expect(mail.subject).toBe('Reset your TreeRepro password');
    expect(mail.text).toContain('http://localhost/reset-password/abc');
    expect(mail.text).toMatch(/ignore this email/i);
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
