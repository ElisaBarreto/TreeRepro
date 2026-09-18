---
status: accepted
category: integrations
---

# RFC-80: DOI Resolution

## Context
To avoid manual data entry and duplicate references, contributors supply DOIs. The API resolves them synchronously over the network against the global registries before returning from the route.

## Rules
- **R1** A DOI submitted by a client is first normalised: resolver prefixes (`https://doi.org/`, `http://doi.org/`, `https://dx.doi.org/`, `http://dx.doi.org/`, `doi:`) and surrounding whitespace are stripped; the remainder is percent-decoded exactly once (`%3C` becomes `<`; `%2523` becomes `%23`, not `#`; a `%` that starts no valid escape, as in `10.1234/100%`, is a literal character of the DOI and leaves the string as it is); the result is lowercased. A DOI that does not match `^10\.\d{4,9}\/\S{1,200}$` after normalisation is malformed (400 `VALIDATION_FAILED`) — an encoded space (`%20`) is therefore malformed too. What is stored is the canonical DOI, whether it was pasted from a browser's address bar or typed; the web app is the single place that percent-encodes it, when it builds the `https://doi.org/` link (RFC-61 R4).
- **R2** The application talks to the Handle System and Crossref REST APIs through a wrapper (the `DoiClient`). The calls use a fixed `User-Agent` built from the application version and a contact e-mail read from the environment (e.g., `TreeRepro/1.2 (mailto:ops@example.test)`).
- **R3** A DOI resolution goes through up to two registry calls. 1. `GET https://doi.org/api/handles/{doi}`. If the JSON answer has `responseCode: 1`, the DOI is `resolvable`; if `100` or the HTTP status is 404, the DOI is `not_found`. Any other error (network failure, timeout, non-JSON response) makes the lookup `failed`. The HTTP client aborts the request if the response exceeds 1 MiB or redirects. 2. If `resolvable`, `GET https://api.crossref.org/works/{doi}` fetches the metadata.
- **R4** `GET /api/references/resolve?doi=...` takes a DOI and returns one of three statuses. `known`: the DOI (lower case) already exists in the local `bibliographic_references` table; the response includes the full reference object. `resolvable`: the DOI exists but is not local yet; the response includes a preview object with the title, authors, year, and journal extracted from Crossref (or nulls if Crossref does not know it). `not_found`: the DOI does not exist. (If the lookup fails, it returns 502 `DOI_LOOKUP_FAILED`).
- **R5** A DOI source is resolved and, if it is new, inserted into `bibliographic_references` *before* the transaction that writes the record or annotation — registry calls never run inside it. If `findReferenceByDoi(doi)` misses, the API calls the `DoiClient` and inserts a reference with `citationKey: doi:{doi}`, the resolved metadata, the actor as the creator, and an audit entry `source: 'doi'`, in its own transaction; the record or annotation then links the local id inside its own. A reference therefore survives a record write that fails afterwards, which is intended: the DOI is a fact about the world, not about the claim. `bibliographic_references` is unique on `lower(doi)`, so a DOI names at most one reference whatever the casing, and the insert is `ON CONFLICT DO NOTHING` followed by a re-read: a raised unique violation would abort the surrounding transaction and the re-read with it. Sources are distinct after resolution — naming a reference by its id and again by its DOI is one source, and the second is a 400 `VALIDATION_FAILED`.
- **R6** The fixed-host HTTP client takes a strictly hardcoded allowed host (e.g. `doi.org`). It forbids redirects (`redirect: 'manual'`) to prevent the registry from pointing the application to an internal IP (SSRF).

## Open questions

None.

## Changelog

- 2026-09-18 — R1 amended: normalisation percent-decodes once before validating, so an already-encoded DOI is stored canonical instead of being encoded a second time on render (issue #104).
