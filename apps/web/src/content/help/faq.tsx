import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The questions contributors ask first (RFC-63 R6, RFC-66 R1, R2, RFC-70
 * R3, RFC-40).
 * @rfc RFC-73 R1, R2
 */
export const faq: HelpTopicSource = {
  slug: 'faq',
  title: 'FAQ',
  summary: 'Editing, names, downloads and disagreements — the four questions that come up first.',
  anchors: ['edit', 'names', 'download', 'disagree'],
  body: (
    <>
      <h2 id="edit">Can I edit a record?</h2>
      <p>
        No, and nobody can. Records are only ever added, never changed. It is what makes a value
        traceable: the record you read today says exactly what its reference said, with the name of
        whoever entered it.
      </p>
      <p>
        If a value is wrong, add a different record contesting it — that is the button for it. If
        the mistake is in a record of your own, withdraw it and enter a new one; the withdrawal asks
        you to say why, which is far more useful to the next reader than a silent correction. Both
        are in <Link to={helpHref('workflow')}>Workflow</Link>.
      </p>

      <h2 id="names">Who sees my name?</h2>
      <p>
        Signed-in scientists with access to the dataset. Your name is shown next to the records you
        enter and the annotations you leave, on the species pages, in the curation queues and on
        your contributions page. Managers can also open your contributions page by name.
      </p>
      <p>
        That is deliberate: a contribution is attributed work, and a contest with nobody&rsquo;s
        name on it would be worth much less. What is <em>not</em> shown is your e-mail address
        beside your records, and the CSV export carries no column naming a person at all.
      </p>
      <p>Nothing here is public. Everything is behind sign-in.</p>

      <h2 id="download">Can I download the data?</h2>
      <p>
        There is an export of the accepted values as CSV — one row per species and trait, with the
        value, the unit, the references and the date it was accepted. It is offered on the Species
        page to accounts that hold the export permission, which most contributor accounts do not.
      </p>
      <p>
        If you need the data for an analysis, ask. Say what you need it for and which traits or
        species you need; the admin exports it. <Link to={helpHref('contact')}>Contact</Link> has
        the address.
      </p>

      <h2 id="disagree">What if two people disagree?</h2>
      <p>
        That is an ordinary and useful state, not a problem to avoid. The second person adds their
        own record and marks it a <strong>contest</strong>; the first record is automatically
        disputed and goes to the managers&rsquo; Disputed queue. That queue lists the disputed
        record — its value, who disputed it, and an automatic note naming the record that contests
        it. Opening the record shows the contesting records under <strong>Responses</strong>, and
        opening one of those shows its value and its reference.
      </p>
      <p>
        The admin then decides which record is the accepted value for that species and trait. Both
        records stay in the dataset with their references — the disagreement is recorded, not
        resolved by deletion. If you decide the other value was right after all, withdraw your
        contest and the dispute lifts itself.
      </p>
      <p>
        If both values are true — a species that flowers twice a year, a trait that varies between
        sites — the answer is a <strong>complement</strong>, not a contest. No dispute is raised.
      </p>
    </>
  ),
};
