openapi-sha256: d52998a814de5eb20488e9fd968a291c789a5bd93c5ae71e203c4561929d5f93

# TreeRepro API guide

## What this is

The external API is not a separate surface: it is the same `/api/*` routes the TreeRepro workspace itself calls, reached with a personal API key instead of a session cookie. Every validation, permission check and authorship rule applies exactly as it does in the browser. It exists so admins can pull the pending records, fix them locally with R or Python, and send the corrections back (RFC-82).

Only a user holding the `admin` system role can create or use a key (RFC-82 R2), so this guide is written for that audience.

- Most `/api/*` routes, including every one described below and `GET /api/docs/openapi.json`, take and answer JSON, wrapped in the same envelope the workspace uses (RFC-11 R2, R3): a success answers `{ "data": ... }` (a list also carries `"meta": { "nextCursor": ... }`); a failure answers `{ "error": { "code": "...", "message": "...", "details": [...] } }`, `details` present only for `VALIDATION_FAILED`. This does not hold for every route: `GET /api/health` and `GET /api/health/ready` answer a plain body with no envelope, `GET /api/export/dataset.zip` streams a ZIP file, `GET /api/maps/files/:name` streams an image, and `GET /api/docs` itself answers Markdown.
- The full machine-readable reference — every route, its schemas and its guard — is generated from the running code at `GET /api/docs/openapi.json`. This guide is served at `GET /api/docs`. Both need a key (RFC-82 R20).
- Without a key at hand, **Settings › API keys** in the workspace lists every route a key reaches, with its summary and the permission it needs (RFC-82 R22).

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
- TOTP is disabled (re-enrolling always disables the old factor first, which already revokes every key),
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
  "value": { "numeric": 12.5 },
  "note": "Comma used as decimal separator in the source spreadsheet"
}
```

`value` is a categorical mapping (1–20 distinct level ids) or a quantitative one (`numeric` is one finite number — unlike a manual measurement, a mapped value is always a single point, never a range or a summary statistic). `note` is optional free text, 1–2000 characters.

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
    { "ref": "row-2", "method": "PATCH", "path": "/api/me", "body": { "name": "New name" } }
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
      { "ref": "row-2", "status": 400, "body": { "error": { "code": "VALIDATION_FAILED", "message": "Account routes need a session" } } }
    ]
  }
}
```

One result per operation, in the same order as the request, `null` in place of `ref` where you did not send one. `status` and `body` are exactly what that route would have answered on its own, errors included; a response that is not JSON gives `body: null`; an operation whose answer could not be read at all gives `status: 500`, `INTERNAL_ERROR`, and the batch still continues. `ok` counts the 2xx results, `failed` everything else.

An operation is refused with `status: 400` and a `VALIDATION_FAILED` body, without ever running, when its `path`:

- does not start with `/api/`,
- has a malformed percent-escape (an invalid `%` sequence), so it cannot even be decoded,
- resolves (dot segments and percent-decoding applied, the same normalisation the operation would run at) to a pathname that no longer starts with `/api/`,
- is `/api/batch` itself, normalised, or anything under it (a batch cannot contain a batch),
- targets a self-service route (the same ones listed above), or
- is a `GET` carrying a `body`.

Every operation's `body` is fixed when you send the batch, so there is no way to feed the id one operation just created into a later operation of the same batch — you only learn what was created when the whole response comes back. If a later write needs an id an earlier one creates, send two batches and read the first one's `results` before building the second. Re-sending an entire batch is safe: mapping an already-mapped pending group creates nothing, and a catalog create that collides answers the same duplicate error a single call would (for example 409 `FAMILY_NAME_TAKEN`) (RFC-82 R15).

### A batch that takes too long

The batch answers only once its last operation has run. Requests reach the API through a proxy (Cloudflare) that gives up on an answer that has not started within about 100 seconds and replies **524** itself: an HTML page, not the JSON envelope. The API does not see that. It keeps running the remaining operations, and each one still commits; you only lose the list of results.

So:

- Keep batches of writes small: at most **100 operations**. The 500 cap is what the API accepts, not what a slow write can finish in time.
- Treat any answer that is not JSON (a 524, a 502, a gateway error page) as "unknown": some, all or none of the operations ran. Do not resend the same batch blindly. Re-read the state first (for pending groups, list them again: a group the lost batch mapped no longer appears, and mapping one of its leftovers again creates nothing, RFC-82 R15), then send only what is still left. A catalog create that then answers a duplicate error (for example 409 `FAMILY_NAME_TAKEN`) was done by the lost batch.

## Limits

Every key has its own budget, independent of everyone else's: 3000 units per 10 minutes (RFC-24 R3). A single request costs 1 unit; a batch of `n` operations costs `n` units, charged before any operation runs.

When a batch would not fit in what is left of the current window, it answers 429 `RATE_LIMITED` with a `Retry-After` header (seconds) and **runs nothing at all** — not even the operations that would individually have fit (RFC-82 R14). Honour `Retry-After`: wait that long, then resend the identical batch.

## Errors

Every error follows the same envelope: `{ "error": { "code", "message", "details"? } }`. A script should branch on the HTTP status first, then on `code` — never on `message`. The codes an external caller is most likely to meet:

| Code | HTTP status | Meaning |
|---|---|---|
| `AUTH_UNAUTHENTICATED` | 401 | No key, an unrecognised, expired or revoked key, or a cookie sent alongside one. Stop; do not retry. |
| `PERMISSION_DENIED` | 403 | The key's owner lacks the route's permission, or the route is off-limits to a key at all (identity, role and session management). |
| `VALIDATION_FAILED` | 400 | The request failed schema validation. `details` is an array of `{ path, message }`, one per failing field (`details[0].path`, for example). |
| `VALIDATION_INVALID_JSON` | 400 | The request body is not valid JSON. |
| `REQUEST_TOO_LARGE` | 413 | The request body exceeds 1 MiB. |
| `NOT_FOUND` | 404 | An unknown route, or an id-based lookup whose route has no more specific not-found code. |
| `RATE_LIMITED` | 429 | Too many requests for this key; see Limits above. |
| `INTERNAL_ERROR` | 500 | Unexpected failure on the server; safe to retry later, not immediately. |

A missing resource usually answers a code specific to it instead of the generic `NOT_FOUND` above — `SPECIES_NOT_FOUND`, `TRAIT_NOT_FOUND`, `RECORD_NOT_FOUND`, `MAP_NOT_FOUND`, and so on; check `packages/contracts/src/error-codes.ts` for the full list, or the HTTP status alone (every one of these is 404). Every other code is one of the domain-specific ones catalogued in RFC-12 (`docs/rfc/10-platform/12-error-codes.md`, mirrored by that same file) — for instance `FAMILY_NAME_TAKEN` (409) when a catalog create collides with an existing name.

## Examples

Both examples read the key from the environment (never hard-code it), list the pending traits, fetch one trait's pending groups, map them in batches of 100, print whatever failed, and treat 401 as fatal. An answer that is not JSON (a 524 from the proxy, see "A batch that takes too long") stops the script: running it again is the recovery, since it lists what is still pending before mapping. On 429 they sleep for `Retry-After` and resend the same batch — safe, because a 429 batch ran nothing (RFC-82 R14). Base URL: `https://treerepro.elisabarreto.com.br`.

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
  if (!grepl("^application/json", resp_content_type(resp))) {
    # A 524 from the proxy: operations may have run. Re-running the script
    # re-reads what is still pending, so never resend blindly here.
    stop("No JSON answer (", resp_status(resp), ") - some operations may have run; run the script again")
  }
  resp_body_json(resp)
}

# 1. List pending traits, take the first categorical one (levelIds mapping
# below needs a categorical trait; a quantitative one maps to a plain number
# instead, see "Fixing pending records" above)
traits <- call_api("GET", "/api/records/pending/traits")$data
categorical <- Filter(function(t) t$trait$valueType == "categorical", traits)
if (length(categorical) == 0) {
  message("No pending categorical traits right now")
  quit(save = "no", status = 0)
}
trait_id <- categorical[[1]]$trait$id

# 2. Pick a real, active level to map every group to (a real script maps each
# valueText to the level it actually means; this picks one just to demonstrate the call)
levels <- call_api("GET", paste0("/api/traits/", trait_id))$data$levels
active_levels <- Filter(function(l) l$active, levels)
if (length(active_levels) == 0) stop("Trait has no active level to map to")
level_id <- active_levels[[1]]$id

# 3. Fetch every page of that trait's pending groups
groups <- list()
cursor <- NULL
repeat {
  query <- list(traitId = trait_id)
  if (!is.null(cursor)) query$cursor <- cursor
  page <- call_api("GET", "/api/records/pending", query = query)
  groups <- c(groups, page$data)
  cursor <- page$meta$nextCursor
  if (is.null(cursor)) break
}
if (length(groups) == 0) {
  message("No pending groups for this trait")
  quit(save = "no", status = 0)
}

# 4. Map every group to that level, 100 operations per batch
ops <- lapply(groups, function(g) {
  list(
    ref = g$sampleRecordId,
    method = "POST",
    path = "/api/records/pending/map",
    body = list(
      traitId = trait_id,
      valueText = g$valueText,
      value = list(levelIds = list(level_id))
    )
  )
})
for (chunk in split(ops, ceiling(seq_along(ops) / 100))) {
  result <- call_api("POST", "/api/batch", body = list(ops = unname(chunk)))

  # 5. Print every failed operation
  for (r in result$data$results) {
    if (r$status < 200 || r$status >= 300) {
      msg <- if (!is.null(r$body$error$message)) r$body$error$message else "<no body>"
      cat(sprintf("%s: %s %s\n", r$ref, r$status, msg))
    }
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
    if not resp.headers.get("Content-Type", "").startswith("application/json"):
        # A 524 from the proxy: operations may have run. Re-running the script
        # re-reads what is still pending, so never resend blindly here.
        sys.exit(f"No JSON answer ({resp.status_code}) - some operations may have run; run the script again")
    return resp


# 1. List pending traits, take the first categorical one (levelIds mapping
# below needs a categorical trait; a quantitative one maps to a plain number
# instead, see "Fixing pending records" above)
traits = call("GET", "/api/records/pending/traits").json()["data"]
categorical = [t for t in traits if t["trait"]["valueType"] == "categorical"]
if not categorical:
    sys.exit("No pending categorical traits right now")
trait_id = categorical[0]["trait"]["id"]

# 2. Pick a real, active level to map every group to (a real script maps each
# valueText to the level it actually means; this picks one just to demonstrate the call)
levels = call("GET", f"/api/traits/{trait_id}").json()["data"]["levels"]
active_levels = [level for level in levels if level["active"]]
if not active_levels:
    sys.exit("Trait has no active level to map to")
level_id = active_levels[0]["id"]

# 3. Fetch every page of that trait's pending groups
groups = []
cursor = None
while True:
    params = {"traitId": trait_id, **({"cursor": cursor} if cursor else {})}
    page = call("GET", "/api/records/pending", params=params).json()
    groups.extend(page["data"])
    cursor = page["meta"]["nextCursor"]
    if not cursor:
        break
if not groups:
    sys.exit("No pending groups for this trait")

# 4. Map every group to that level, 100 operations per batch
ops = [
    {
        "ref": g["sampleRecordId"],
        "method": "POST",
        "path": "/api/records/pending/map",
        "body": {
            "traitId": trait_id,
            "valueText": g["valueText"],
            "value": {"levelIds": [level_id]},
        },
    }
    for g in groups
]
for start in range(0, len(ops), 100):
    result = call("POST", "/api/batch", json={"ops": ops[start : start + 100]}).json()

    # 5. Print every failed operation
    for r in result["data"]["results"]:
        if not (200 <= r["status"] < 300):
            message = (r["body"] or {}).get("error", {}).get("message", "<no body>")
            print(f"{r['ref']}: {r['status']} {message}")
```

## Changelog

- 2026-09-26 — `GET /api/me/api-keys/endpoints` (session only, admin system role): the routes a key reaches, shown in Settings › API keys (issue #221). (openapi d52998a814de)
- 2026-09-26 — "A batch that takes too long": a batch outliving the proxy timeout answers 524 while its operations keep committing; batches of writes stay at 100 operations, and a script re-reads the state instead of resending. The examples map in batches of 100 and stop on an answer that is not JSON (issue #219). (openapi 03bc32d24279)
- 2026-09-26 — First version: API keys (14a), batch (14b), this guide and the generated reference (14c). (openapi 03bc32d24279)
