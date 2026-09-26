openapi-sha256: 0000000000000000000000000000000000000000000000000000000000000000

# TreeRepro API guide

## What this is

The external API is not a separate surface: it is the same `/api/*` routes the TreeRepro workspace itself calls, reached with a personal API key instead of a session cookie. Every validation, permission check and authorship rule applies exactly as it does in the browser. It exists so admins can pull the pending records, fix them locally with R or Python, and send the corrections back (RFC-82).

Only a user holding the `admin` system role can create or use a key (RFC-82 R2), so this guide is written for that audience.

- All requests and responses are JSON.
- Every response is wrapped in the same envelope the workspace uses (RFC-11 R2, R3): a success answers `{ "data": ... }` (a list also carries `"meta": { "nextCursor": ... }`); a failure answers `{ "error": { "code": "...", "message": "...", "details": [...] } }`, `details` present only for `VALIDATION_FAILED`.
- The full machine-readable reference — every route, its schemas and its guard — is generated from the running code at `GET /api/docs/openapi.json`. This guide is served at `GET /api/docs`. Both need a key (RFC-82 R20).

## Authentication and the key lifecycle

Create a key from the workspace, not from a script: **Settings › API keys**, which asks for your current password and a current TOTP code (TOTP must already be enabled on your account) before issuing it. The secret is shown once — copy it immediately, TreeRepro never stores or displays it again.

Send it on every request as:

```
Authorization: Bearer tr_live_<the rest of the key>
```

Never send a session cookie alongside it: a request carrying both a cookie and a Bearer header answers 401, and so does a Bearer header that fails to authenticate — for any reason, without saying why (RFC-82 R3, R4).

A key expires 90 days after creation. There is no renewal endpoint: create a new key before the old one expires and update your script's configuration.

A key is also revoked outright, before its 90 days are up, the moment any of these happens to its owner (RFC-82 R3):

- their password is reset or changed,
- TOTP is disabled (or re-enrolled),
- they sign out everywhere,
- their account is suspended,
- an administrator revokes all of their sessions, or
- a role change takes the `admin` system role away from them.

A revoked key stays revoked forever — reactivating the account or granting the admin role back does not bring it back. Create a fresh key instead.

**A script must stop on 401, never retry.** A failing Bearer header is counted against the IP's own `global:ip` budget before it answers 401 (RFC-82 R3, RFC-24 R4), so a loop that keeps hammering a dead key can exhaust that budget and answer 429 instead — for every request from that address, not just yours. Treat 401 as fatal: log it and exit.

## What a key cannot do

A key reaches every permission-guarded route with its owner's full permissions, and the API-key-only routes (`POST /api/batch`, `GET /api/docs`, `GET /api/docs/openapi.json`), but nothing else (RFC-82 R6):

- Every self-service and account-management route — the profile, password, TOTP, sessions, key management itself, `GET /api/auth/me`, the help pages — answers 401 `AUTH_UNAUTHENTICATED` to a key. These need a session, so a key cannot even create another key.
- `users.invite`, `users.update`, `users.suspend`, `users.delete`, `roles.manage` and `sessions.revoke` answer 403 `PERMISSION_DENIED` to a key-authenticated request, even though the key's owner is an admin holding those permissions through a session. This also applies to an operation sent inside a batch: a batch cannot mint an account, change a role or sign anyone out either.

## Fixing pending records

An imported value that could not be harmonised automatically — an unrecognised level, several values in one cell, a non-numeric value where a number was expected — sits in the pending queue until a human maps it. Three routes cover the whole workflow, all needing `records.review` (which the `admin` role already holds):

**1. `GET /api/records/pending/traits`** — every trait that currently has pending values in your visibility scope, with how many.

Response:

```json
{
  "data": [
    {
      "trait": {
        "id": "3f1b2c3d-4e5f-4a6b-8c7d-1234567890ab",
        "key": "leaf_habit",
        "valueType": "categorical",
        "unit": null
      },
      "count": 42
    }
  ]
}
```

**2. `GET /api/records/pending?traitId=<id>`** — the distinct raw values pending for one trait, grouped and counted. Query parameters (`pendingGroupsQuerySchema`):

| Parameter | Required | Meaning |
|---|---|---|
| `traitId` | yes | The trait's id, from step 1. |
| `cursor` | no | The `meta.nextCursor` of a previous page. |
| `limit` | no | Page size, 1–200, default 50. |

Response:

```json
{
  "data": [
    {
      "valueText": "evergreen ",
      "harmonisation": "unknown_level",
      "count": 12,
      "sampleRecordId": "9c2e1a4b-6d3f-4c8a-9e1b-abcdef012345"
    },
    {
      "valueText": "12,5",
      "harmonisation": "not_numeric",
      "count": 3,
      "sampleRecordId": "a1b2c3d4-5e6f-4a7b-8c9d-0123456789ab"
    }
  ],
  "meta": { "nextCursor": null }
}
```

`harmonisation` is why the group needs a decision: `unknown_level` (a categorical trait, the text matches no active level), `multi_value` or `not_numeric` (a quantitative trait). A trait's levels — their `id` and `key` — are listed under `data.levels` of `GET /api/traits/:id`, which you will need to build the mapping below.

**3. `POST /api/records/pending/map`** — map one raw value to real levels (categorical) or a real number (quantitative), creating a record for every record that carried it (`mapPendingBodySchema`). Mapping an already-mapped value again creates nothing (RFC-82 R15).

Categorical example:

```json
{
  "traitId": "3f1b2c3d-4e5f-4a6b-8c7d-1234567890ab",
  "valueText": "evergreen ",
  "value": { "levelIds": ["b2c3d4e5-f6a7-4b8c-9d0e-1234567890cd"] }
}
```

Quantitative example, with a note explaining the fix:

```json
{
  "traitId": "5a6b7c8d-9e0f-4a1b-8c2d-3456789012ef",
  "valueText": "12,5",
  "value": { "numeric": { "single": 12.5 } },
  "note": "Comma used as decimal separator in the source spreadsheet"
}
```

`value` is a categorical mapping (1–20 distinct level ids) or a quantitative one (`numeric` takes the same shape as any manual measurement: `single`, `min`, `max`, `mean`, `sd`, `n`, at least one of the first four). `note` is optional free text, 1–2000 characters.

Response, either way:

```json
{ "data": { "created": 12, "skipped": 0 } }
```

`created` is the number of records made; `skipped` counts records that already had an equivalent, current value.

## Batch

`POST /api/batch` runs several operations as one call — the natural way to map a whole page of pending groups at once. It needs a key: a cookie session, or no credential, answers 401 (RFC-82 R10).

Request body:

```json
{
  "ops": [
    { "ref": "row-1", "method": "POST", "path": "/api/records/pending/map", "body": { "...": "..." } },
    { "ref": "row-2", "method": "GET", "path": "/api/records/pending/traits" }
  ]
}
```

- 1 to 500 operations per batch; the whole request body is bounded at 1 MiB, like any other request.
- `ref` (optional, 1–200 characters) is yours to set and is echoed back unchanged — use it to line up each result with the operation that produced it.
- `method` is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`; `path` is 1–2048 characters and must start with `/api/`.
- Operations run **in the order you sent them**, one at a time, and **each commits on its own**: a failing operation does not stop, undo or roll back any other.

Response:

```json
{
  "data": {
    "summary": { "ok": 1, "failed": 1 },
    "results": [
      { "ref": "row-1", "status": 200, "body": { "data": { "created": 1, "skipped": 0 } } },
      { "ref": "row-2", "status": 401, "body": { "error": { "code": "AUTH_UNAUTHENTICATED", "message": "..." } } }
    ]
  }
}
```

One result per operation, in the same order as the request, `null` in place of `ref` where you did not send one. `status` and `body` are exactly what that route would have answered on its own, errors included; a response that is not JSON gives `body: null`; an operation whose answer could not be read at all gives `status: 500`, `INTERNAL_ERROR`, and the batch still continues. `ok` counts the 2xx results, `failed` everything else.

An operation is refused with `status: 400` and a `VALIDATION_FAILED` body, without ever running, when its `path`:

- does not start with `/api/`,
- is `/api/batch` itself (a batch cannot contain a batch),
- targets a self-service route (the same ones listed above), or
- is a `GET` carrying a `body`.

Every operation's `body` is fixed when you send the batch, so there is no way to feed the id one operation just created into a later operation of the same batch — you only learn what was created when the whole response comes back. If a later write needs an id an earlier one creates, send two batches and read the first one's `results` before building the second. Re-sending an entire batch is safe: mapping an already-mapped pending group creates nothing, and a catalog create that collides answers the same duplicate error a single call would (for example 409 `FAMILY_NAME_TAKEN`) (RFC-82 R15).

## Limits

Every key has its own budget, independent of everyone else's: 3000 units per 10 minutes (RFC-24 R3). A single request costs 1 unit; a batch of `n` operations costs `n` units, charged before any operation runs.

When a batch would not fit in what is left of the current window, it answers 429 `RATE_LIMITED` with a `Retry-After` header (seconds) and **runs nothing at all** — not even the operations that would individually have fit (RFC-82 R14). Honour `Retry-After`: wait that long, then resend the identical batch.

## Errors

Every error follows the same envelope: `{ "error": { "code", "message", "details"? } }`. Scripts should branch on `code`, never on `message`. The codes an external caller is most likely to meet:

| Code | HTTP status | Meaning |
|---|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | No key, an unrecognised, expired or revoked key, or a cookie sent alongside one. Stop; do not retry. |
| `PERMISSION_DENIED` | 403 | The key's owner lacks the route's permission, or the route is off-limits to a key at all (identity, role and session management). |
| `VALIDATION_FAILED` | 400 | The request failed schema validation. `details` is an array of `{ path, message }`, one per failing field (`details[0].path`, for example). |
| `NOT_FOUND` | 404 | The route or the resource does not exist. |
| `RATE_LIMITED` | 429 | Too many requests for this key; see Limits above. |
| `INTERNAL_ERROR` | 500 | Unexpected failure on the server; safe to retry later, not immediately. |

Every other code is one of the domain-specific ones catalogued in RFC-12 (`docs/rfc/10-platform/12-error-codes.md`, mirrored by `packages/contracts/src/error-codes.ts`) — for instance `FAMILY_NAME_TAKEN` (409) when a catalog create collides with an existing name.

## Examples

Both examples read the key from the environment (never hard-code it), list the pending traits, fetch one trait's pending groups, map them all in a single batch, print whatever failed, and treat 401 as fatal. On 429 they sleep for `Retry-After` and resend the same batch — safe, because a 429 batch ran nothing (RFC-82 R14). Base URL: `https://treerepro.elisabarreto.com.br`.

### R (httr2)

```r
library(httr2)

base_url <- "https://treerepro.elisabarreto.com.br"
api_key <- Sys.getenv("TREEREPRO_API_KEY")
if (identical(api_key, "")) stop("Set TREEREPRO_API_KEY")

call_api <- function(method, path, query = NULL, body = NULL) {
  req <- request(paste0(base_url, path)) |>
    req_method(method) |>
    req_headers(Authorization = paste("Bearer", api_key)) |>
    req_error(is_error = function(resp) FALSE) # read every status ourselves
  if (!is.null(query)) req <- req_url_query(req, !!!query)
  if (!is.null(body)) req <- req_body_json(req, body)
  resp <- req_perform(req)
  if (resp_status(resp) == 401) stop("API key rejected (401) - stopping, never retrying")
  if (resp_status(resp) == 429) {
    retry_after <- as.numeric(resp_header(resp, "Retry-After"))
    message("Rate limited, sleeping ", retry_after, "s")
    Sys.sleep(retry_after)
    return(call_api(method, path, query, body)) # nothing ran (RFC-82 R14): safe to resend
  }
  resp_body_json(resp)
}

# 1. List pending traits, take the first
traits <- call_api("GET", "/api/records/pending/traits")$data
trait_id <- traits[[1]]$trait$id

# 2. Fetch that trait's pending groups
groups <- call_api("GET", "/api/records/pending", query = list(traitId = trait_id))$data

# 3. Map every group to a level (replace with a real level id from GET /api/traits/:id)
ops <- lapply(groups, function(g) {
  list(
    ref = g$sampleRecordId,
    method = "POST",
    path = "/api/records/pending/map",
    body = list(
      traitId = trait_id,
      valueText = g$valueText,
      value = list(levelIds = list("00000000-0000-0000-0000-000000000000"))
    )
  )
})
result <- call_api("POST", "/api/batch", body = list(ops = ops))

# 4. Print every failed operation
for (r in result$data$results) {
  if (r$status < 200 || r$status >= 300) {
    msg <- if (!is.null(r$body$error$message)) r$body$error$message else "<no body>"
    cat(sprintf("%s: %s %s\n", r$ref, r$status, msg))
  }
}
```

### Python (requests)

```python
import os
import sys
import time

import requests

BASE_URL = "https://treerepro.elisabarreto.com.br"
API_KEY = os.environ["TREEREPRO_API_KEY"]
HEADERS = {"Authorization": f"Bearer {API_KEY}"}


def call(method, path, **kwargs):
    resp = requests.request(method, f"{BASE_URL}{path}", headers=HEADERS, **kwargs)
    if resp.status_code == 401:
        sys.exit("API key rejected (401) - stopping, never retrying")
    if resp.status_code == 429:
        retry_after = int(resp.headers.get("Retry-After", "1"))
        print(f"Rate limited, sleeping {retry_after}s", file=sys.stderr)
        time.sleep(retry_after)
        return call(method, path, **kwargs)  # nothing ran (RFC-82 R14): safe to resend
    return resp


# 1. List pending traits, take the first
traits = call("GET", "/api/records/pending/traits").json()["data"]
trait_id = traits[0]["trait"]["id"]

# 2. Fetch that trait's pending groups
groups = call("GET", "/api/records/pending", params={"traitId": trait_id}).json()["data"]

# 3. Map every group to a level (replace with a real level id from GET /api/traits/:id)
ops = [
    {
        "ref": g["sampleRecordId"],
        "method": "POST",
        "path": "/api/records/pending/map",
        "body": {
            "traitId": trait_id,
            "valueText": g["valueText"],
            "value": {"levelIds": ["00000000-0000-0000-0000-000000000000"]},
        },
    }
    for g in groups
]
result = call("POST", "/api/batch", json={"ops": ops}).json()

# 4. Print every failed operation
for r in result["data"]["results"]:
    if not (200 <= r["status"] < 300):
        message = (r["body"] or {}).get("error", {}).get("message", "<no body>")
        print(f"{r['ref']}: {r['status']} {message}")
```

## Changelog

- 2026-09-26 — First version: API keys (14a), batch (14b), this guide and the generated reference (14c).
