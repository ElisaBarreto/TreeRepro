import { CONTACT_EMAIL } from '../project.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * Where to write and what to put in the message; the address is the
 * project's own, from `content/project.ts` (RFC-72 R3).
 * @rfc RFC-72 R3
 * @rfc RFC-73 R1, R2
 */
export const contact: HelpTopicSource = {
  slug: 'contact',
  title: 'Contact',
  summary: 'Where to write when the app cannot answer, and what to put in the message.',
  anchors: ['what-to-send'],
  body: (
    <>
      <p>
        Write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. It is the project&rsquo;s
        own address; a person reads it, so plain English is fine and there is no form to fill in.
      </p>
      <p>Things only the admin can do, and which are therefore worth writing about:</p>
      <ul>
        <li>adding a species, a trait or a level that is missing;</li>
        <li>correcting a trait&rsquo;s description or unit;</li>
        <li>assigning you to a field plot, or changing the plots you are assigned to;</li>
        <li>exporting data for an analysis;</li>
        <li>anything that looks like a bug: a page that fails, a number that cannot be right.</li>
      </ul>

      <h2 id="what-to-send">What to include</h2>
      <p>A short message that answers these saves a round trip:</p>
      <ul>
        <li>
          <strong>Where you were.</strong> The address of the page from your browser — it names the
          species, the trait or the record, so nothing has to be guessed.
        </li>
        <li>
          <strong>What you expected, and what happened instead.</strong> One sentence each.
        </li>
        <li>
          <strong>The names in full.</strong> The species with its authority, the trait as the
          dictionary spells it, the level you were looking for.
        </li>
        <li>
          <strong>The reference,</strong> as a DOI, if the message is about a source or a value
          taken from one.
        </li>
        <li>
          <strong>When it happened,</strong> if it is about something that failed. A date and a
          rough time are enough to find it in the logs.
        </li>
      </ul>
      <p>
        Please do not send passwords or one-time codes. Nobody on the project will ever ask you for
        them.
      </p>
    </>
  ),
};
