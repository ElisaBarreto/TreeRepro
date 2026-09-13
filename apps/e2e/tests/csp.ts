import type { BrowserContext } from '@playwright/test';

export interface CspWatch {
  /** One line per report: the violated directive and the blocked URI, or the console text. */
  violations: string[];
}

const MARK = 'CSP_VIOLATION';

/**
 * Collects every Content-Security-Policy violation on every page of the
 * context: a `securitypolicyviolation` listener installed before any script
 * runs (so violations during load are seen) writes a marked console error,
 * and the console listener keeps those plus the browser's own CSP messages.
 */
export async function watchCsp(context: BrowserContext): Promise<CspWatch> {
  const watch: CspWatch = { violations: [] };
  await context.addInitScript((mark: string) => {
    document.addEventListener('securitypolicyviolation', (event) => {
      // biome-ignore lint/suspicious/noConsole: runs in the page, the console is the channel back to the test
      console.error(
        `${mark} ${event.violatedDirective} ${event.blockedURI || '(inline)'} at ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  }, MARK);
  context.on('page', (page) => {
    page.on('console', (message) => {
      const text = message.text();
      if (
        message.type() === 'error' &&
        (text.includes(MARK) || /Content.Security.Policy/i.test(text))
      ) {
        watch.violations.push(text);
      }
    });
  });
  return watch;
}
