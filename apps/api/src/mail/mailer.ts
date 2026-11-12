import { PLATFORM_NAMES, type Platform } from '@treerepro/contracts';
import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpSettings } from '../config.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** The platform the mail is sent for; TreeRepro when absent (RFC-10 R16). */
  platform?: Platform;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Connection, greeting and socket timeout. @rfc RFC-10 R5 */
export const MAIL_TIMEOUT_MS = 5000;

/** @rfc RFC-10 R5 */
export function createSmtpTransport(settings: SmtpSettings): Transporter {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    ...(settings.user && settings.password
      ? { auth: { user: settings.user, pass: settings.password.expose() } }
      : {}),
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  });
}

/**
 * The sender of a platform's mail: `SMTP_FROM` as configured for TreeRepro;
 * for another platform the same address under that platform's name.
 */
function senderFor(from: string, platform: Platform | undefined) {
  if (platform === undefined || platform === 'treerepro') return from;
  const address = /<([^>]+)>\s*$/.exec(from)?.[1] ?? from.trim();
  return { name: PLATFORM_NAMES[platform], address };
}

/**
 * Multipart: nodemailer puts `text` before `html`, so a client that cannot
 * render the HTML shows the plain text (RFC-10 R16).
 * @rfc RFC-20 R4
 * @rfc RFC-21 R5
 * @rfc RFC-10 R16
 * @rfc RFC-10 R5
 * @rfc RFC-10 R16
 */
export function createMailer(
  transport: Pick<Transporter, 'sendMail'>,
  from: string,
  replyTo?: string,
): Mailer {
  return {
    async send(message) {
      await transport.sendMail({
        from: senderFor(from, message.platform),
        ...(replyTo ? { replyTo } : {}),
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
