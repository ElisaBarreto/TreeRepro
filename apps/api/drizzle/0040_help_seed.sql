-- RFC-73 R2: seeds the help topics from the former TSX modules
-- (apps/web/src/content/help/*.tsx). Afterwards the database is the only
-- source and the admin edits the pages on the site (RFC-73 R7).
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('getting-started', $h$Getting started$h$, $h$What TreeRepro is, and what to do in your first ten minutes.$h$, 0);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('what', $h$What TreeRepro is$h$, $h$<p>TreeRepro is a collective assembly of reproductive trait data for trees: traits of flowers, fruits and seeds. Its core data comes from open-source papers and data repositories, and it is shared with a community of specialist scientists who fill the gaps and check what is already there.</p>
<p>Every value in the dataset is a <strong>record</strong>: one species, one trait, one value, and the reference it comes from. Records are never edited and never overwritten. You add to them, you agree with them, or you disagree with them, and each of those leaves your name on what you did. The admin then decides which record is the <strong>accepted value</strong> for that species and trait.</p>$h$, 0),
  ('first-steps', $h$Your first ten minutes$h$, $h$<ol><li>Read <a href="/app/help/workflow">Workflow</a>. It is short, and it is what every other screen assumes you know.</li>
<li>Open <strong>Species</strong> in the sidebar. If plots have been assigned to you, the list starts with the species of your plots; see <a href="/app/help/scope">Scope</a> for how to widen it.</li>
<li>Open a species, find a trait you know well, and open one of its records. If the value is right, press <strong>✓ Validate</strong>. That is a real contribution: it tells the managers the value has been checked by someone who knows the species.</li>
<li>Find a trait with no record yet and press <strong>Add the first entry</strong>. Give the value and the DOI of the paper it comes from, or leave the DOI blank if it is your own field observation.</li>
<li>Open <strong>My contributions</strong> to see everything you have recorded and annotated in one place.</li>
</ol>$h$, 1),
  ('contact', $h$Where to ask$h$, $h$<p>If a species, a trait or a level you need is missing, or something here does not match what you see on screen, write to the project. <a href="/app/help/contact">Contact</a> has the address and what to put in the message.</p>$h$, 2)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'getting-started';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('workflow', $h$Workflow$h$, $h$Validate, add a different record, contest, complement, withdraw — and what happens next.$h$, 1);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>A record is never edited and never deleted. Everything below adds something next to it: an annotation that says what you think of it, or a new record of your own. That is what makes the dataset auditable — a value can always be traced to the person and the reference it came from.</p>$h$, 0),
  ('validate', $h$Validate$h$, $h$<p><strong>✓ Validate</strong> says: I agree with this value as it stands. Nothing about the record changes — not the value, not its reference, not who created it. What is written is a confirmation carrying your name and the moment you gave it, attached to the record.</p>
<p>You may attach a supporting DOI under <strong>Add a supporting DOI (optional)</strong>: the paper that makes you confident. It is checked against the DOI registry like any other reference, so wait for the check before pressing the button. Leaving it blank is perfectly normal.</p>
<p>You can validate a record once. Afterwards the button is out of reach and the record says “You validated this record”. Someone else validating the same record is a separate confirmation; yours is not replaced.</p>$h$, 1),
  ('different', $h$Add a different record$h$, $h$<p><strong>+ Add different record</strong> is what you press when the value should be something else, or when you have a second value from another source. It does not change the record you are looking at: a different value is always a new record of its own, with its own reference and your name on it.</p>
<p>The form asks three things, in this order:</p>
<ul><li>What your value means about the existing one — <strong>contest</strong> or <strong>complement</strong>. The rest of the form stays disabled until you answer, because the same value means two different things.</li>
<li>The value itself: a level for a categorical trait, a number for a quantitative one.</li>
<li>Its sources: one DOI per row, up to ten, or every row blank for your own observation. See <a href="/app/help/references">References</a>.</li>
</ul>
<p>One record is created per reference you give. If a claim identical to one of them already exists, it is not created twice: the form names the existing record instead and links to it.</p>$h$, 2),
  ('contest', $h$Contest$h$, $h$<p><strong>Contest</strong> means: the existing value is wrong; mine should replace it. Your value must differ from the one you are contesting — a contest that repeats the same value is refused.</p>
<p>Creating it raises a <strong>dispute</strong> on the record you answered, automatically and in the same step. The dispute is marked as automatic, names your contesting record, and puts the contested record in the managers’ Disputed queue. You do not have to write anything else; the value and the reference you gave are the argument.</p>
<p>To take a contest back, withdraw your contesting record. Once you have no other standing contest of that record, the dispute you raised is lifted automatically, with a neutral annotation saying the contest was withdrawn. Contesting the same record from several references raises one dispute, and it stands until the last of those records is withdrawn.</p>$h$, 3),
  ('complement', $h$Complement$h$, $h$<p><strong>Complement</strong> means: the existing value is also correct; I am adding another observation. A species can flower in two seasons and disperse in two modes; both records are true and both belong in the dataset.</p>
<p>A complement raises no dispute and changes nothing about the record it answers. It may even carry the same value, as long as it comes from another reference — that is a second, independent source for the same claim. Withdrawing a complement has no side effect.</p>$h$, 4),
  ('withdraw', $h$Withdraw$h$, $h$<p><strong>Withdraw</strong> takes one of your own records out of consideration: you entered the wrong species, misread a table, or changed your mind. It asks for a note saying why, and that note stays on the record.</p>
<ul><li>Only records entered by hand can be withdrawn; imported rows cannot.</li>
<li>Only their author can withdraw them, or someone holding the withdrawal permission for the whole dataset.</li>
<li>A record that is currently the accepted value cannot be withdrawn. Ask the admin to change the accepted value first.</li>
</ul>
<p>A withdrawn record stays visible, marked withdrawn and struck through, and takes no further actions. Nothing is erased — see <a href="/app/help/contributions">Contributions</a>.</p>$h$, 5),
  ('review', $h$What managers and the admin do next$h$, $h$<p>For every species and trait, the admin may mark one record as the <strong>accepted value</strong>: the single value the project stands behind, and the one the export carries. Managers run the queues below, but the manager role does not carry the permission to set or clear an accepted value. Only a record with a value the dictionary understands can be accepted, and the decision can be changed or cleared later. The species page shows the accepted value next to the trait.</p>
<p>Records under a standing dispute — yours included — go to the managers’ <strong>Disputed</strong> queue. A row there is the disputed record: its species, its trait, its own value, who disputed it, their note and the date. When a contest raised the dispute, that note is written for you and names the contesting record by its id. The competing value is not in the row: open the record from its value, then open any record in the drawer’s <strong>Responses</strong> list. A record leaves that queue once the admin settles the accepted value for its species and trait: it may still read <em>disputed</em> on the species page while no longer waiting in the queue.</p>
<p>A separate <strong>Pending</strong> queue is where imported values the dictionary cannot read are mapped by hand — a categorical value matching no level, one cell holding several values at once, or a quantitative cell that is not a number.</p>
<p>None of this is instant. A validation or a contest may sit unreviewed for a while; it is recorded from the moment you press the button, and it is visible on <strong>My contributions</strong> straight away.</p>$h$, 6)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'workflow';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('vocabulary', $h$Vocabulary$h$, $h$Traits, categories, levels and units — and why a value is chosen, not typed.$h$, 2);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('traits', $h$Traits and categories$h$, $h$<p>A <strong>trait</strong> is one property of a species that can be recorded: seed mass, dispersal mode, flowering season. Every trait belongs to a broad <strong>category</strong> — the grouping the Traits page and the entry form use to keep the list navigable.</p>
<p>Each trait has one of two value types, fixed when it is created:</p>
<ul><li><strong>Categorical</strong> — the value is one of a fixed list of levels.</li>
<li><strong>Quantitative</strong> — the value is a number, in the trait’s own unit.</li>
</ul>
<p>The whole list lives on the <strong>Traits</strong> page, category by category, with the number of species that have data for each trait. Open a trait to see the rest: how its records are distributed, and the species that are still missing it.</p>$h$, 0),
  ('levels', $h$Levels$h$, $h$<p>The allowed values of a categorical trait are its <strong>levels</strong>. You choose one from a list; there is no free-text box, and that is deliberate. Two people writing “animal-dispersed” and “zoochory” mean the same thing, but nothing can count them together, compare them across references or export them as one value. A level is a shared identifier, so a record from a 1974 monograph and one you enter today line up.</p>
<p>A level is never renamed away from under a record and never deleted; a level that falls out of use is retired instead, and records already pointing at it keep their value.</p>
<p><strong>If the level you need is not in the list</strong>, do not force the nearest one and do not put the real value in a note. Write to the admin with the trait, the level you need and a reference that uses it; the dictionary is maintained centrally, so a level can only be added there. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 1),
  ('units', $h$Units and numbers$h$, $h$<p>A quantitative trait has one standard unit, shown in brackets after its name — for example <em>Seed mass (mg)</em>. Every record of that trait is stored in that unit, so a value you read in grams has to be converted before you enter it. The unit is never part of what you type: put <em>1200</em> in the box, not <em>1200 mg</em>.</p>
<p>Write a decimal point, not a comma, and no thousands separators. The form takes one number and nothing else — there is no free-text box beside it — so a range has nowhere to go: enter the single figure your source gives for the species, the one you would defend. If the source gives a range and no representative value, it is better to leave the trait empty than to invent a midpoint. A second figure from a second paper is a separate record: add it as a <a href="/app/help/workflow#complement">complement</a>.</p>
<p>A unit is fixed once the trait exists, because changing it would silently change the meaning of every number already stored. If a trait’s unit looks wrong, write to the admin rather than converting your value to fit it.</p>$h$, 2),
  ('descriptions', $h$Descriptions$h$, $h$<p>The small <strong>?</strong> next to a trait’s name shows that trait’s description from the dictionary: what exactly is being measured, and how. It is the same description wherever the trait appears — on a species page, on a trait card, in the entry form — because it comes from the dictionary, not from the screen you are on.</p>
<p>Read it before entering a value, especially for traits whose name is used differently between literatures. If a description is missing, ambiguous or wrong, that is worth reporting: it affects every record of that trait.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'vocabulary';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('references', $h$References$h$, $h$DOIs, your own observations, and how several sources become several records.$h$, 3);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>Every record names where its value comes from. There are exactly two answers: a published work, identified by its DOI, or your own observation. There is no third option and no “see note” — an unsourced value cannot be checked by anyone else.</p>$h$, 0),
  ('doi', $h$DOIs$h$, $h$<p>A DOI looks like <code>10.1234/abcd.5678</code>: the registrant prefix, a slash, and the publisher’s own suffix. You can paste it in any form you have it — bare, as <code>doi:10.1234/abcd.5678</code>, or as the full <code>https://doi.org/…</code> link from your browser. It is normalised and stored in one canonical form, so the same paper is one reference however it was typed.</p>
<p>When you leave the DOI box, TreeRepro checks it against the DOI registry. The line under the field says what came back, in these words:</p>
<ul><li><strong>Checking…</strong> — the request is out. Wait for it; the form will not submit a DOI nobody has answered for.</li>
<li><strong>Resolved: …</strong> — the DOI is real, and the rest of the line is the work it names. This is the answer you want. It reads the same whether the work is already in the project’s reference list or brand new here; a new one is added automatically, with its title, authors, year and journal, when your record is saved.</li>
<li><strong>DOI not found</strong> — the registry does not know it. Check it against the paper itself.</li>
<li><strong>Malformed DOI</strong> — it is not shaped like a DOI at all. The usual causes are a missing digit, a stray space, or a page URL copied instead of the DOI.</li>
<li><strong>Could not check the DOI — try again</strong> — the registry could not be reached. This says nothing about your DOI. Click into the field and out of it again and the check runs once more.</li>
</ul>
<p>The last three block the form: the API would refuse the record anyway. Only <strong>Resolved</strong> lets it through.</p>$h$, 1),
  ('personal-observation', $h$Personal observation$h$, $h$<p>Leave the DOI blank when the value comes from your own field work or your expert knowledge rather than from a publication. That is a legitimate source here, and the whole reason the dataset is shared with specialists.</p>
<p>It is recorded as <strong>your</strong> personal observation, a reference of its own that belongs to you. It is not a blank field: it says whose observation it is. For the same reason, nobody else can cite your personal observation as their source — if they observed the same thing, they record their own.</p>
<p>If the value comes from a paper you did not read and cannot cite, it is neither: find the DOI, or leave the trait to someone who can.</p>$h$, 2),
  ('several', $h$Several references$h$, $h$<p>One claim may rest on several papers. Add a row per DOI, up to ten. What is created is <strong>one record per reference</strong>, all carrying the same value — so a trait supported by three papers reads as three records, and the reference list shows each of them being used.</p>
<p>If one of those claims already exists — the same species, trait, value and reference — it is not duplicated. The form tells you which ones already existed and links to them; the rest are created as usual.</p>
<p>Do not mix a DOI and a personal observation in one submission. Either the value is from the literature, in which case give the DOIs, or it is yours, in which case leave every row blank.</p>$h$, 3),
  ('bibliography', $h$Where references come from$h$, $h$<p>The <strong>References</strong> page in the sidebar lists the <em>publications</em> the records cite — most used first, with how many records name each one as a primary and as a secondary source. Each has its own page: its metadata, its DOI link, and the traits it has been used for.</p>
<p>Personal observations are not in that list: it is the project’s bibliography, and an observation is not a publication. They appear against the records that rest on them — on the species page and on <strong>My contributions</strong>, a record sourced that way reads “Personal observation” with the observer’s name where a citation would be.</p>
<p>You never have to add a publication there yourself. Giving a DOI on a record is what creates it, with the metadata fetched from the registry.</p>$h$, 4)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'references';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('scope', $h$Scope$h$, $h$Plots, the species list beyond them, and rows that are retired rather than deleted.$h$, 4);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('plots', $h$Plots$h$, $h$<p>A <strong>plot</strong> is a field site: a code, a name, and often coordinates, a country and a biome. Species belong to plots, and contributors are assigned to the plots they work on. That is how the project knows who to ask about which species.</p>
<p>Your own plots are on the workspace home page, under <strong>Your scope</strong>, each with the number of species it holds. If that card is not there, no plot has been assigned to you yet, and you simply see the whole dataset instead.</p>
<p>Plot assignments are managed centrally; there is no self-service. If you are working on a site that is not listed against your name, ask the admin to assign it.</p>$h$, 0),
  ('outside', $h$Showing species outside your plots$h$, $h$<p>When you have plots, the <strong>Species</strong> page starts with their species only — the ones you are most likely to know. Managers and admins are the exception: they start with the whole dataset even when plots are assigned to them. The filters carry a <strong>Show species outside my plots</strong> checkbox: tick it to search the whole dataset, untick it to come back to your own sites. The choice is kept in the address bar, so a link you copy carries the same list the other person will see.</p>
<p>Some contributors are <em>restricted</em> to their assigned plots by the admin. Then the checkbox is not offered, and species outside those plots are not listed, not searchable and not reachable by a direct link. Counts shown on a trait or a reference still cover the whole dataset, so they may be larger than what you can list — that is expected, not a bug.</p>$h$, 1),
  ('inactive', $h$Inactive species and traits$h$, $h$<p>Nothing scientific is deleted here. A species, a trait or a level that should no longer be used is marked <strong>inactive</strong>: it stops being offered for new records, and records already pointing at it keep their value and stay readable.</p>
<p>Most contributors never see inactive rows — they are simply filtered out. Managers and admins see them marked <em>inactive</em>, and the species list has an Active/Inactive filter for them.</p>$h$, 2),
  ('missing-species', $h$Why a species you know is missing$h$, $h$<p>It is usually one of three things:</p>
<ul><li>It is outside your plots. Tick <strong>Show species outside my plots</strong> and search again.</li>
<li>It is there under another name. A species is filed under its accepted name, but the search also matches synonyms and common names and tells you which name it matched, so search for the name you know — and if that fails, for the genus alone.</li>
<li>It is genuinely not in the dataset yet.</li>
</ul>
<p>In the last case, you can ask for it. Search the <a href="/app/species">Species</a> page for the name: when nothing matches it, the empty state offers <strong>Propose this species</strong>, which sends the name and an optional note — where you saw it, the authority — to the reviewers. They check it against GBIF and, when configured, the World Checklist of Vascular Plants before deciding, and the answer shows on the <strong>Proposals</strong> tab of <a href="/app/contributions">My contributions</a>: approved, with a link to the new species, or rejected with a note saying why.</p>
<p>If that button is not offered to you, proposing is not part of your role. Write to the admin instead, with the species name, the authority, and a plot if it belongs to one. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'scope';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('contributions', $h$Contributions$h$, $h$Your own records and annotations in one place, and what their statuses mean.$h$, 5);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('page', $h$The My contributions page$h$, $h$<p><strong>My contributions</strong> in the sidebar gathers everything you have done, instead of making you remember which species pages you came from. It has two tabs:</p>
<ul><li><strong>Records</strong> — the records you entered, newest first, with their value, their reference, their status, whether the record is the current accepted value, and how many records answer it.</li>
<li><strong>Annotations</strong> — your validations, disputes and withdrawals, each shown with the record it is about. Annotations the system raised on your behalf — the dispute a contest creates, and the neutral that lifts it again — are marked <em>automatic</em>.</li>
</ul>
<p>Both tabs filter by trait, species, status, intent and date range, and the filters are in the address bar, so a view is a link. Above them, a row of counts summarises your standing: records entered, contests, complements, validations given, disputes raised, records withdrawn and records that are the current accepted value.</p>
<p>Those counts are about everything you have done, including work on species you can no longer list — if your plot assignment changed, a record of yours may be counted but not shown. The numbers stay true rather than shrinking.</p>$h$, 0),
  ('statuses', $h$Statuses$h$, $h$<p>Every record carries one review status, worked out from its annotations:</p>
<ul><li><strong>unreviewed</strong> — nobody’s standing position on it is a validation or a dispute. A new record starts here, and so does a record whose dispute was lifted, carrying its annotations with it — unless somebody’s validation still stands, which makes it confirmed instead.</li>
<li><strong>confirmed</strong> — somebody’s latest word on it is a validation. The axis is read per person, so a neutral from someone else does not take your validation back.</li>
<li><strong>disputed</strong> — somebody’s standing position on it is a dispute, whether written by a manager or raised automatically by a contest. It outranks a validation, and it puts the record in the managers’ Disputed queue until the admin settles the accepted value for that species and trait.</li>
<li><strong>withdrawn</strong> — a withdrawal exists. This wins over everything else: a withdrawn record is out, whatever was said about it before.</li>
</ul>
<p><strong>accepted</strong> is not one of these. It is a separate mark, made by the admin, for the one record that is the project’s current value for a species and trait — so a record can be confirmed and accepted, or accepted and later disputed. See <a href="/app/help/workflow">Workflow</a>.</p>$h$, 1),
  ('withdraw', $h$Withdrawing$h$, $h$<p>Withdraw a record from its own drawer: open it from this page or from the species page, and press <strong>Withdraw</strong>. It asks for a note saying why, which stays attached to the record.</p>
<p>You can withdraw records you entered by hand. Imported rows cannot be withdrawn, and neither can a record that is currently the accepted value — ask the admin to change the accepted value first.</p>
<p>Withdrawing a record that <em>contested</em> another one also lifts the dispute it raised, provided you have no other standing contest of that record. Withdrawing a complement has no side effect.</p>
<p>Nothing disappears. A withdrawn record stays in your list, struck through, with its note — the point is that the dataset shows what was claimed and that it was taken back, not that it never happened.</p>$h$, 2)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'contributions';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('faq', $h$FAQ$h$, $h$Editing, names, downloads and disagreements — the four questions that come up first.$h$, 6);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('edit', $h$Can I edit a record?$h$, $h$<p>No, and nobody can. Records are only ever added, never changed. It is what makes a value traceable: the record you read today says exactly what its reference said, with the name of whoever entered it.</p>
<p>If a value is wrong, add a different record contesting it — that is the button for it. If the mistake is in a record of your own, withdraw it and enter a new one; the withdrawal asks you to say why, which is far more useful to the next reader than a silent correction. Both are in <a href="/app/help/workflow">Workflow</a>.</p>$h$, 0),
  ('names', $h$Who sees my name?$h$, $h$<p>Signed-in scientists with access to the dataset. Your name is shown next to the records you enter and the annotations you leave, on the species pages, in the curation queues and on your contributions page. Managers can also open your contributions page by name.</p>
<p>That is deliberate: a contribution is attributed work, and a contest with nobody’s name on it would be worth much less. What is <em>not</em> shown is your e-mail address beside your records, and the CSV export carries no column naming a person at all.</p>
<p>Nothing here is public. Everything is behind sign-in.</p>$h$, 1),
  ('download', $h$Can I download the data?$h$, $h$<p>There is an export of the accepted values as CSV — one row per species and trait, with the value, the unit, the references and the date it was accepted. It is offered on the Species page to accounts that hold the export permission, which most contributor accounts do not.</p>
<p>If you need the data for an analysis, ask. Say what you need it for and which traits or species you need; the admin exports it. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 2),
  ('disagree', $h$What if two people disagree?$h$, $h$<p>That is an ordinary and useful state, not a problem to avoid. The second person adds their own record and marks it a <strong>contest</strong>; the first record is automatically disputed and goes to the managers’ Disputed queue. That queue lists the disputed record — its value, who disputed it, and an automatic note naming the record that contests it. Opening the record shows the contesting records under <strong>Responses</strong>, and opening one of those shows its value and its reference.</p>
<p>The admin then decides which record is the accepted value for that species and trait. Both records stay in the dataset with their references — the disagreement is recorded, not resolved by deletion. If you decide the other value was right after all, withdraw your contest and the dispute lifts itself.</p>
<p>If both values are true — a species that flowers twice a year, a trait that varies between sites — the answer is a <strong>complement</strong>, not a contest. No dispute is raised.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'faq';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('contact', $h$Contact$h$, $h$Where to write when the app cannot answer, and what to put in the message.$h$, 7);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>Write to <a href="mailto:elisabpereira@gmail.com">elisabpereira@gmail.com</a>, the project’s contact address. A person reads it, so plain English is fine and there is no form to fill in.</p>
<p>Things only the admin can do, and which are therefore worth writing about:</p>
<ul><li>adding a species, a trait or a level that is missing;</li>
<li>correcting a trait’s description or unit;</li>
<li>setting, changing or clearing the accepted value for a species and trait — including freeing a record you need to withdraw;</li>
<li>assigning you to a field plot, or changing the plots you are assigned to;</li>
<li>exporting data for an analysis;</li>
<li>anything that looks like a bug: a page that fails, a number that cannot be right.</li>
</ul>$h$, 0),
  ('what-to-send', $h$What to include$h$, $h$<p>A short message that answers these saves a round trip:</p>
<ul><li><strong>Where you were.</strong> The address of the page from your browser — it names the species, the trait or the record, so nothing has to be guessed.</li>
<li><strong>What you expected, and what happened instead.</strong> One sentence each.</li>
<li><strong>The names in full.</strong> The species with its authority, the trait as the dictionary spells it, the level you were looking for.</li>
<li><strong>The reference,</strong> as a DOI, if the message is about a source or a value taken from one.</li>
<li><strong>When it happened,</strong> if it is about something that failed. A date and a rough time are enough to find it in the logs.</li>
</ul>
<p>Please do not send passwords or one-time codes. Nobody on the project will ever ask you for them.</p>$h$, 1)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'contact';
