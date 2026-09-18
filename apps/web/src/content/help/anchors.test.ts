import { describe, expect, it } from 'vitest';
import { HELP_ANCHORS } from './index.ts';

// Every source of the web app, read as text. A "Learn more" target is a pair
// of string literals, and a broken one is a link that silently lands on the
// top of a topic — or on no topic at all. Only a grep can check them all
// without mounting every screen that carries a tip.
//
// `.ts` as well as `.tsx`: the five tip components are `.tsx` today, but a
// link built in a plain `.ts` module would be just as breakable and must not
// be invisible here. `as: 'raw'` is deprecated since Vite 5; `query`/`import`
// is the replacement.
const raw = import.meta.glob('../../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

// Vite keys a glob relative to the importing file, so this test's own
// siblings come back as `./href.ts` while everything else carries `../../`.
// Both are rewritten to one path under `src/`, so the lists below can be
// written the way a reader would say them.
function underSrc(file: string): string {
  return file.startsWith('../../')
    ? file.slice('../../'.length)
    : `content/help/${file.replace(/^\.\//, '')}`;
}

// This file quotes the patterns it looks for, so scanning itself would check
// its own comments instead of the app.
const sources: [string, string][] = Object.entries(raw)
  .map(([file, source]): [string, string] => [underSrc(file), source])
  .filter(([file]) => file !== 'content/help/anchors.test.ts');

// Both arguments are captured as `[^']*`, not as a slug-shaped pattern: a
// target whose slug or anchor carries a digit, a capital or a typo must be
// CHECKED and fail below, never quietly skipped for not looking like one.
const LITERAL = "'([^']*)'";
const CALL = new RegExp(`helpHref\\(\\s*${LITERAL}\\s*(?:,\\s*${LITERAL}\\s*)?\\)`, 'g');
// The same call, but only where it is the `learnMore` of a help tip — what
// RFC-73 R4 is actually about. A bare mention elsewhere in the file must not
// satisfy the wiring check below.
const LEARN_MORE = new RegExp(
  `learnMore=\\{helpHref\\(\\s*${LITERAL}\\s*(?:,\\s*${LITERAL}\\s*)?\\)\\}`,
  'g',
);
// Every call, literal arguments or not: the count guard below compares this
// against what `CALL` understood, so a computed slug fails loudly instead of
// dropping out of the scan.
const ANY_CALL = /helpHref\(/g;

// The three places a `helpHref(` this test cannot read is expected and safe:
// its own definition, and the index page (with its test) mapping over
// `HELP_TOPICS`, where every slug is a topic by construction. Anywhere else,
// a call with a computed slug is a link nothing checks, and the guard says so.
const UNREADABLE_OK: readonly string[] = [
  'content/help/href.ts',
  'pages/help/HelpIndexPage.tsx',
  'pages/help/HelpIndexPage.test.tsx',
];

interface Wiring {
  file: string;
  slug: string;
  anchor?: string;
}

function scan(pattern: RegExp): Wiring[] {
  const found: Wiring[] = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(pattern)) {
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
    const found = scan(CALL);
    expect(found.length).toBeGreaterThan(0);
    for (const { file, slug, anchor } of found) {
      expect(Object.keys(HELP_ANCHORS), `${file} links to unknown topic "${slug}"`).toContain(slug);
      if (anchor !== undefined) {
        expect(HELP_ANCHORS[slug], `${file} links to "${slug}#${anchor}"`).toContain(anchor);
      }
    }
  });

  it('understands every helpHref call it finds, so none is skipped unchecked', () => {
    for (const [file, source] of sources) {
      if (UNREADABLE_OK.includes(file)) continue;
      const all = source.match(ANY_CALL)?.length ?? 0;
      const understood = Array.from(source.matchAll(CALL)).length;
      expect(
        understood,
        `${file} calls helpHref with something this test cannot read (a computed slug?); check it by hand or give it string literals`,
      ).toBe(all);
    }
  });

  it('gives every help tip of plan 09b its "Learn more" target', () => {
    const found = scan(LEARN_MORE);
    for (const [file, target] of WIRED_FILES) {
      const [slug, anchor] = target.split('#');
      expect(
        found.some((w) => w.file === file && w.slug === slug && w.anchor === anchor),
        `${file} has no learnMore to ${target}`,
      ).toBe(true);
    }
  });
});
