import { Link } from '@tanstack/react-router';
import { helpHref } from './href.ts';
import type { HelpTopicSource } from './types.ts';

/**
 * The words the trait dictionary uses: categories, traits, levels, units and
 * the descriptions behind the `?` tips (RFC-62 R1–R5).
 * @rfc RFC-73 R1, R2
 */
export const vocabulary: HelpTopicSource = {
  slug: 'vocabulary',
  title: 'Vocabulary',
  summary: 'Traits, categories, levels and units — and why a value is chosen, not typed.',
  anchors: ['traits', 'levels', 'units', 'descriptions'],
  body: (
    <>
      <h2 id="traits">Traits and categories</h2>
      <p>
        A <strong>trait</strong> is one property of a species that can be recorded: seed mass,
        dispersal mode, flowering season. Every trait belongs to a broad <strong>category</strong> —
        the grouping the Traits page and the entry form use to keep the list navigable.
      </p>
      <p>Each trait has one of two value types, fixed when it is created:</p>
      <ul>
        <li>
          <strong>Categorical</strong> — the value is one of a fixed list of levels.
        </li>
        <li>
          <strong>Quantitative</strong> — the value is a number, in the trait&rsquo;s own unit.
        </li>
      </ul>
      <p>
        The whole list lives on the <strong>Traits</strong> page, category by category, with the
        number of species that have data for each trait. Open a trait to see the rest: how its
        records are distributed, and the species that are still missing it.
      </p>

      <h2 id="levels">Levels</h2>
      <p>
        The allowed values of a categorical trait are its <strong>levels</strong>. You choose one
        from a list; there is no free-text box, and that is deliberate. Two people writing
        “animal-dispersed” and “zoochory” mean the same thing, but nothing can count them together,
        compare them across references or export them as one value. A level is a shared identifier,
        so a record from a 1974 monograph and one you enter today line up.
      </p>
      <p>
        A level is never renamed away from under a record and never deleted; a level that falls out
        of use is retired instead, and records already pointing at it keep their value.
      </p>
      <p>
        <strong>If the level you need is not in the list</strong>, do not force the nearest one and
        do not put the real value in a note. Write to the admin with the trait, the level you need
        and a reference that uses it; the dictionary is maintained centrally, so a level can only be
        added there. <Link to={helpHref('contact')}>Contact</Link> has the address.
      </p>

      <h2 id="units">Units and numbers</h2>
      <p>
        A quantitative trait has one standard unit, shown in brackets after its name — for example{' '}
        <em>Seed mass (mg)</em>. Every record of that trait is stored in that unit, so a value you
        read in grams has to be converted before you enter it. The unit is never part of what you
        type: put <em>1200</em> in the box, not <em>1200 mg</em>.
      </p>
      <p>
        Write a decimal point, not a comma, and no thousands separators. The form takes one number
        and nothing else — there is no free-text box beside it — so a range has nowhere to go: enter
        the single figure your source gives for the species, the one you would defend. If the source
        gives a range and no representative value, it is better to leave the trait empty than to
        invent a midpoint. A second figure from a second paper is a separate record: add it as a{' '}
        <Link to={helpHref('workflow', 'complement')}>complement</Link>.
      </p>
      <p>
        A unit is fixed once the trait exists, because changing it would silently change the meaning
        of every number already stored. If a trait&rsquo;s unit looks wrong, write to the admin
        rather than converting your value to fit it.
      </p>

      <h2 id="descriptions">Descriptions</h2>
      <p>
        The small <strong>?</strong> next to a trait&rsquo;s name shows that trait&rsquo;s
        description from the dictionary: what exactly is being measured, and how. It is the same
        text wherever the trait appears — on a species page, on a trait card, in the entry form —
        because it comes from the dictionary, not from the screen you are on.
      </p>
      <p>
        Read it before entering a value, especially for traits whose name is used differently
        between literatures. If a description is missing, ambiguous or wrong, that is worth
        reporting: it affects every record of that trait.
      </p>
    </>
  ),
};
