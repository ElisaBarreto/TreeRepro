import { randomBytes } from 'node:crypto';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8026';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@e2e.test';

/** The invitation link `scripts/e2e.sh` read from `seed-admin`; the suite starts by accepting it. */
export function adminInviteLink(): string {
  const link = process.env.E2E_ADMIN_INVITE_LINK;
  if (!link)
    throw new Error('E2E_ADMIN_INVITE_LINK is not set: run the suite through `pnpm test:e2e`');
  return link;
}

/** A fresh password per call: long enough for RFC-21 and never in a breach list. */
export function password(): string {
  return `Pw-${randomBytes(6).toString('hex')}-Tree!`;
}
