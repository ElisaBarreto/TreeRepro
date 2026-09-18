import type { Dashboard } from '@treerepro/contracts';
import { CONTACT_EMAIL, projectDescription } from '../../content/project.ts';
import { StatTiles } from './StatTiles.tsx';

const LINK_CLASS = 'font-medium text-canopy-900 underline-offset-2 hover:underline';

// The paragraph is one fixed string (RFC-72 R3); the only markup in it is
// the contact e-mail as a link, so it is found in the text and wrapped
// rather than templated a second time here.
function Description({ text }: { text: string }) {
  const [before, after] = text.split(CONTACT_EMAIL);
  return (
    <p className="max-w-3xl text-body text-mist-500">
      {before}
      <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
        {CONTACT_EMAIL}
      </a>
      {after}
    </p>
  );
}

/**
 * The dashboard's opening card: what TreeRepro is, with the dataset's live
 * counts substituted into the fixed copy (RFC-72 R3), and those same three
 * counts again as small tiles.
 * @rfc RFC-72 R3
 */
export function IntroCard({ dataset }: { dataset: Dashboard['dataset'] }) {
  return (
    <section
      aria-label="About TreeRepro"
      className="flex flex-col gap-4 rounded-xl border border-canopy-700/15 bg-white p-6"
    >
      <Description text={projectDescription(dataset)} />
      <StatTiles
        label="Dataset"
        tiles={[
          { label: 'Species', value: dataset.speciesCount },
          { label: 'References', value: dataset.referenceCount },
          { label: 'Records', value: dataset.recordCount },
        ]}
      />
    </section>
  );
}
