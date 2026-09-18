import type { HelpTopicSource } from './types.ts';

/**
 * Where a claim comes from: DOIs and the live registry check, personal
 * observations, several references at once, and the references page
 * (RFC-80 R1, R3–R5, RFC-61 R4, R7, R8, RFC-70 R3).
 * @rfc RFC-73 R1, R2
 */
export const references: HelpTopicSource = {
  slug: 'references',
  title: 'References',
  summary: 'DOIs, your own observations, and how several sources become several records.',
  anchors: ['doi', 'personal-observation', 'several', 'bibliography'],
  body: (
    <>
      <p>
        Every record names where its value comes from. There are exactly two answers: a published
        work, identified by its DOI, or your own observation. There is no third option and no “see
        note” — an unsourced value cannot be checked by anyone else.
      </p>

      <h2 id="doi">DOIs</h2>
      <p>
        A DOI looks like <code>10.1234/abcd.5678</code>: the registrant prefix, a slash, and the
        publisher&rsquo;s own suffix. You can paste it in any form you have it — bare, as{' '}
        <code>doi:10.1234/abcd.5678</code>, or as the full <code>https://doi.org/…</code> link from
        your browser. It is normalised and stored in one canonical form, so the same paper is one
        reference however it was typed.
      </p>
      <p>
        When you leave the DOI box, TreeRepro checks it against the DOI registry. The line under the
        field says what came back, in these words:
      </p>
      <ul>
        <li>
          <strong>Checking…</strong> — the request is out. Wait for it; the form will not submit a
          DOI nobody has answered for.
        </li>
        <li>
          <strong>Resolved: …</strong> — the DOI is real, and the rest of the line is the work it
          names. This is the answer you want. It reads the same whether the work is already in the
          project&rsquo;s reference list or brand new here; a new one is added automatically, with
          its title, authors, year and journal, when your record is saved.
        </li>
        <li>
          <strong>DOI not found</strong> — the registry does not know it. Check it against the paper
          itself.
        </li>
        <li>
          <strong>Malformed DOI</strong> — it is not shaped like a DOI at all. The usual causes are
          a missing digit, a stray space, or a page URL copied instead of the DOI.
        </li>
        <li>
          <strong>Could not check the DOI — try again</strong> — the registry could not be reached.
          This says nothing about your DOI. Click into the field and out of it again and the check
          runs once more.
        </li>
      </ul>
      <p>
        The last three block the form: the API would refuse the record anyway. Only{' '}
        <strong>Resolved</strong> lets it through.
      </p>

      <h2 id="personal-observation">Personal observation</h2>
      <p>
        Leave the DOI blank when the value comes from your own field work or your expert knowledge
        rather than from a publication. That is a legitimate source here, and the whole reason the
        dataset is shared with specialists.
      </p>
      <p>
        It is recorded as <strong>your</strong> personal observation, a reference of its own that
        belongs to you. It is not a blank field: it says whose observation it is. For the same
        reason, nobody else can cite your personal observation as their source — if they observed
        the same thing, they record their own.
      </p>
      <p>
        If the value comes from a paper you did not read and cannot cite, it is neither: find the
        DOI, or leave the trait to someone who can.
      </p>

      <h2 id="several">Several references</h2>
      <p>
        One claim may rest on several papers. Add a row per DOI, up to ten. What is created is{' '}
        <strong>one record per reference</strong>, all carrying the same value — so a trait
        supported by three papers reads as three records, and the reference list shows each of them
        being used.
      </p>
      <p>
        If one of those claims already exists — the same species, trait, value and reference — it is
        not duplicated. The form tells you which ones already existed and links to them; the rest
        are created as usual.
      </p>
      <p>
        Do not mix a DOI and a personal observation in one submission. Either the value is from the
        literature, in which case give the DOIs, or it is yours, in which case leave every row
        blank.
      </p>

      <h2 id="bibliography">Where references come from</h2>
      <p>
        The <strong>References</strong> page in the sidebar lists the <em>publications</em> the
        records cite — most used first, with how many records name each one as a primary and as a
        secondary source. Each has its own page: its metadata, its DOI link, and the traits it has
        been used for.
      </p>
      <p>
        Personal observations are not in that list: it is the project&rsquo;s bibliography, and an
        observation is not a publication. They appear against the records that rest on them — on the
        species page and on <strong>My contributions</strong>, a record sourced that way reads
        &ldquo;Personal observation&rdquo; with the observer&rsquo;s name where a citation would be.
      </p>
      <p>
        You never have to add a publication there yourself. Giving a DOI on a record is what creates
        it, with the metadata fetched from the registry.
      </p>
    </>
  ),
};
