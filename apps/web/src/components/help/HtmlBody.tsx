import { useNavigate } from '@tanstack/react-router';
import type { MouseEvent } from 'react';

/**
 * A help section's stored HTML, sanitised by the API before it was saved
 * (RFC-73 R8). A plain click on a link to a same-origin path navigates inside
 * the app instead of reloading it; a modified click (new tab) is left alone.
 * @rfc RFC-73 R8
 */
export function HtmlBody({ html }: { html: string }) {
  const navigate = useNavigate();
  function onClick(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest('a');
    const href = link?.getAttribute('href');
    if (!link || !href?.startsWith('/') || href.startsWith('//') || link.target) return;
    event.preventDefault();
    void navigate({ to: href });
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates clicks of the links inside; the links themselves are the interactive elements.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Enter on a focused link fires the same click event.
    <div
      onClick={onClick}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the API sanitises every body before storing it (RFC-73 R8).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
