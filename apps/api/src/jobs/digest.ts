import type { PermissionKey } from '@treerepro/contracts';
import { and, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { UNRESTRICTED } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import { countProposalsCreated } from '../dataset/proposals.ts';
import { countDisputed, countPendingGroups } from '../dataset/queues.ts';
import type { DbExecutor } from '../db/client.ts';
import { rolePermissions } from '../db/schema/role-permissions.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import { safeErrorSummary, sanitizeError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import { digestEmail } from '../mail/templates.ts';
import { finishRun, latestRun, recordRunDetail, startRun } from './runs.ts';

/**
 * How long a successful digest postpones the next one. The timer ticks hourly,
 * so the threshold sits half an hour below a day: an hourly tick then lands
 * once a day instead of drifting later with every run.
 * @rfc RFC-74 R2
 */
export const DIGEST_MIN_INTERVAL_MS = 23.5 * 60 * 60 * 1000;

/** How often the timer wakes up. @rfc RFC-74 R2 */
export const DIGEST_TICK_MS = 60 * 60 * 1000;

/** How long the first tick waits after start. @rfc RFC-74 R2 */
export const DIGEST_FIRST_TICK_MS = 60_000;

/**
 * How long a `digest` run that recorded no success postpones the next tick.
 *
 * A run that throws in its tail — `recordAudit` at the latest, AFTER every
 * e-mail has gone out — lands in one of TWO states, and the guard has to cover
 * both. The catch writes `failed` and normally succeeds, so the row ends
 * `failed`; only when the process dies, or when `finishRun` itself is what
 * threw, does the row stay `running`. Neither status is in
 * `latestRun(db, 'digest', ['completed', 'skipped'])`, so that call keeps
 * answering the PREVIOUS success — which finished more than
 * `DIGEST_MIN_INTERVAL_MS` ago and still carries the old `windowEnd`. Without
 * this guard the next tick therefore recomputes the IDENTICAL window and mails
 * every manager again, hourly, for as long as the database is unwell. R2's "a
 * restart never doubles it" has to hold for a caught throw too, and a guard on
 * `running` alone would have covered only the rarer half.
 *
 * Two ticks, not one: the guard is compared against `started_at`, and the very
 * next tick fires a full `DIGEST_TICK_MS` after the previous one did, so a
 * one-tick window lands exactly on its own boundary and buys nothing — it
 * would reduce to "did the previous tick's INSERT take longer than the
 * interval drift", with Node's clock on one side and Postgres' on the other.
 * Two is the smallest value with margin. It is deliberately far below
 * `DIGEST_MIN_INTERVAL_MS`: a run stuck in either state must cost at most one
 * delayed digest, never the digest itself. A job that fails on every attempt
 * therefore retries every two ticks instead of every one, and the window it
 * covers grows to match, so nothing is dropped.
 * @rfc RFC-74 R2
 */
export const DIGEST_ATTEMPT_GUARD_MS = 2 * DIGEST_TICK_MS;

/** The window of the first run ever, and of any run whose predecessor left none. @rfc RFC-74 R2 */
const DIGEST_FIRST_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How many contests and how many disputes the e-mail lists. @rfc RFC-74 R3 */
export const DIGEST_LIST_LIMIT = 10;

/** The name shown when an actor's user row carries none; a `not null` column, so defensive only. */
const UNKNOWN_ACTOR = 'Unknown';

/** Typed, so a mistyped key fails the build rather than quietly emptying the list. @rfc RFC-74 R4 */
const DIGEST_PERMISSION: PermissionKey = 'records.review';

/** Half-open `(start, end]`. @rfc RFC-74 R2 */
export interface DigestWindow {
  start: Date;
  end: Date;
}

/**
 * The first seven are counted over the window; `pendingGroups` and
 * `disputedNow` are the queues as they stand now (RFC-65 R8, R10), which is
 * why `hasActivity` leaves them out.
 * @rfc RFC-74 R3
 */
export interface DigestCounts {
  records: number;
  contests: number;
  complements: number;
  validations: number;
  disputes: number;
  withdrawals: number;
  proposals: number;
  pendingGroups: number;
  disputedNow: number;
}

/** One listed contest or dispute. No address ever appears here (R5). @rfc RFC-74 R3 */
export interface DigestItem {
  speciesId: string;
  speciesName: string;
  traitKey: string;
  valueText: string;
  actorName: string;
  recordId: string;
  createdAt: Date;
}

/** @rfc RFC-74 R3 */
export interface Digest {
  window: DigestWindow;
  counts: DigestCounts;
  contests: DigestItem[];
  disputes: DigestItem[];
}

/**
 * The newest `digest` run that is `completed` or `skipped` — what
 * `latestRun(db, 'digest', ['completed', 'skipped'])` answers, so a `JobRunRow`
 * is passed straight in. A `failed` or `running` run is not one of these and
 * never sets the window; it postpones the tick through `DigestLastAttempt`
 * instead.
 * @rfc RFC-74 R2
 */
export interface DigestLastSuccess {
  finishedAt: Date | null;
  detail: Record<string, unknown>;
}

/**
 * The newest `digest` run that recorded no success — `running` or `failed`,
 * what `latestRun(db, 'digest', ['running', 'failed'])` answers, so a
 * `JobRunRow` is passed straight in.
 *
 * Both statuses, not just `running`: a throw after the sends normally ends
 * `failed`, because the catch's own `finishRun` succeeds. Only `started_at`
 * matters — such a run hands on no window, and a `running` one has no
 * `finished_at` at all.
 * @rfc RFC-74 R2
 */
export interface DigestLastAttempt {
  startedAt: Date;
}

/** One e-mail goes to each of these; the name and the address are decrypted (RFC-40 R8). @rfc RFC-74 R4 */
export interface DigestRecipient {
  id: string;
  email: string;
  name: string;
}

/**
 * Whether this tick runs the digest, and the window it would cover.
 *
 * The window starts where the last success stopped. It falls back to the last
 * 24 hours both for the first run ever and whenever that run recorded no usable
 * window end — a `DIGEST_ENABLED=false` tick is `skipped` with
 * `detail = { reason: 'disabled' }` (R6), so a `lastSuccess` without a window
 * is an ordinary state, not a corruption.
 *
 * `lastAttempt` is the second half of R2's "a restart never doubles it": a run
 * that recorded no success — `running` OR `failed` — and is younger than
 * `DIGEST_ATTEMPT_GUARD_MS` postpones this tick whatever the last success
 * says, because that run may have mailed already. `null` is not optional — it
 * must be passed deliberately, for the same reason `RunDigestInput.enabled` is
 * required: the value that decides whether mail goes out must never be able to
 * fail open by omission.
 *
 * A run that failed BEFORE any send is postponed too, and that is deliberate:
 * the status alone cannot tell the two apart, the delay is bounded at two
 * ticks, and `DIGEST_MIN_INTERVAL_MS` is 23.5 h, so the window is still due
 * afterwards and simply grows to cover the gap. Nothing is dropped; the digest
 * arrives later that day. A bounded delay of one informational e-mail is the
 * cheaper error than mailing every manager the same window twice.
 * @rfc RFC-74 R2, R6
 */
export function isDigestDue(
  lastSuccess: DigestLastSuccess | null,
  now: Date,
  lastAttempt: DigestLastAttempt | null,
): { due: boolean; windowStart: Date } {
  const fallback = new Date(now.getTime() - DIGEST_FIRST_WINDOW_MS);
  // A stale row — a `running` one nothing will ever close, or a `failed` one
  // from a job that is simply broken — stops postponing once it ages past the
  // guard, so neither can disable the digest for good.
  const recentAttempt =
    lastAttempt !== null &&
    now.getTime() - lastAttempt.startedAt.getTime() < DIGEST_ATTEMPT_GUARD_MS;
  if (lastSuccess === null || lastSuccess.finishedAt === null)
    return { due: !recentAttempt, windowStart: fallback };
  const recorded = lastSuccess.detail.windowEnd;
  const windowEnd = typeof recorded === 'string' ? new Date(recorded) : null;
  return {
    due:
      !recentAttempt && now.getTime() - lastSuccess.finishedAt.getTime() >= DIGEST_MIN_INTERVAL_MS,
    windowStart: windowEnd && !Number.isNaN(windowEnd.getTime()) ? windowEnd : fallback,
  };
}

/** The `detail.phase` a run records once it is about to mail. @rfc RFC-74 R2 */
const DIGEST_SENDING_PHASE = 'sending';

/**
 * The parts of an unsuccessful run's `job_runs` row that say whether it had
 * begun mailing — a `JobRunRow` is passed straight in.
 * @rfc RFC-74 R2
 */
export interface DigestAttemptDetail {
  id: string;
  detail: Record<string, unknown>;
}

/**
 * The id of the run this one repeats, or null.
 *
 * A repeat is a run covering a window a previous one had ALREADY begun
 * mailing: that run recorded `phase: 'sending'` with its own `windowStart`
 * immediately before its send loop, and this run is about to start from the
 * same instant. The same starting point means the same ground.
 *
 * `detail` is read back as `unknown` and both fields are checked, exactly as
 * `isDigestDue` treats `windowEnd`: a jsonb column can hold anything, and a
 * shape that fails silently here would make every repeat invisible again.
 *
 * KNOWN, DELIBERATE FALSE POSITIVE: a run that threw on its very FIRST send
 * also recorded `phase: 'sending'`, so its successor calls itself a repeat
 * although nobody received anything. Narrowing that would mean tracking
 * delivery per recipient; the trade is taken on purpose, because a spurious
 * resend line costs a reader one sentence while a missing one defeats the
 * whole point of announcing it (R2).
 *
 * Only the NEWEST unsuccessful run is compared. With two stacked failures the
 * third run names the second, not the first; every participant stays
 * discoverable as a `sending` row carrying the same `windowStart`.
 * @rfc RFC-74 R2, R5
 */
export function repeatedRunId(
  lastAttempt: DigestAttemptDetail | null,
  windowStart: Date,
): string | null {
  if (lastAttempt === null) return null;
  if (lastAttempt.detail.phase !== DIGEST_SENDING_PHASE) return null;
  const recorded = lastAttempt.detail.windowStart;
  if (typeof recorded !== 'string' || recorded !== windowStart.toISOString()) return null;
  return lastAttempt.id;
}

/**
 * Whether the window is worth an e-mail. The two queue sizes are deliberately
 * out of the sum: they describe the present, not the window, and a quiet day
 * with a standing queue must still be `skipped`.
 * @rfc RFC-74 R4
 */
export function hasActivity(counts: DigestCounts): boolean {
  return (
    counts.records +
      counts.contests +
      counts.complements +
      counts.validations +
      counts.disputes +
      counts.withdrawals +
      counts.proposals >
    0
  );
}

interface RecordCountRow {
  records: number;
  contests: number;
  complements: number;
}

interface AnnotationCountRow {
  validations: number;
  disputes: number;
  withdrawals: number;
}

interface ItemRow {
  record_id: string;
  species_id: string;
  species_name: string;
  trait_key: string;
  value_text: string;
  actor_id: string | null;
  created_at: Date | string;
}

/**
 * Everything the e-mail of one window needs.
 *
 * RFC-33 plays no part here (R3: "unrestricted"): the digest describes the
 * dataset, not one viewer's slice of it, and every recipient holds
 * `dataset.read`. The counts therefore need no visibility join, and the two
 * queue sizes come from the same functions the dashboard reads (RFC-72 R1) so
 * that the e-mail and the queue page can never disagree.
 *
 * The item rows carry actor *ids*; the names come from a Drizzle select over
 * `users`, whose column type decrypts them on read (RFC-40 R8). Raw SQL would
 * hand back ciphertext, which is why this is two queries and not a join.
 * @rfc RFC-74 R3
 * @rfc RFC-65 R8, R10
 * @rfc RFC-40 R8
 */
export async function computeDigest(db: DbExecutor, window: DigestWindow): Promise<Digest> {
  const start = window.start.toISOString();
  const end = window.end.toISOString();
  const within = (column: SQL): SQL =>
    sql`${column} > ${start}::timestamptz and ${column} <= ${end}::timestamptz`;

  const [
    recordCounts,
    annotationCounts,
    contestRows,
    disputeRows,
    pendingGroups,
    disputedNow,
    proposals,
  ] = await Promise.all([
    // R3 reads `records` as "manual records created", which a contest and a
    // complement both are: the two intents are subsets of `records`, not
    // additions to it. R4's activity sum is a "was anything done at all"
    // test, so counting a contest twice there changes nothing.
    db.execute(sql`
        select
          count(*) filter (where r.origin = 'manual')::int as records,
          count(*) filter (where r.origin = 'manual' and r.intent = 'contest')::int as contests,
          count(*) filter (where r.origin = 'manual' and r.intent = 'complement')::int as complements
        from trait_records r
        where ${within(sql`r.created_at`)}`) as unknown as Promise<[RecordCountRow | undefined]>,
    db.execute(sql`
        select
          count(*) filter (where a.kind = 'confirm')::int as validations,
          count(*) filter (where a.kind = 'dispute' and not a.generated)::int as disputes,
          count(*) filter (where a.kind = 'withdraw')::int as withdrawals
        from record_annotations a
        where ${within(sql`a.created_at`)}`) as unknown as Promise<
      [AnnotationCountRow | undefined]
    >,
    db.execute(sql`
        select r.id as record_id, r.species_id, sp.canonical_name as species_name,
          t.key as trait_key, r.value_text, r.created_by as actor_id, r.created_at
        from trait_records r
        join species sp on sp.id = r.species_id
        join traits t on t.id = r.trait_id
        where r.intent = 'contest' and r.origin = 'manual' and ${within(sql`r.created_at`)}
        order by r.created_at desc, r.id desc
        limit ${DIGEST_LIST_LIMIT}`) as unknown as Promise<ItemRow[]>,
    // The listed dispute describes the record it stands against, so the
    // species, the trait and the value are the disputed record's, and the
    // link opens that record's drawer.
    db.execute(sql`
        select a.record_id, r.species_id, sp.canonical_name as species_name,
          t.key as trait_key, r.value_text, a.actor_id, a.created_at
        from record_annotations a
        join trait_records r on r.id = a.record_id
        join species sp on sp.id = r.species_id
        join traits t on t.id = r.trait_id
        where a.kind = 'dispute' and not a.generated and ${within(sql`a.created_at`)}
        order by a.created_at desc, a.id desc
        limit ${DIGEST_LIST_LIMIT}`) as unknown as Promise<ItemRow[]>,
    countPendingGroups(db, UNRESTRICTED),
    countDisputed(db, UNRESTRICTED),
    // RFC-75 R7: proposals created inside the window, whatever became of
    // them since — the count describes the window, not the queue.
    countProposalsCreated(db, window),
  ]);

  const actorIds = [
    ...new Set(
      [...contestRows, ...disputeRows]
        .map((row) => row.actor_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const actors =
    actorIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, actorIds));
  const nameById = new Map(actors.map((a) => [a.id, a.name]));
  const toItem = (row: ItemRow): DigestItem => ({
    speciesId: row.species_id,
    speciesName: row.species_name,
    traitKey: row.trait_key,
    valueText: row.value_text,
    actorName: (row.actor_id === null ? null : nameById.get(row.actor_id)) ?? UNKNOWN_ACTOR,
    recordId: row.record_id,
    createdAt: new Date(row.created_at),
  });

  return {
    window,
    counts: {
      records: recordCounts[0]?.records ?? 0,
      contests: recordCounts[0]?.contests ?? 0,
      complements: recordCounts[0]?.complements ?? 0,
      validations: annotationCounts[0]?.validations ?? 0,
      disputes: annotationCounts[0]?.disputes ?? 0,
      withdrawals: annotationCounts[0]?.withdrawals ?? 0,
      proposals,
      pendingGroups,
      disputedNow,
    },
    contests: contestRows.map(toItem),
    disputes: disputeRows.map(toItem),
  };
}

/**
 * Who gets the digest: every `active` user holding `records.review` through
 * any role, plus every holder of the seeded `admin` system role. R4's "or
 * holding `admin`" names the role, not a permission key — the admin role
 * carries no `role_permissions` rows at all and is resolved by name exactly
 * as `effectivePermissions` resolves it (RFC-31 R2, RFC-32 R1).
 *
 * One query over `user_roles` and `role_permissions`; a user qualifying twice
 * is deduplicated here rather than with `distinct`, which would compare the
 * encrypted name and address columns (RFC-40 R11).
 * @rfc RFC-74 R4
 * @rfc RFC-31 R2
 */
export async function digestRecipients(db: DbExecutor): Promise<DigestRecipient[]> {
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(
      rolePermissions,
      and(
        eq(rolePermissions.roleId, roles.id),
        eq(rolePermissions.permissionKey, DIGEST_PERMISSION),
      ),
    )
    .where(
      and(
        eq(users.status, 'active'),
        or(
          isNotNull(rolePermissions.permissionKey),
          and(eq(roles.isSystem, true), eq(roles.name, ADMIN_ROLE_NAME)),
        ),
      ),
    )
    .orderBy(users.id);
  const byId = new Map<string, DigestRecipient>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

/** `not_due` is the tick that wrote no run at all. @rfc RFC-74 R2 */
export type DigestRunStatus = 'completed' | 'skipped' | 'not_due';

/** What one tick did. @rfc RFC-74 R2, R5 */
export interface DigestRunResult {
  /** The `job_runs` row this tick wrote, or null when it wrote none. */
  runId: string | null;
  status: DigestRunStatus;
  /** How many recipients were attempted, and how many of those sends threw. */
  recipients: number;
  failed: number;
}

/** @rfc RFC-74 R2, R5, R6 */
export interface RunDigestInput {
  db: DbExecutor;
  mailer: Mailer;
  appOrigin: string;
  logger: Logger;
  /**
   * `DIGEST_ENABLED` (R6). REQUIRED, not optional: an omitted flag would
   * fail open and mail everyone, which is the wrong default for the input
   * that decides whether mail goes out at all — the same reasoning that
   * made `logger` required, applied with more force.
   */
  enabled: boolean;
  /** The instant this tick happens; defaults to now, and the tests inject it. */
  now?: Date;
}

/**
 * One tick of the daily digest: decide, compute, send, record.
 *
 * The order is the rule's order. `DIGEST_ENABLED` is read FIRST (R6), so a
 * disabled deployment records a `skipped` run on every tick rather than going
 * silent; only then does R2's due check run, and a tick that is not due writes
 * nothing at all — no row, no mail, no audit.
 * @rfc RFC-74 R2, R4, R5, R6
 * @rfc RFC-41 R1
 */
export async function runDigest(input: RunDigestInput): Promise<DigestRunResult> {
  const { db, mailer, appOrigin, logger } = input;
  const now = input.now ?? new Date();

  if (input.enabled === false) {
    const runId = await startRun(db, 'digest');
    // R6 exactly: no window, because none was computed. `isDigestDue` reads
    // such a run as "no usable window end" and falls back to the last 24 h
    // (Ruling C), which is the accepted cost of the flag.
    await finishRun(db, runId, { status: 'skipped', detail: { reason: 'disabled' } });
    return { runId, status: 'skipped', recipients: 0, failed: 0 };
  }

  // Two reads, not one: the last success sets the window, and the newest run
  // that recorded no success says whether a tick this hour would be a repeat
  // of one that already mailed (R2, `DIGEST_ATTEMPT_GUARD_MS`). BOTH
  // non-success statuses are asked for: the catch below writes `failed` and
  // normally succeeds, so `['running']` alone would have missed every caught
  // throw — which is the common case, not the rare one.
  const [lastSuccess, lastAttempt] = await Promise.all([
    latestRun(db, 'digest', ['completed', 'skipped']),
    latestRun(db, 'digest', ['running', 'failed']),
  ]);
  const { due, windowStart } = isDigestDue(lastSuccess, now, lastAttempt);
  if (!due) return { runId: null, status: 'not_due', recipients: 0, failed: 0 };

  const window: DigestWindow = { start: windowStart, end: now };
  /**
   * ISO strings, never a `Date`, a number or a nested object: `isDigestDue`
   * reads `detail.windowEnd` back as `unknown` and accepts it only when it is
   * a string that parses to a date. In any other shape it falls back to
   * `now - 24 h` — the window resets on every run and a window's activity is
   * dropped with no error and no failing test. The round trip between this
   * line and that reader is asserted in `digest.integration.test.ts`.
   */
  const windowDetail = {
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
  };

  // Decided before the run even opens, from the attempt already fetched above:
  // a previous run that recorded `phase: 'sending'` over this same
  // `windowStart` had begun mailing it (R2).
  const repeatOf = repeatedRunId(lastAttempt, window.start);

  const runId = await startRun(db, 'digest');
  try {
    const digest = await computeDigest(db, window);
    if (!hasActivity(digest.counts)) {
      // R4: nothing happened, so nothing is sent. The window is recorded all
      // the same, so the next run starts where this one stopped instead of
      // falling back and covering the same day twice.
      await finishRun(db, runId, {
        status: 'skipped',
        detail: { ...windowDetail, reason: 'no_activity', counts: digest.counts },
      });
      return { runId, status: 'skipped', recipients: 0, failed: 0 };
    }

    const recipients = await digestRecipients(db);
    if (recipients.length === 0) {
      // R4 says nothing else: the run still completes and audits normally.
      // But activity happened and nobody was told — every `records.review`
      // holder and every admin is gone, or was stripped of the permission —
      // and that is a misconfiguration nobody else is watching for.
      logger.warn(
        { windowStart: windowDetail.windowStart, windowEnd: windowDetail.windowEnd },
        'digest has activity but no recipients',
      );
    }
    const mail = digestEmail({
      digest,
      appOrigin,
      date: windowDetail.windowEnd.slice(0, 10),
      resent: repeatOf !== null,
    });
    if (repeatOf !== null) {
      // R2: the repeat is not prevented — resending beats risking a skipped
      // window — but it must never be silent. Three channels, because each
      // reaches a different reader: the operator's log now, the health page
      // of RFC-52 through `detail`, and the audit trail through `metadata`.
      logger.warn(
        {
          runId,
          repeatOf,
          windowStart: windowDetail.windowStart,
          windowEnd: windowDetail.windowEnd,
        },
        'digest repeats an unfinished run',
      );
    }
    // The last thing before the first e-mail, and deliberately not at
    // `startRun`: this row is what tells the NEXT run that this one had begun
    // mailing. A run that dies before this line never mailed, and must not be
    // read as a repeat (R2). `finishRun` replaces `detail` wholesale below, so
    // `phase` never survives into a finished row.
    await recordRunDetail(db, runId, { ...windowDetail, phase: 'sending' });
    let failed = 0;
    for (const recipient of recipients) {
      try {
        await mailer.send({ to: recipient.email, subject: mail.subject, text: mail.text });
      } catch (err) {
        failed += 1;
        // R5: a failed send is logged and counted, and the tick carries on.
        // The recipient is named by id, never an address — but `sanitizeError`
        // keeps `err.message` verbatim, and RFC-02 R7 redacts by KEY, not by
        // value: a real SMTP rejection ("550 5.1.1 <addr>: Recipient address
        // rejected") would put a live address in `message`, so `message` is
        // dropped here.
        //
        // `code` and `responseCode` take its place rather than leaving the
        // line contentless. Both are fixed tokens nodemailer sets on the error
        // itself — `EAUTH`, `ETIMEDOUT`, `EENVELOPE`, and the integer SMTP
        // reply status — so neither can carry an address, and together they
        // are what tells expired credentials apart from a five-second timeout
        // apart from one bad mailbox when a nightly digest logs `failed: n`.
        // `stack` is safe to keep as well: its first, message-bearing line is
        // already filtered out by `sanitizeError`.
        const error = err instanceof Error ? err : new Error(String(err));
        const { name, code, responseCode, stack } = sanitizeError(error);
        logger.error(
          { err: { name, code, responseCode, stack }, recipientId: recipient.id },
          'digest send failed',
        );
      }
    }

    // R5's metadata exactly: four numbers and two timestamps, no address and
    // no name. The actor is null because a background job has no session user
    // (RFC-41's `actor_user_id` is nullable for this).
    await recordAudit(db, {
      actorUserId: null,
      action: 'digest.sent',
      // `repeatOf` is a uuid, so `assertSafeMetadata` (RFC-41 R7) accepts the
      // key and the value carries no PII. Omitted entirely on an ordinary run
      // rather than written as null, so its presence is the signal.
      metadata: {
        recipients: recipients.length,
        failed,
        ...windowDetail,
        ...(repeatOf === null ? {} : { repeatOf }),
      },
    });
    // R5: the run completes once every send has been ATTEMPTED, so a partial
    // failure is `completed` with `failed: n`, never a `failed` run.
    await finishRun(db, runId, {
      status: 'completed',
      detail: {
        ...windowDetail,
        recipients: recipients.length,
        failed,
        counts: digest.counts,
        ...(repeatOf === null ? {} : { repeatOf }),
      },
    });
    return { runId, status: 'completed', recipients: recipients.length, failed };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Best effort, exactly as `purgeAudit` (RFC-42 R4): the run row is a
    // trace, and the job's own error is what the caller must see.
    //
    // `safeErrorSummary`, never `error.message`: anything in this try block
    // can throw a Drizzle query error, and `digestRecipients` queries the
    // ENCRYPTED `users.name` / `users.email` columns, so the raw message is
    // "Failed query: <sql>\nparams: <values>" over exactly those. The column
    // is durable, plaintext at rest and read back by the health page of
    // RFC-52; the rethrow below still carries the whole error to the log.
    await finishRun(db, runId, { status: 'failed', error: safeErrorSummary(error) }).catch(
      () => undefined,
    );
    throw error;
  }
}

/**
 * Ticks every `intervalMs` (hourly by default), the first time
 * `initialDelayMs` after start rather than immediately (R2): this job sends
 * mail, and a crash-restart loop must not send a digest per restart.
 *
 * `startRetentionTimer`'s discipline otherwise (RFC-42 R4): a failure is
 * logged and never thrown, both handles are unref'd so neither holds the
 * process open, and `stop()` clears them.
 * @rfc RFC-74 R2
 */
export function startDigestTimer(deps: {
  run: () => Promise<DigestRunResult>;
  logger: Logger;
  intervalMs?: number;
  initialDelayMs?: number;
}): { stop(): void } {
  let interval: ReturnType<typeof setInterval> | undefined;
  const tick = async (): Promise<void> => {
    try {
      const result = await deps.run();
      // 23 of the 24 daily ticks are not due; only a tick that did something
      // earns an info line.
      if (result.status === 'not_due') deps.logger.debug({ status: result.status }, 'digest tick');
      else deps.logger.info({ ...result }, 'digest run');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      deps.logger.error({ err: sanitizeError(error) }, 'digest run failed');
    }
  };
  const first = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), deps.intervalMs ?? DIGEST_TICK_MS);
    interval.unref();
  }, deps.initialDelayMs ?? DIGEST_FIRST_TICK_MS);
  first.unref();
  return {
    stop() {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    },
  };
}
