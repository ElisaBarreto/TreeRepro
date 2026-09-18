import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * What each button on a record does and what it records (RFC-70 R1–R5,
 * RFC-65 R4, RFC-63 R6).
 * @rfc RFC-73 R1, R2
 */
export const workflow: HelpTopicSource = {
  slug: 'workflow',
  title: 'Workflow',
  summary:
    'Validate, add a different record, contest, complement, withdraw — and what happens next.',
  anchors: ['validate', 'different', 'contest', 'complement', 'withdraw', 'review'],
  body: (
    <>
      <p>
        A record is never edited and never deleted. Everything below adds something next to it: an
        annotation that says what you think of it, or a new record of your own. That is what makes
        the dataset auditable — a value can always be traced to the person and the reference it came
        from.
      </p>

      <h2 id="validate">Validate</h2>
      <p>
        <strong>✓ Validate</strong> says: I agree with this value as it stands. Nothing about the
        record changes — not the value, not its reference, not who created it. What is written is a
        confirmation carrying your name and the moment you gave it, attached to the record.
      </p>
      <p>
        You may attach a supporting DOI under <strong>Add a supporting DOI (optional)</strong>: the
        paper that makes you confident. It is checked against the DOI registry like any other
        reference, so wait for the check before pressing the button. Leaving it blank is perfectly
        normal.
      </p>
      <p>
        You can validate a record once. Afterwards the button is out of reach and the record says
        “You validated this record”. Someone else validating the same record is a separate
        confirmation; yours is not replaced.
      </p>

      <h2 id="different">Add a different record</h2>
      <p>
        <strong>+ Add different record</strong> is what you press when the value should be something
        else, or when you have a second value from another source. It does not change the record you
        are looking at: a different value is always a new record of its own, with its own reference
        and your name on it.
      </p>
      <p>The form asks three things, in this order:</p>
      <ul>
        <li>
          What your value means about the existing one — <strong>contest</strong> or{' '}
          <strong>complement</strong>. The rest of the form stays disabled until you answer, because
          the same value means two different things.
        </li>
        <li>The value itself: a level for a categorical trait, a number for a quantitative one.</li>
        <li>
          Its sources: one DOI per row, up to ten, or every row blank for your own observation. See{' '}
          <Link to={helpHref('references')}>References</Link>.
        </li>
      </ul>
      <p>
        One record is created per reference you give. If a claim identical to one of them already
        exists, it is not created twice: the form names the existing record instead and links to it.
      </p>

      <h2 id="contest">Contest</h2>
      <p>
        <strong>Contest</strong> means: the existing value is wrong; mine should replace it. Your
        value must differ from the one you are contesting — a contest that repeats the same value is
        refused.
      </p>
      <p>
        Creating it raises a <strong>dispute</strong> on the record you answered, automatically and
        in the same step. The dispute is marked as automatic, names your contesting record, and puts
        the contested record in the managers&rsquo; Disputed queue. You do not have to write
        anything else; the value and the reference you gave are the argument.
      </p>
      <p>
        To take a contest back, withdraw your contesting record. Once you have no other standing
        contest of that record, the dispute you raised is lifted automatically, with a neutral
        annotation saying the contest was withdrawn. Contesting the same record from several
        references raises one dispute, and it stands until the last of those records is withdrawn.
      </p>

      <h2 id="complement">Complement</h2>
      <p>
        <strong>Complement</strong> means: the existing value is also correct; I am adding another
        observation. A species can flower in two seasons and disperse in two modes; both records are
        true and both belong in the dataset.
      </p>
      <p>
        A complement raises no dispute and changes nothing about the record it answers. It may even
        carry the same value, as long as it comes from another reference — that is a second,
        independent source for the same claim. Withdrawing a complement has no side effect.
      </p>

      <h2 id="withdraw">Withdraw</h2>
      <p>
        <strong>Withdraw</strong> takes one of your own records out of consideration: you entered
        the wrong species, misread a table, or changed your mind. It asks for a note saying why, and
        that note stays on the record.
      </p>
      <ul>
        <li>Only records entered by hand can be withdrawn; imported rows cannot.</li>
        <li>
          Only their author can withdraw them, or someone holding the withdrawal permission for the
          whole dataset.
        </li>
        <li>
          A record that is currently the accepted value cannot be withdrawn. Ask a manager to change
          the accepted value first.
        </li>
      </ul>
      <p>
        A withdrawn record stays visible, marked withdrawn and struck through, and takes no further
        actions. Nothing is erased — see <Link to={helpHref('contributions')}>Contributions</Link>.
      </p>

      <h2 id="review">What managers and the admin do next</h2>
      <p>
        For every species and trait, a manager may mark one record as the{' '}
        <strong>accepted value</strong>: the single value the project stands behind, and the one the
        export carries. Only a record with a value the dictionary understands can be accepted, and
        the decision can be changed or cleared later. The species page shows the accepted value next
        to the trait.
      </p>
      <p>
        Records under a standing dispute — yours included — go to the managers&rsquo;{' '}
        <strong>Disputed</strong> queue, which lists the disputed record together with the records
        contesting it, so the two values can be compared side by side. A separate{' '}
        <strong>Pending</strong> queue is where imported values that do not match any level of the
        dictionary are mapped by hand.
      </p>
      <p>
        None of this is instant. A validation or a contest may sit unreviewed for a while; it is
        recorded from the moment you press the button, and it is visible on{' '}
        <strong>My contributions</strong> straight away.
      </p>
    </>
  ),
};
