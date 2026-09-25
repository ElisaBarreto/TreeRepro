import type { Page } from '@playwright/test';

/**
 * Types `text` into the species search on `/app/species` and waits for the
 * list request carrying it. The page debounces the name for 300 ms, and the
 * list shown before that can already hold the row a spec is after: clicking
 * it then races the re-render that replaces it, a race parallel workers make
 * likely (issue #165). Needs `text` to be at least two characters after
 * trimming, the minimum the page sends.
 */
export async function searchSpecies(page: Page, text: string): Promise<void> {
  const answered = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'GET' &&
      url.pathname === '/api/species' &&
      url.searchParams.get('q') === text.trim()
    );
  });
  await page.getByLabel('Search species').fill(text);
  await answered;
}
