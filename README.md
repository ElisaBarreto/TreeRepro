# 🌳 TreeRepro

**Help complete what we know about how trees reproduce.**

TreeRepro is a collective data assembly of reproductive trait data for trees, covering every reproductive stage: flowers, fruits and seeds. Its core data comes from open-access papers and data repositories. The dataset is shared with a community of specialist scientists who fill the gaps and validate the records already there.

## What it does

- **One curated dataset.** Every record belongs to a species, a trait and a bibliographic reference. Species names follow the World Checklist of Vascular Plants, and traits come from a versioned dictionary.
- **Built for specialists.** Contributors add records, back them with a DOI or their own field observation, and confirm or contest what others have entered.
- **Curation in the open.** Managers work the harmonisation and contested queues, and every change can be traced back to the person who made it.
- **Find the gaps.** Search species by taxonomy, trait or field plot, and see which traits still have no data.
- **Share the results.** Anyone with the right access can export the dataset as CSV.

## Who it is for

TreeRepro is invitation only. It serves the researchers taking part in the project, organised by role: contributors, managers and administrators. If you would like to take part, contact the project coordinator at elisabpereira@gmail.com.

## Under the hood

A TypeScript web application (React on the front end, a Hono API, PostgreSQL) that runs in Docker. Business rules are written first as numbered RFCs in [`docs/rfc/`](docs/rfc/), and the code links back to them. Security and personal-data protection (GDPR) are built in from the start.

Setup, commands and project rules for developers are in [`CLAUDE.md`](CLAUDE.md).

## Contributing

The source is public so the participating scientists can read it, check it against the rules and help improve it. See [`CONTRIBUTING.md`](CONTRIBUTING.md), and report security problems privately as described in [`SECURITY.md`](SECURITY.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md): free to use, change and share for noncommercial purposes.
