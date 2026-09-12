import { describe, expect, it } from 'vitest';
import { inviteEmail, passwordResetEmail } from './templates.ts';

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
