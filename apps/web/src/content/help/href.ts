/**
 * The link to a help topic, optionally to one of its sections — the single
 * place the help URL shape is written (RFC-73 R2). It answers a plain
 * string; `HelpTip` splits the hash off before handing the path to the
 * router, whose `to` is a pathname and would percent-encode a `#` inside it.
 *
 * It lives in its own module rather than in `index.ts` so the topic bodies,
 * which `index.ts` imports, can link to one another without an import cycle.
 * @rfc RFC-73 R2, R4
 */
export function helpHref(slug: string, anchor?: string): string {
  return `/app/help/${slug}${anchor ? `#${anchor}` : ''}`;
}
