import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { Secret } from '../config.ts';
import { createMailer, createSmtpTransport, MAIL_TIMEOUT_MS } from './mailer.ts';

describe('RFC-10 R5 SMTP mailer', () => {
  it('sends from the configured address through the transport', async () => {
    const sendMail = vi.fn().mockResolvedValue({});
    const mailer = createMailer({ sendMail }, 'TreeRepro <no-reply@localhost>');
    await mailer.send({
      to: 'ada@example.test',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'TreeRepro <no-reply@localhost>',
      to: 'ada@example.test',
      subject: 'Hi',
      text: 'Hello',
      html: '<p>Hello</p>',
    });
  });

  it('serializes a real message with nodemailer (stream transport)', async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: 'unix',
    });
    const spy = vi.spyOn(transport, 'sendMail');
    await createMailer(transport, 'no-reply@localhost').send({
      to: 'ada@example.test',
      subject: 'Subj',
      text: 'Body',
      html: '<p>Rich</p>',
    });
    const info = (await spy.mock.results[0]?.value) as { message: Buffer };
    const raw = info.message.toString();
    expect(raw).toContain('Subject: Subj');
    expect(raw).toContain('To: ada@example.test');
    expect(raw).toContain('Body');
    // RFC-10 R16: both parts travel, the text one first.
    expect(raw).toContain('multipart/alternative');
    expect(raw).toContain('<p>Rich</p>');
    expect(raw.indexOf('text/plain')).toBeLessThan(raw.indexOf('text/html'));
  });

  it('propagates transport failures', async () => {
    const mailer = createMailer(
      { sendMail: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      'x@y',
    );
    await expect(mailer.send({ to: 'a@b', subject: 's', text: 't', html: 'h' })).rejects.toThrow(
      'ECONNREFUSED',
    );
  });

  it('builds an SMTP transport with timeouts and optional auth without exposing the password', () => {
    const anon = createSmtpTransport({ host: 'mailpit', port: 1025, secure: false, from: 'x@y' });
    expect(anon.options).toMatchObject({
      host: 'mailpit',
      port: 1025,
      secure: false,
      connectionTimeout: MAIL_TIMEOUT_MS,
    });
    expect((anon.options as { auth?: unknown }).auth).toBeUndefined();
    const auth = createSmtpTransport({
      host: 'smtp',
      port: 587,
      secure: false,
      from: 'x@y',
      user: 'u',
      password: new Secret('pw'),
    });
    expect((auth.options as { auth?: { user: string; pass: string } }).auth).toEqual({
      user: 'u',
      pass: 'pw',
    });
  });
});
