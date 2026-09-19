import type { PermissionKey } from '@treerepro/contracts';
import { and, eq, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm';
import { UNRESTRICTED } from '../access/visibility.ts';
import { recordAudit } from '../audit/audit.ts';
import { countDisputed, countPendingGroups } from '../dataset/queues.ts';
import type { DbExecutor } from '../db/client.ts';
import { rolePermissions } from '../db/schema/role-permissions.ts';
import { ADMIN_ROLE_NAME, roles } from '../db/schema/roles.ts';
import { userRoles } from '../db/schema/user-roles.ts';
import { users } from '../db/schema/users.ts';
import { sanitizeError } from '../http/errors.ts';
import type { Logger } from '../logger.ts';
import type { Mailer } from '../mail/mailer.ts';
import { digestEmail } from '../mail/templates.ts';
import { finishRun, latestRun, startRun } from './runs.ts';

/**
 * How long a successful digest postpones the next one. The timer ticks hourly,
 * so the threshold sits half an hour below a day: an hourly tick then lands
 * once a day instead of drifting later with every run.
 * @rfc RFC-74 R2
 */
export const DIGEST_MIN_INTERVAL_MS = 23.5 * 60 * 60 * 1000;

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
 * never postpones a tick.
 * @rfc RFC-74 R2
 */
export interface DigestLastSuccess {
  finishedAt: Date | null;
  detail: Record<string, unknown>;
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
 * @rfc RFC-74 R2, R6
 */
export function isDigestDue(
  lastSuccess: DigestLastSuccess | null,
  now: Date,
): { due: boolean; windowStart: Date } {
  const fallback = new Date(now.getTime() - DIGEST_FIRST_WINDOW_MS);
  if (lastSuccess === null || lastSuccess.finishedAt === null)
    return { due: true, windowStart: fallback };
  const recorded = lastSuccess.detail.windowEnd;
  const windowEnd = typeof recorded === 'string' ? new Date(recorded) : null;
  return {
    due: now.getTime() - lastSuccess.finishedAt.getTime() >= DIGEST_MIN_INTERVAL_MS,
    windowStart: windowEnd && !Number.isNaN(windowEnd.getTime()) ? windowEnd : fallback,
  };
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

  const [recordCounts, annotationCounts, contestRows, disputeRows, pendingGroups, disputedNow] =
    await Promise.all([
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
      // RFC-75 arrives with plan 12c; there is no table to count until then.
      proposals: 0,
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

/** How often the timer wakes up. @rfc RFC-74 R2 */
export const DIGEST_TICK_MS = 60 * 60 * 1000;

/** How long the first tick waits after start. @rfc RFC-74 R2 */
export const DIGEST_FIRST_TICK_MS = 60_000;

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

  const lastSuccess = await latestRun(db, 'digest', ['completed', 'skipped']);
  const { due, windowStart } = isDigestDue(lastSuccess, now);
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
    const mail = digestEmail({ digest, appOrigin, date: windowDetail.windowEnd.slice(0, 10) });
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
        // rejected") would put a live address in `message`. `stack` is safe
        // to keep (its first, message-bearing line is already filtered out
        // by `sanitizeError`); only `message` is dropped here.
        const error = err instanceof Error ? err : new Error(String(err));
        const { name, code, stack } = sanitizeError(error);
        logger.error(
          { err: { name, code, stack }, recipientId: recipient.id },
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
      metadata: { recipients: recipients.length, failed, ...windowDetail },
    });
    // R5: the run completes once every send has been ATTEMPTED, so a partial
    // failure is `completed` with `failed: n`, never a `failed` run.
    await finishRun(db, runId, {
      status: 'completed',
      detail: { ...windowDetail, recipients: recipients.length, failed, counts: digest.counts },
    });
    return { runId, status: 'completed', recipients: recipients.length, failed };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    // Best effort, exactly as `purgeAudit` (RFC-42 R4): the run row is a
    // trace, and the job's own error is what the caller must see.
    await finishRun(db, runId, { status: 'failed', error: error.message }).catch(() => undefined);
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
