# RFC-24 — Rate limiting

| Field | Value |
|---|---|
| Status | draft |
| Category | auth |
| Supersedes | — |

## Context

Authentication routes are brute-force targets and every route can be flooded. Limits are enforced in Redis so they hold across API restarts and instances.

## Rules

- **R1** Algorithm: sliding window over a Redis sorted set per key (`rl:<scope>:<key>`), evaluated atomically by one Lua script: expire entries older than the window, count the rest, reject when the count has reached the limit, otherwise record the attempt and refresh the key's TTL to the window length. Rejected requests are not recorded, so the wait is honest; every allowed attempt counts, successful or not.
- **R2** A rejected request answers 429 `RATE_LIMITED` with `Retry-After: <seconds>` = time until the oldest recorded attempt leaves the window, rounded up, at least 1.
- **R3** Scopes and limits:

  | Scope | Key | Limit |
  |---|---|---|
  | global | session id, else client IP | 300 per minute per session; 100 per minute per IP |
  | `login` | email + IP; IP | 5 per 15 minutes; 20 per 15 minutes |
  | `login/totp` | MFA challenge id, else IP | 5 per 15 minutes |
  | `password/forgot` | email + IP; IP | 3 per 15 minutes; 10 per 15 minutes |
  | `invite/accept`, `password/reset` | IP | 10 per 15 minutes |

- **R4** The global limiter runs on every request after the session is resolved (RFC-22 R7); `GET /api/health` and `GET /api/health/ready` are exempt.
- **R5** Route limiters run before request validation, so malformed bodies count. The email key is read from the raw body when present; a body without a usable email is limited by IP only.
- **R6** A login rejected by a limiter is audited as `auth.login.failure` with `metadata.reason = "rate_limited"` and a null actor.
- **R7** Keys never contain personal data: the email and the IP enter a key only as their RFC-40 R5 blind index; session and MFA ids enter as their HMAC form (RFC-22 R4).

## Open questions

None.

## Changelog

- 2026-09-12 — created.
