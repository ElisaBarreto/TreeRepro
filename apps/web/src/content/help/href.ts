/**
 * The link to a help topic, optionally to one of its sections — the single
 * place the help URL shape is written (RFC-73 R2). It answers one plain
 * string, `#anchor` included, and callers hand that string straight to a
 * router `Link`'s `to`: TanStack Router splits the fragment out itself when
 * it builds the location, so `/app/help/workflow#contest` navigates to
 * pathname `/app/help/workflow` with hash `contest` and the rendered `href`
 * keeps its literal `#` (no `%23`). `HelpTip.test.tsx` holds that to a test
 * that asserts the router's resulting location, not just the markup, because
 * a `to` that percent-encoded the `#` would break every "Learn more" link at
 * once.
 *
 * It lives in its own module rather than in `index.ts` for two reasons: the
 * topic bodies link to one another and `index.ts` imports them, so the shared
 * helper there would be an import cycle; and a screen carrying a `?` tip then
 * imports this function alone instead of all eight topics.
 * @rfc RFC-73 R2, R4
 */
export function helpHref(slug: string, anchor?: string): string {
  return `/app/help/${slug}${anchor ? `#${anchor}` : ''}`;
}
