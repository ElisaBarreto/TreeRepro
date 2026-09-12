import type { Mailer, MailMessage } from '../../src/mail/mailer.ts';

export interface FakeMailer {
  mailer: Mailer;
  sent: MailMessage[];
  /** Makes the next send reject with `error`. */
  failNext(error: Error): void;
}

export function createFakeMailer(): FakeMailer {
  const sent: MailMessage[] = [];
  let pending: Error | null = null;
  return {
    sent,
    failNext(error) {
      pending = error;
    },
    mailer: {
      async send(message) {
        if (pending) {
          const err = pending;
          pending = null;
          throw err;
        }
        sent.push(message);
      },
    },
  };
}
