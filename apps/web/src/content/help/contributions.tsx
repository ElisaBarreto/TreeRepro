import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The My contributions page and the statuses a record carries (RFC-71 R1–R4,
 * RFC-63 R6, RFC-65 R4).
 * @rfc RFC-73 R1, R2
 */
export const contributions: HelpTopicSource = {
  slug: 'contributions',
  title: 'Contributions',
  summary: 'Your own records and annotations in one place, and what their statuses mean.',
  anchors: ['page', 'statuses', 'withdraw'],
  body: (
    <>
      <h2 id="page">The My contributions page</h2>
      <p>
        <strong>My contributions</strong> in the sidebar gathers everything you have done, instead
        of making you remember which species pages you came from. It has two tabs:
      </p>
      <ul>
        <li>
          <strong>Records</strong> — the records you entered, newest first, with their value, their
          reference, their status, whether the record is the current accepted value, and how many
          records answer it.
        </li>
        <li>
          <strong>Annotations</strong> — your validations, disputes and withdrawals, each shown with
          the record it is about. Annotations the system raised on your behalf — the dispute a
          contest creates, and the neutral that lifts it again — are marked <em>automatic</em>.
        </li>
      </ul>
      <p>
        Both tabs filter by trait, species, status, intent and date range, and the filters are in
        the address bar, so a view is a link. Above them, a row of counts summarises your standing:
        records entered, contests, complements, validations given, disputes raised, records
        withdrawn and records that are the current accepted value.
      </p>
      <p>
        Those counts are about everything you have done, including work on species you can no longer
        list — if your plot assignment changed, a record of yours may be counted but not shown. The
        numbers stay true rather than shrinking.
      </p>

      <h2 id="statuses">Statuses</h2>
      <p>Every record carries one review status, worked out from its annotations:</p>
      <ul>
        <li>
          <strong>unreviewed</strong> — nobody has annotated it yet. A new record starts here.
        </li>
        <li>
          <strong>confirmed</strong> — the latest annotation is a validation. Someone read the value
          and agreed with it.
        </li>
        <li>
          <strong>disputed</strong> — someone&rsquo;s standing position on it is a dispute, whether
          written by a manager or raised automatically by a contest. It is in the Disputed queue
          until that is resolved.
        </li>
        <li>
          <strong>withdrawn</strong> — a withdrawal exists. This wins over everything else: a
          withdrawn record is out, whatever was said about it before.
        </li>
      </ul>
      <p>
        <strong>accepted</strong> is not one of these. It is a separate mark, made by a manager, for
        the one record that is the project&rsquo;s current value for a species and trait — so a
        record can be confirmed and accepted, or accepted and later disputed. See{' '}
        <Link to={helpHref('workflow')}>Workflow</Link>.
      </p>

      <h2 id="withdraw">Withdrawing</h2>
      <p>
        Withdraw a record from its own drawer: open it from this page or from the species page, and
        press <strong>Withdraw</strong>. It asks for a note saying why, which stays attached to the
        record.
      </p>
      <p>
        You can withdraw records you entered by hand. Imported rows cannot be withdrawn, and neither
        can a record that is currently the accepted value — ask a manager to change the accepted
        value first.
      </p>
      <p>
        Withdrawing a record that <em>contested</em> another one also lifts the dispute it raised,
        provided you have no other standing contest of that record. Withdrawing a complement has no
        side effect.
      </p>
      <p>
        Nothing disappears. A withdrawn record stays in your list, struck through, with its note —
        the point is that the dataset shows what was claimed and that it was taken back, not that it
        never happened.
      </p>
    </>
  ),
};
