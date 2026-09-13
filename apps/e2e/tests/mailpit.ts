import { type APIRequestContext, expect } from '@playwright/test';
import { MAILPIT_URL } from './env.ts';

interface SearchResult {
  messages: { ID: string }[];
}
interface Message {
  Text: string;
}

/**
 * The newest message Mailpit holds for `to` that contains a link of `kind`
 * (`/invite/<token>` or `/reset-password/<token>`), polled until it arrives.
 * Mailpit's search answers newest first; the emails are text-only (the API's
 * templates), so the link is a plain URL in `Text`.
 */
export async function waitForLink(
  request: APIRequestContext,
  to: string,
  kind: 'invite' | 'reset-password',
): Promise<string> {
  const pattern = new RegExp(`https?://[^\\s"<>]+/${kind}/[A-Za-z0-9_-]{43}`);
  let link: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await request.get(
          `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`,
        );
        const { messages } = (await search.json()) as SearchResult;
        for (const { ID } of messages) {
          const message = (await (
            await request.get(`${MAILPIT_URL}/api/v1/message/${ID}`)
          ).json()) as Message;
          const found = message.Text.match(pattern);
          if (found) {
            link = found[0];
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000, message: `no ${kind} email for ${to} in Mailpit` },
    )
    .toBe(true);
  if (!link) throw new Error('unreachable: poll succeeded without a link');
  return link;
}
