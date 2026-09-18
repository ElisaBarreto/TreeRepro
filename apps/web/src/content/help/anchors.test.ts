import { describe, expect, it } from 'vitest';
import { HELP_ANCHORS } from './index.ts';

// Every component source of the web app, read as text: a "Learn more" target
// is a pair of string literals, and a broken one is a link that silently
// lands on the top of a topic (or on no topic at all). Only a grep can check
// them all without mounting every screen that carries a tip. `as: 'raw'` is
// deprecated since Vite 5; `query`/`import` is the replacement.
const sources = import.meta.glob('../../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// `helpHref('workflow', 'validate')` and `helpHref('faq')`, in that order of
// capture groups. Only literal arguments are matched — a computed slug is not
// a link this test could follow anyway.
const CALL = /helpHref\(\s*'([a-z-]+)'\s*(?:,\s*'([a-z-]+)'\s*)?\)/g;

interface Wiring {
  file: string;
  slug: string;
  anchor?: string;
}

function wirings(): Wiring[] {
  const found: Wiring[] = [];
  for (const [file, source] of Object.entries(sources)) {
    // The topic bodies themselves link to other topics; those are checked
    // here too, and so is every tip.
    for (const match of source.matchAll(CALL)) {
      found.push({ file, slug: match[1] as string, anchor: match[2] });
    }
  }
  return found;
}

// The tips of plan 09b, by the file that holds them (RFC-73 R4). The scope
// toggle has no tip, so it has no wiring; adding one is not this plan's work.
const WIRED_FILES: readonly [string, string][] = [
  ['components/curation/RecordActions.tsx', 'workflow#validate'],
  ['components/curation/RecordActions.tsx', 'workflow#different'],
  ['components/curation/SourcesField.tsx', 'references#doi'],
  ['components/curation/AddEntriesDialog.tsx', 'vocabulary#descriptions'],
  ['components/dataset/EmptyTraitCard.tsx', 'vocabulary#descriptions'],
  ['components/dataset/TraitCard.tsx', 'vocabulary#descriptions'],
];

describe('RFC-73 R4 help anchors', () => {
  it('names a topic and an anchor that exist at every call site', () => {
    const found = wirings();
    expect(found.length).toBeGreaterThan(0);
    for (const { file, slug, anchor } of found) {
      expect(Object.keys(HELP_ANCHORS), `${file} links to unknown topic "${slug}"`).toContain(slug);
      if (anchor !== undefined) {
        expect(HELP_ANCHORS[slug], `${file} links to "${slug}#${anchor}"`).toContain(anchor);
      }
    }
  });

  it('gives every help tip of plan 09b its "Learn more" target', () => {
    const found = wirings();
    for (const [file, target] of WIRED_FILES) {
      const [slug, anchor] = target.split('#');
      expect(
        found.some((w) => w.file.endsWith(file) && w.slug === slug && w.anchor === anchor),
        `${file} has no learnMore to ${target}`,
      ).toBe(true);
    }
  });
});
