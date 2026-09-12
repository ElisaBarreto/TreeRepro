import nodemailer, { type Transporter } from 'nodemailer';
import type { SmtpSettings } from '../config.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
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
 * @rfc RFC-20 R4
 * @rfc RFC-21 R5
 */
export function createMailer(transport: Pick<Transporter, 'sendMail'>, from: string): Mailer {
  return {
    async send(message) {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
