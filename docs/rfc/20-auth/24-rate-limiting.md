# RFC-24 — Rate limiting

| Field | Value |
|---|---|
| Status | accepted |
| Category | auth |
| Supersedes | — |

## Context

Authentication routes are brute-force targets and every route can be flooded. Limits are enforced in Redis so they hold across API restarts and instances.

## Rules

- **R1** Algorithm: sliding window over a Redis sorted set per key (`rl:<scope>:<key>`), evaluated atomically by one Lua script: expire entries older than the window, count the rest, reject when the count has reached the limit, otherwise record the attempt and refresh the key's TTL to the window length. Rejected requests are not recorded, so the wait is honest; every allowed attempt counts, successful or not. A hit may carry a cost: it is admitted only when the current count plus the cost fits the limit, and then records that many units; otherwise it records none.
- **R2** A rejected request answers 429 `RATE_LIMITED` with `Retry-After: <seconds>` = time until the oldest recorded attempt leaves the window, rounded up, at least 1.
- **R3** Scopes and limits:

  | Scope | Key | Limit |
  |---|---|---|
  | global | session id, else client IP | 300 per minute per session; 100 per minute per IP |
  | `login` | email + IP; IP | 5 per 15 minutes; 20 per 15 minutes |
  | `login/totp` | MFA challenge id, else IP | 5 per 15 minutes |
  | `password/forgot` | email + IP; IP | 3 per 15 minutes; 10 per 15 minutes |
  | `invite/accept`, `password/reset` | IP | 10 per 15 minutes |
  | `references/resolve` | user id | 60 per minute |
  | `taxonomy/match` | user id | 30 per minute |
  | `apiKeyCreate` | user id | 5 per 15 minutes |
  | `global:api_key` | key id | 3000 per 10 minutes |

  The `invite/accept`/`password/reset` limit is configurable (`RATE_LIMIT_TOKEN_IP`), defaulting to 10 when unset.

- **R4** The global limiter runs on every request after the session is resolved (RFC-22 R7); `GET /api/health` and `GET /api/health/ready` are exempt. A key-authenticated request uses the per-key bucket (RFC-82 R9). A Bearer header that does not authenticate is counted against `global:ip` before its 401, so it may answer 429 instead (RFC-82 R3). An operation dispatched by `POST /api/batch` is not counted: the batch has already paid for it (RFC-82 R14).
- **R5** Route limiters run before request validation, so malformed bodies count. The email key is read from the raw body when present; a body without a usable email is limited by IP only.
- **R6** A login rejected by a limiter is audited as `auth.login.failure` with `metadata.reason = "rate_limited"` and a null actor.
- **R7** Keys never contain personal data: the email and the IP enter a key only as their RFC-40 R5 blind index; session and MFA ids enter as their HMAC form (RFC-22 R4).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
- 2026-09-12 — accepted.
- 2026-09-17 — R3: DOI check limiter (plan 09a).
- 2026-09-18 — R3: `invite/accept`/`password/reset` limit is configurable, 10 by default.
- 2026-09-19 — R3: `taxonomy/match` limiter, 30 per minute per user (RFC-81 R4, plan 12c).
- 2026-09-26 — R3, R4: `apiKeyCreate` and `apiKey` buckets (RFC-82, plan 14a).
- 2026-09-26 — R3: the per-key bucket is named `global:api_key`, as in RFC-82 R9; R4: a failing Bearer counts against `global:ip`.
- 2026-09-26 — R1: a hit may cost more than one unit; R4: batch operations are paid by the batch (RFC-82 R14, plan 14b).
