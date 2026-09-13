# Dataset gotchas

- **`seed:traits` re-inserts renamed levels.** The CSV in `apps/api/seed/trait-dictionary.csv` is the source of the vocabulary; `seed:traits` inserts whatever is missing. A level renamed through `PATCH /api/traits/:id/levels/:levelId` reappears under its old key on the next seed run unless the CSV is changed too (RFC-62 R6).
- **Guard numeric casts with nested `CASE`.** `x ~ pattern and abs(x::numeric) < 1e308` may evaluate the cast first — SQL `AND` does not short-circuit — and abort the whole import batch on `Aug`. `CASE WHEN … THEN (CASE WHEN … END) END` evaluates in order (RFC-64 R6).
- **`max(uuid)` does not exist.** For "the newest id of a group" use `(array_agg(id order by id desc))[1]` (pending groups' `sampleRecordId`).
- **User names only through Drizzle.** `users.name` is the `encryptedText` column type; a raw `db.execute` returns ciphertext. Fetch ids in SQL, names with `db.select({ name: users.name })` (disputed queue).
- **Arrays in Drizzle's `sql` tag are chunk lists, not parameters.** `sql\`… any(${ids})\`` splices the array as SQL fragments; build a `VALUES` list with `sql.join` (bulk mapping) or use `inArray`.
- **Literal routes before `/:id`.** Hono runs matching handlers in registration order; `GET /records/pending` registered after `GET /records/:id` dies in the uuid validator.
- **A bare Column in `reviewStatusSql` only qualifies inside a multi-table select.** Handled inside the helper (wraps the column in `sql` so a single-table select keeps it qualified).
- **`Response.text()` strips a leading BOM.** The export route (RFC-66 R4) writes a UTF-8 byte-order mark before the CSV body, but `Response.text()` runs the Encoding Standard's "UTF-8 decode", which silently discards a leading BOM — a test asserting on `res.text()` never sees it, even when the bytes are correct on the wire. Decode `await res.arrayBuffer()` with `new TextDecoder('utf-8', { ignoreBOM: true }).decode(...)` to observe it.
