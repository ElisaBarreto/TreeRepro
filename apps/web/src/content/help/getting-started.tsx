import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * What TreeRepro is and the first things to do in it (RFC-73 R1, R2).
 * @rfc RFC-73 R1, R2
 */
export const gettingStarted: HelpTopicSource = {
  slug: 'getting-started',
  title: 'Getting started',
  summary: 'What TreeRepro is, and what to do in your first ten minutes.',
  anchors: ['what', 'first-steps', 'contact'],
  body: (
    <>
      <h2 id="what">What TreeRepro is</h2>
      <p>
        TreeRepro is a collective assembly of reproductive trait data for trees: traits of flowers,
        fruits and seeds. Its core data comes from open-source papers and data repositories, and it
        is shared with a community of specialist scientists who fill the gaps and check what is
        already there.
      </p>
      <p>
        Every value in the dataset is a <strong>record</strong>: one species, one trait, one value,
        and the reference it comes from. Records are never edited and never overwritten. You add to
        them, you agree with them, or you disagree with them, and each of those leaves your name on
        what you did. A manager then decides which record is the <strong>accepted value</strong> for
        that species and trait.
      </p>

      <h2 id="first-steps">Your first ten minutes</h2>
      <ol>
        <li>
          Read <Link to={helpHref('workflow')}>Workflow</Link>. It is short, and it is what every
          other screen assumes you know.
        </li>
        <li>
          Open <strong>Species</strong> in the sidebar. If plots have been assigned to you, the list
          starts with the species of your plots; see <Link to={helpHref('scope')}>Scope</Link> for
          how to widen it.
        </li>
        <li>
          Open a species, find a trait you know well, and open one of its records. If the value is
          right, press <strong>✓ Validate</strong>. That is a real contribution: it tells the
          managers the value has been checked by someone who knows the species.
        </li>
        <li>
          Find a trait with no record yet and press <strong>Add the first entry</strong>. Give the
          value and the DOI of the paper it comes from, or leave the DOI blank if it is your own
          field observation.
        </li>
        <li>
          Open <strong>My contributions</strong> to see everything you have recorded and annotated
          in one place.
        </li>
      </ol>

      <h2 id="contact">Where to ask</h2>
      <p>
        If a species, a trait or a level you need is missing, or something here does not match what
        you see on screen, write to the project. <Link to={helpHref('contact')}>Contact</Link> has
        the address and what to put in the message.
      </p>
    </>
  ),
};
