-- RFC-73 R2: seeds the help topics with the owner's text, revised for the
-- record model of plans 13a–13i (plan 13j). Afterwards the database is the
-- only source and the admin edits the pages on the site (RFC-73 R7).
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('getting-started', $h$Getting started$h$, $h$What TreeRepro is, and what to do in your first ten minutes.$h$, 0);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('what', $h$What TreeRepro is$h$, $h$<p>TreeRepro is a collective assembly of reproductive trait data for trees, covering flowers, fruits and seeds. Its core data comes from open-source papers and data repositories, and it is shared with a community of specialists who fill the gaps and validate or contest what is already there.</p>
<p>Every value in the dataset is a <strong>record</strong>: one species, one trait, one value, the references it comes from, and a record ID — <code>EB_</code> and a number for records from the compiled dataset, <code>TR_</code> and a number for records entered here, with a letter added when one entry gave several levels. Records are never edited. You add to them, validate them or contest them, and each of those carries your name. TreeRepro keeps every claim side by side and never picks one; what it shows is how much agreement each has.</p>
<p>Whenever you can, give a reference for what you enter: a DOI, or a book’s ISBN.</p>$h$, 0),
  ('first-steps', $h$Your first ten minutes$h$, $h$<ol><li>Read <a href="/app/help/workflow">Workflow</a>. It is short, and every other screen assumes you know it.</li>
<li>Open <strong>Species</strong> in the sidebar. If plots have been assigned to you, the list starts with the species of your plots; see <a href="/app/help/scope">Scope</a>.</li>
<li>Open a species and find a trait you know well. If a value is right, press <strong>👍 Validate</strong> next to it. That is a real contribution: it tells everyone the value has been checked by someone who knows the species. If the value is wrong, press <strong>👎 Contest</strong>; if another value is also true, press <strong>➕ Complement</strong>. The legend at the top of the page names the three.</li>
<li>Tick <strong>Show traits with no data</strong>, pick a trait with no record yet and press <strong>Add the first entry</strong>. Give the value and its reference, or none if it is your own field observation.</li>
<li>Or browse by trait: <strong>Traits</strong> in the sidebar lists every trait, and a trait’s page shows every species with records for it.</li>
<li>Open <strong>My contributions</strong> to see everything you have entered and validated, in one place.</li>
</ol>$h$, 1),
  ('contact', $h$Questions or suggestions$h$, $h$<p>If a species, a trait or a level you need is missing, or something here does not match what you see on screen, write to us. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 2)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'getting-started';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('workflow', $h$Workflow$h$, $h$Add records, validate, contest, complement, withdraw — and what happens next.$h$, 1);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>A record is never edited. Everything below adds something next to it, either a validation or a record of your own, so every value can be traced to the person and the reference it came from.</p>
<p>On a species page, each level of a categorical trait carries three buttons: <strong>👍 Validate</strong>, <strong>👎 Contest</strong> and <strong>➕ Complement</strong>. The legend at the top of the page names them. For a quantitative trait, open its card: each record in the list carries the same three buttons. An opened record shows them too, written out, under <strong>Actions</strong>.</p>$h$, 0),
  ('different', $h$Adding a record$h$, $h$<p><strong>👎 Contest</strong>, <strong>➕ Complement</strong>, the <strong>+</strong> on a trait card, <strong>Add the first entry</strong> and <strong>Add entries for another trait</strong> all open the same form. It asks three things, in this order:</p>
<ol><li>If the species already has records for the trait, <strong>What does your value mean?</strong> — whether your entry <strong>contests</strong> or <strong>complements</strong> them, and, unless it is a contest on a categorical trait, which existing value it is <strong>Responding to</strong>. Nothing else in the form can be filled in until you answer, because the same value means something different in each case. <strong>Contest</strong> opens the form with Contest already chosen; the other entry points leave the choice to you.</li>
<li>The value. For a categorical trait, tick one level or several; each new level becomes a record of its own. For a quantitative trait, give the numbers your source reports: a single value, min, max, mean, SD and n, at least one of the first four; see <a href="/app/help/vocabulary#units">Units and numbers</a>.</li>
<li>Its references: one or more DOIs or books, up to ten, or none for your own observation. Every record the form creates carries all of them. See <a href="/app/help/references">References</a>.</li>
</ol>
<p>On a categorical trait that already has records, the form then spells out what it will do with each level — for example “Validate red · Contest blue · Add green” — and asks you to tick <strong>Confirm</strong> before <strong>Add record(s)</strong> sends it.</p>
<p>If your entry matches a record that is already there (the same level, or the same numbers in all six fields), no second record is created. Your entry counts as a validation of the existing record, and the form says so: “matches an existing record — counted as your validation”. If the matching record is your own, the form only reports it: “already your own record — nothing was added”.</p>$h$, 1),
  ('validate', $h$Validate$h$, $h$<p><strong>Validate</strong> says: I agree with this value as it stands. It asks “Do you confirm that this record is correct?” and, when you confirm, adds your name to the record as a validation. The record itself does not change. On a categorical trait, validating a level validates every record of that level.</p>
<p>You may add a supporting reference, a DOI or a book’s ISBN, for the source that makes you confident. Without one, your validation rests on your own knowledge, which is perfectly normal.</p>
<p>You cannot validate your own records, so the button is not offered on them. Each person counts once per record: once you have validated a record, it says “You validated this record”. A validation cannot be undone.</p>$h$, 2),
  ('contest', $h$Contest$h$, $h$<p><strong>Contest</strong> says: this value is wrong.</p>
<p>On a categorical trait, a contest states which levels are right: the levels you tick. Existing levels you tick count as your validations, new levels become records of your own, and the existing levels you leave unticked are contested. Pressing <strong>Contest</strong> next to a level opens the form with every other existing level already ticked, so only that level is contested; change the ticks if you disagree with more, and check the <strong>Confirm</strong> line before sending. If a species has red, blue and orange and you contest “blue”, red and orange are validated and blue is contested; giving only green instead would add a green record and contest all three. A contest must leave at least one existing level unticked; otherwise it is a complement.</p>
<p>On a quantitative trait you contest one record, with a value that differs from it in at least one of the six fields, and your value becomes a record of its own.</p>
<p>Either way, the level or record you contested is marked <strong>Contested</strong> for everyone until a manager reviews it. To take a contest back, withdraw the record it added. A categorical contest that added no record can only be withdrawn by a manager, so write to us.</p>$h$, 3),
  ('complement', $h$Complement$h$, $h$<p><strong>Complement</strong> says: this value is also correct, and I am adding another. A species can have more than one dispersal mode, biotic and abiotic for example. If only one is recorded, complement it with the other: both records are true and both belong in the dataset. On a quantitative trait, a complement adds another measurement, which helps capture variation within the species. A complement contests nothing.</p>$h$, 4),
  ('withdraw', $h$Withdraw$h$, $h$<p><strong>Withdraw</strong> takes a record back when you entered the wrong species, misread a table, or changed your mind. You can withdraw your own records at any time: open the record, press <strong>Withdraw</strong> under <strong>Actions</strong> and confirm. You do not have to write a note.</p>
<p>A withdrawn record leaves the dataset. For every viewer, it disappears from every list, count and export. Managers can also withdraw records entered by others. Only the admin can withdraw a record imported from the compiled dataset.</p>$h$, 5),
  ('review', $h$What managers do next$h$, $h$<p>Open contests go to the managers’ <strong>Contested</strong> queue. The responsible team reviews the original records, may contact the people who entered them, and settles each contest in one of two ways:</p>
<ul><li>by withdrawing one side: the contest with <strong>Withdraw contest</strong>, which takes out every record it added; a contested level with its own withdraw button (<strong>Withdraw "blue"</strong>, say); or a contested quantitative record with <strong>Withdraw record</strong>;</li>
<li>or with <strong>Keep both</strong>, when both values turn out to be true.</li>
</ul>
<p>Either way the <strong>Contested</strong> mark clears. A manager cannot withdraw imported records; when some are left, the page says so, and an admin can withdraw them or the contest can end with <strong>Keep both</strong>. In a separate <strong>Pending</strong> queue, managers map by hand the imported values that the dictionary cannot read.</p>
<p>None of this is instant. What you do is recorded the moment you press the button, though, and it shows on <strong>My contributions</strong> straight away.</p>$h$, 6)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'workflow';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('vocabulary', $h$Vocabulary$h$, $h$Traits, categories, levels and units — and why a value is chosen, not typed.$h$, 2);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('traits', $h$Traits and categories$h$, $h$<p>A <strong>trait</strong> is one property of a species that can be recorded, such as seed mass, dispersal mode or pollination mode. Every trait belongs to a broad <strong>category</strong> such as flowers, fruits or pollination.</p>
<p>Each trait is one of two kinds:</p>
<ul><li><strong>Categorical</strong>: the value is one of a fixed list of levels.</li>
<li><strong>Quantitative</strong>: the value is a number, in the trait’s own unit.</li>
</ul>
<p>The <strong>Traits</strong> page lists them all, category by category, with the number of species that have data for each. Open a trait to see how its records are distributed and which species are still missing it.</p>$h$, 0),
  ('levels', $h$Levels$h$, $h$<p>The allowed values of a categorical trait are its <strong>levels</strong>. You tick them in a list. There is no free-text box, so records from different sources line up and can be counted together. You may tick several levels in one entry, and each becomes a record of its own.</p>
<p>If the level you need is not in the list, do not force the nearest one. Write to us with the trait, the level you need and a reference that uses it. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 1),
  ('units', $h$Units and numbers$h$, $h$<p>A quantitative trait has one standard unit, shown in brackets after its name, for example <em>Seed mass (mg)</em>. Every record of that trait is stored in that unit, so convert a value you read in grams before you enter it, and leave the unit out of the box: type <em>1200</em>, not <em>1200 mg</em>. Write a decimal point, not a comma, and no thousands separators.</p>
<p>A quantitative record takes up to six numbers. Enter the ones your source reports:</p>
<ul><li>a <strong>Single value</strong>;</li>
<li>a minimum and a maximum (<strong>Min</strong>, <strong>Max</strong>);</li>
<li>a mean, its standard deviation and the sample size (<strong>Mean</strong>, <strong>SD</strong>, <strong>n</strong>).</li>
</ul>
<p>You must give at least one of the single value, min, max or mean. The min cannot exceed the max, the SD cannot be negative, and n is a whole number of at least 1. If a source gives only a range, enter it as a min and a max; you do not need to invent a midpoint.</p>
<p>On a species page, the trait card summarises these numbers as min · mean · max. It shows the smallest and the largest value across the species’ records, and the mean of their single values. Where a record has no single value, its mean is used instead.</p>$h$, 2),
  ('descriptions', $h$Descriptions$h$, $h$<p>The <strong>?</strong> next to a trait’s name shows its description: what exactly is measured, and how. Read it before you enter a value, especially for a trait whose name is used differently in different literatures. If a description is missing, ambiguous or wrong, please tell us, because it affects every record of that trait.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'vocabulary';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('references', $h$References$h$, $h$DOIs, books, your own observations, and several references on one record.$h$, 3);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>Every record names where its value comes from. There are three possible answers: a published work identified by its DOI, a book identified by its ISBN, or your own observation.</p>$h$, 0),
  ('doi', $h$DOIs$h$, $h$<p>A DOI looks like <code>10.1234/abcd.5678</code>: the registrant prefix, a slash, and the publisher’s own suffix. Paste it in whatever form you have it: bare, as <code>doi:10.1234/abcd.5678</code>, or as the full <code>https://doi.org/…</code> link.</p>
<p>When you leave the DOI box, TreeRepro checks it against the DOI registry. The line under the field shows the result:</p>
<ul><li><strong>Checking…</strong>: the check is running. Wait for it to finish.</li>
<li><strong>Resolved: …</strong>: the DOI is real, and the rest of the line names the work.</li>
<li><strong>DOI not found</strong>: the registry does not know it. Check the DOI against the paper itself.</li>
<li><strong>Malformed DOI</strong>: it is not shaped like a DOI. The usual causes are a missing digit, a stray space, or a page URL copied instead of the DOI.</li>
<li><strong>Could not check the DOI — try again</strong>: the registry could not be reached. This says nothing about your DOI. Click into the field and out again to run the check once more. If it keeps failing, let us know.</li>
</ul>
<p>Only <strong>Resolved</strong> lets the form through.</p>$h$, 1),
  ('book', $h$Books$h$, $h$<p>For a book, click <strong>Add a book (ISBN)</strong> and fill in its <strong>ISBN</strong> (ISBN-10 or ISBN-13, with or without hyphens) and its <strong>Citation</strong>: authors, year and title. TreeRepro checks the ISBN’s check digit but does not look the book up online, so type the citation yourself. The same ISBN, however it is typed, is always the same book.</p>$h$, 2),
  ('personal-observation', $h$Personal observation$h$, $h$<p>Give no reference — leave the DOI blank and add no book — when the value comes from your own field work or expert knowledge rather than from a publication. The form then says <em>This will be recorded as your personal observation</em>. That is a legitimate source here, and it is the reason the dataset is shared with specialists.</p>
<p>The value is recorded as <strong>your</strong> personal observation, a reference of its own that says whose observation it is. Nobody else can cite it as their source. If someone else observed the same thing, they record their own observation.</p>$h$, 3),
  ('several', $h$Several references$h$, $h$<p>A value may rest on several sources. Use <strong>Add another reference</strong> for each further DOI and <strong>Add a book (ISBN)</strong> for each book, up to ten rows in all. All of them belong to the record the form creates, or to each record if you ticked several levels, and each one counts as used.</p>
<p>A personal observation cannot be mixed with other references. If the value comes from the literature, give its references. If it is your own, give none.</p>$h$, 4),
  ('bibliography', $h$Where references come from$h$, $h$<p>The <strong>References</strong> page in the sidebar lists the publications and books that the records cite, most used first, with how many records name each one as a primary and as a secondary source. Each has its own page showing its details and the traits it has been used for. Personal observations are not listed there. On a record, they read “Personal observation” with the observer’s name.</p>
<p>You never have to add a reference to that page yourself. Giving a DOI or an ISBN on a record creates it.</p>$h$, 5)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'references';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('scope', $h$Scope$h$, $h$Plots, the species list beyond them, and rows that are retired rather than deleted.$h$, 4);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('plots', $h$Plots$h$, $h$<p>Species belong to <strong>plots</strong>, which are field sites, and contributors are assigned to the plots they work on. That is how the project knows whom to ask about which species.</p>
<p>Your plots are on the workspace home page under <strong>Your scope</strong>, each with the number of species it holds. If that card is not there, no plot has been assigned to you and you see the whole dataset. To be assigned to a plot, write to us.</p>$h$, 0),
  ('outside', $h$Showing species outside your plots$h$, $h$<p>When you have plots, the <strong>Species</strong> page starts with their species only. Tick <strong>Show species outside my plots</strong> to search the whole dataset. Managers and admins start with the whole dataset and can untick it to come back to their plots. Contributors who are restricted to their plots do not have that checkbox. Counts on a trait or a reference cover the whole dataset, so they can be larger than what you can list.</p>$h$, 1),
  ('inactive', $h$Inactive species and traits$h$, $h$<p>Nothing scientific is deleted. A species, trait or level that should no longer be used is marked <strong>inactive</strong>. It is no longer offered for new records, and records that already point at it keep their value. Most contributors never see inactive rows. Managers and admins see them marked <em>inactive</em>, and the species list gives them a <strong>Status</strong> filter to show active or inactive species.</p>$h$, 2),
  ('missing-species', $h$Why a species you know is missing$h$, $h$<p>There are usually three possible reasons:</p>
<ul><li>It is outside your plots. Tick <strong>Show species outside my plots</strong> and search again.</li>
<li>It is filed under another name. Each species is filed under its accepted name in the World Checklist of Vascular Plants (WCVP), but the search also matches synonyms and common names and tells you which name it matched. Search for the name you know. If that finds nothing, search for the genus alone.</li>
<li>It is not in the dataset yet.</li>
</ul>
<p>In the last case, search the <a href="/app/species">Species</a> page for the name. When nothing matches, press <strong>Propose this species</strong> to send it to the reviewers. Their answer appears on the <strong>Proposals</strong> tab of <a href="/app/contributions">My contributions</a>. If you do not see that button, write to us with the species name, its authority and its plot, if it has one. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'scope';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('contributions', $h$Contributions$h$, $h$Your own records and annotations in one place, and what Contested means.$h$, 5);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('page', $h$The My contributions page$h$, $h$<p><strong>My contributions</strong> in the sidebar gathers everything you have done:</p>
<ul><li><strong>Records</strong>: the records you entered, newest first, with their value, their references, their ✓ and ✗ counts, whether they are contested, and whether they contest or complement another record.</li>
<li><strong>Annotations</strong>: your validations, each shown with the record it is about. A manager also finds here every contest they settled with <strong>Keep both</strong>.</li>
<li><strong>Proposals</strong>: the species you proposed and the reviewers’ answers, if your role lets you propose species.</li>
</ul>
<p>You can filter the Records and Annotations lists by trait, species, review (contested, validated or unvalidated), intent (contest, complement or none) and the date the record was added. The filters are kept in the address bar, so a filtered view is a link you can share. Above the tabs, a row of counts summarises your work: the <strong>Records</strong> you entered, the <strong>Contests</strong> and <strong>Complements</strong> you made, and the <strong>Validations</strong> you gave.</p>$h$, 0),
  ('statuses', $h$Statuses$h$, $h$<p>There is one status, <strong>Contested</strong>. A level of a categorical trait, or a record of a quantitative one, is contested while a contest against it is open, meaning the contest has been neither withdrawn nor settled by a manager. A trait is contested for a species when any of its levels or records is. Everyone sees the mark, and ticking <strong>Contested only</strong> on the <strong>Species</strong> page lists only the species that carry it.</p>
<p>Otherwise a record has no status, only counts: ✓ for the people who validated it and ✗ for the people who contested it, each person counted once. TreeRepro never picks a winning value. A trait counts as <strong>validated</strong> for a species once at least one of its records has a validation.</p>
<p>A contest stops counting when a record on either side is withdrawn, or when a manager chooses <strong>Keep both</strong>. See <a href="/app/help/workflow#review">Workflow</a>.</p>$h$, 1),
  ('withdraw', $h$Withdrawing$h$, $h$<p>To withdraw one of your records, open it from this page, press <strong>Withdraw</strong> and confirm. A withdrawn record leaves the dataset and disappears from this page as well. <a href="/app/help/workflow#withdraw">Workflow</a> explains who can withdraw what.</p>$h$, 2)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'contributions';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('faq', $h$FAQ$h$, $h$Editing, names, downloads and disagreements — the four questions that come up first.$h$, 6);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  ('edit', $h$Can I edit a record?$h$, $h$<p>No, and nobody else can either. Records are only ever added, never changed. That is what makes a value traceable: the record you read today says exactly what its reference said, with the name of the person who entered it.</p>
<p>If a value is wrong, contest it with <strong>👎 Contest</strong>. If the mistake is in one of your own records, withdraw it and enter a new one. Both are explained in <a href="/app/help/workflow">Workflow</a>.</p>$h$, 0),
  ('names', $h$Who sees my name?$h$, $h$<p>Signed-in scientists with access to the dataset. Your name appears next to the records you enter and the validations you give, on the species pages, in the curation queues and on your contributions page. Managers can also open your contributions page. The export, which only the admin can download, names the people who validated and contested each record. Your e-mail address is never shown next to your records or included in the export.</p>
<p>Nothing here is public. Everything is behind sign-in.</p>$h$, 1),
  ('download', $h$Can I download the data?$h$, $h$<p>Only the admin can download the dataset, from the Species page. <strong>Export dataset (ZIP)</strong> holds every record; <strong>Export platform contributions (ZIP)</strong> holds only the records entered on the platform. Each ZIP has two CSV files: one with the records and one with every validation and contest.</p>
<p>If you need data for an analysis, write to us and say what it is for and which traits or species you need. <a href="/app/help/contact">Contact</a> has the address.</p>$h$, 2),
  ('disagree', $h$What if two people disagree?$h$, $h$<p>That is an ordinary and useful situation. The second person presses <strong>👎 Contest</strong> and enters their value. The contested value is marked <strong>Contested</strong> and goes to the managers’ <strong>Contested</strong> queue. The responsible team reviews the original records and may contact the people who entered them. Then they either withdraw one side or keep both. Nothing is settled by editing. If you decide the other value was right after all, withdraw your contest.</p>
<p>If both values are true, for example a species with two dispersal modes or a trait that varies between sites, use <strong>➕ Complement</strong> instead of a contest.</p>$h$, 3)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'faq';
--> statement-breakpoint
INSERT INTO help_topics (slug, title, summary, position) VALUES
  ('contact', $h$Contact$h$, $h$Where to write when the app cannot answer, and what to put in the message.$h$, 7);
--> statement-breakpoint
INSERT INTO help_sections (topic_id, anchor, title, body_html, position)
SELECT t.id, s.anchor, s.title, s.body_html, s.position
FROM help_topics t, (VALUES
  (NULL, $h$$h$, $h$<p>Write to <a href="mailto:elisabpereira@gmail.com">elisabpereira@gmail.com</a> with any question, suggestion or comment about TreeRepro. A person reads every message, and there is no form to fill in.</p>
<p>Some things only the admin can do, so they are worth writing about:</p>
<ul><li>adding a species, a trait or a level that is missing;</li>
<li>correcting a trait’s description or unit;</li>
<li>correcting or adding to these help pages;</li>
<li>assigning you to a plot, or changing your plots;</li>
<li>withdrawing a record imported from the compiled dataset;</li>
<li>exporting data for an analysis;</li>
<li>anything that looks like a bug: a page that fails, a number that cannot be right.</li>
</ul>$h$, 0),
  ('what-to-send', $h$What to include$h$, $h$<ul><li><strong>Where you were:</strong> the page address from your browser, or the record’s ID (<code>EB_…</code> or <code>TR_…</code>, shown as <strong>Record ID</strong> when you open a record).</li>
<li><strong>What you expected, and what happened instead:</strong> one sentence each.</li>
<li><strong>The names in full:</strong> the species with its authority, the trait and the level.</li>
<li><strong>The reference,</strong> as a DOI or ISBN, if the message is about a source or a value taken from one.</li>
<li><strong>When it happened,</strong> if something failed. A date and a rough time are enough.</li>
</ul>
<p>Never send passwords or one-time codes. Nobody on the project will ever ask for them.</p>$h$, 1)
) AS s(anchor, title, body_html, position)
WHERE t.slug = 'contact';
