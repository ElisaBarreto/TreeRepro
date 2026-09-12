# Contributing

TreeRepro is published so the scientists taking part in the project can read, check and improve what is being built. It is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): use, changes and redistribution are allowed for noncommercial purposes only.

## Contribution terms

By opening a pull request or otherwise submitting code, documentation or other material ("a contribution") you confirm that:

1. You wrote the contribution, or have the right to submit it under these terms.
2. You license the contribution under the PolyForm Noncommercial License 1.0.0, like the rest of the project.
3. You additionally grant Elisa Barreto a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, reproduce, modify, distribute, sublicense and relicense the contribution as part of TreeRepro, including under other licence terms.

Item 3 is what lets the project change its licence later (for example to an open-source licence) without tracking down every contributor.

## How to contribute

- **Validate.** Read `docs/rfc/` (the business rules) and check the code against them. Every exported symbol carries an `@rfc RFC-NN Rx` tag pointing at the rule it implements. Open an issue when a rule, a test or an implementation looks wrong.
- **Discuss first.** For anything beyond a small fix, open an issue before writing code.
- **Follow the process.** `README.md` lists the non-negotiable rules: RFC first, TDD, no trust in the frontend, security from day one, English everywhere, exact pinned versions.
- **Open a pull request.** Every PR must pass the required checks (lint, typecheck, RFC links, tests, image build and scans, CodeQL, dependency review, secret and workflow scans). CodeRabbit reviews every PR; a maintainer merges.

## Reporting security problems

Not in a public issue. See [SECURITY.md](SECURITY.md).
