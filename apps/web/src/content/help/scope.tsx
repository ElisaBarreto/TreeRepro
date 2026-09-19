import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * Which species and traits a viewer sees: plots, the species-list toggle and
 * retired rows (RFC-67 R1, R3, R6, R8, RFC-33 R1, R2, R6).
 * @rfc RFC-73 R1, R2
 */
export const scope: HelpTopicSource = {
  slug: 'scope',
  title: 'Scope',
  summary: 'Plots, the species list beyond them, and rows that are retired rather than deleted.',
  anchors: ['plots', 'outside', 'inactive', 'missing-species'],
  body: (
    <>
      <h2 id="plots">Plots</h2>
      <p>
        A <strong>plot</strong> is a field site: a code, a name, and often coordinates, a country
        and a biome. Species belong to plots, and contributors are assigned to the plots they work
        on. That is how the project knows who to ask about which species.
      </p>
      <p>
        Your own plots are on the workspace home page, under <strong>Your scope</strong>, each with
        the number of species it holds. If that card is not there, no plot has been assigned to you
        yet, and you simply see the whole dataset instead.
      </p>
      <p>
        Plot assignments are managed centrally; there is no self-service. If you are working on a
        site that is not listed against your name, ask the admin to assign it.
      </p>

      <h2 id="outside">Showing species outside your plots</h2>
      <p>
        When you have plots, the <strong>Species</strong> page starts with their species only — the
        ones you are most likely to know. Managers and admins are the exception: they start with the
        whole dataset even when plots are assigned to them. The filters carry a{' '}
        <strong>Show species outside my plots</strong> checkbox: tick it to search the whole
        dataset, untick it to come back to your own sites. The choice is kept in the address bar, so
        a link you copy carries the same list the other person will see.
      </p>
      <p>
        Some contributors are <em>restricted</em> to their assigned plots by the admin. Then the
        checkbox is not offered, and species outside those plots are not listed, not searchable and
        not reachable by a direct link. Counts shown on a trait or a reference still cover the whole
        dataset, so they may be larger than what you can list — that is expected, not a bug.
      </p>

      <h2 id="inactive">Inactive species and traits</h2>
      <p>
        Nothing scientific is deleted here. A species, a trait or a level that should no longer be
        used is marked <strong>inactive</strong>: it stops being offered for new records, and
        records already pointing at it keep their value and stay readable.
      </p>
      <p>
        Most contributors never see inactive rows — they are simply filtered out. Managers and
        admins see them marked <em>inactive</em>, and the species list has an Active/Inactive filter
        for them.
      </p>

      <h2 id="missing-species">Why a species you know is missing</h2>
      <p>It is usually one of three things:</p>
      <ul>
        <li>
          It is outside your plots. Tick <strong>Show species outside my plots</strong> and search
          again.
        </li>
        <li>
          It is there under another name. A species is filed under its accepted name, but the search
          also matches synonyms and common names and tells you which name it matched, so search for
          the name you know — and if that fails, for the genus alone.
        </li>
        <li>It is genuinely not in the dataset yet.</li>
      </ul>
      <p>
        In the last case, you can ask for it. Search the <Link to="/app/species">Species</Link> page
        for the name: when nothing matches it, the empty state offers{' '}
        <strong>Propose this species</strong>, which sends the name and an optional note — where you
        saw it, the authority — to the reviewers. They check it against GBIF and the World Checklist
        of Vascular Plants before deciding, and the answer shows on the <strong>Proposals</strong>{' '}
        tab of <Link to="/app/contributions">My contributions</Link>: approved, with a link to the
        new species, or rejected with a note saying why.
      </p>
      <p>
        If that button is not offered to you, proposing is not part of your role. Write to the admin
        instead, with the species name, the authority, and a plot if it belongs to one.{' '}
        <Link to={helpHref('contact')}>Contact</Link> has the address.
      </p>
    </>
  ),
};
