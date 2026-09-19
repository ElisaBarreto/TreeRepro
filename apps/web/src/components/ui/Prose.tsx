import type { ReactNode } from 'react';

/**
 * Long-form text — a help topic — laid out by one class rather than by a
 * utility on every element. The `.prose-treerepro` rules of `styles.css`
 * style the headings, paragraphs, lists and links of whatever is nested
 * here, so an author writes plain `<h2 id="contest">` and the ids survive
 * for a `#anchor` link to land on (RFC-73 R2). A stylesheet is allowed where
 * a `style` attribute is not (RFC-13 R5).
 * @rfc RFC-13 R5
 * @rfc RFC-73 R2
 */
export function Prose({ children }: { children: ReactNode }) {
  return <article className="prose-treerepro">{children}</article>;
}
