-- Read-only checks for a production rehearsal (plan 15a, docs/gotchas/import.md
-- "PlantRepro migrations: rehearsal and go"). Run before and after `migrate` on a
-- restored copy of production and diff the two outputs: only the new columns and
-- their backfilled values may differ.
--   psql -X -At -v ON_ERROR_STOP=1 -f checks.sql   (PGOPTIONS='-c default_transaction_read_only=on')
-- Every line is `section|key|value`, every query ordered, nothing reads the clock.
-- Users appear by id only, never by name or e-mail (both are encrypted anyway).

select count(*) > 0 as has_role_platform from information_schema.columns
  where table_schema = 'public' and table_name = 'user_roles' and column_name = 'platform' \gset
select count(*) > 0 as has_plant_type from information_schema.columns
  where table_schema = 'public' and table_name = 'species' and column_name = 'plant_type' \gset
select
  coalesce(bool_or(table_name = 'region_snapshot'), false) as has_snapshot_platform,
  coalesce(bool_or(table_name = 'region_completeness'), false) as has_completeness_platform,
  coalesce(bool_or(table_name = 'region_continuous'), false) as has_continuous_platform,
  coalesce(bool_or(table_name = 'region_categorical'), false) as has_categorical_platform
  from information_schema.columns
  where table_schema = 'public' and column_name = 'platform'
    and table_name in ('region_snapshot', 'region_completeness', 'region_continuous', 'region_categorical') \gset

-- Changes exactly when the branch applies a migration: on a gated branch an
-- unchanged line means the migration never ran.
select 'drizzle.migrations', 'applied', count(*) from drizzle.__drizzle_migrations;

select 'users.status', status, count(*) from users group by status order by status;

select 'user_roles.role', r.name, count(*) from user_roles ur join roles r on r.id = ur.role_id
  group by r.name order by r.name;
\if :has_role_platform
select 'user_roles.role_platform', r.name || '/' || ur.platform, count(*)
  from user_roles ur join roles r on r.id = ur.role_id
  group by r.name, ur.platform order by r.name, ur.platform;
\endif

-- What the roles grant, not only who holds them: a migration that drops or
-- swaps a grant keeps every user_roles row, so only these lines show it (15c).
select 'roles', name, is_system::text from roles order by name;
select 'role_permissions.role', r.name, count(*) from role_permissions rp
  join roles r on r.id = rp.role_id group by r.name order by r.name;
select 'role_permissions', 'checksum',
  md5(string_agg(r.name || ':' || rp.permission_key, ',' order by r.name, rp.permission_key))
  from role_permissions rp join roles r on r.id = rp.role_id;

select 'species.active', active::text, count(*) from species group by active order by active;
select 'species.tree_flag', coalesce(tree_flag, '(null)'), count(*) from species
  group by tree_flag order by tree_flag nulls first;
\if :has_plant_type
select 'species.plant_type', plant_type || '/' || plant_type_status, count(*) from species
  group by plant_type, plant_type_status order by plant_type, plant_type_status;
\endif

select 'trait_records.origin', origin, count(*) from trait_records group by origin order by origin;
select 'record_annotations.kind', kind, count(*) from record_annotations group by kind order by kind;
select 'contests', 'all', count(*) from contests;
select 'contest_events.kind', kind, count(*) from contest_events group by kind order by kind;
select 'api_keys', 'unrevoked', count(*) from api_keys where revoked_at is null;
select 'audit_log', 'all', count(*) from audit_log;

-- The map snapshot (RFC-78 R12); plan 15f gives these tables a platform.
select 'region_snapshot', 'rows', count(*) from region_snapshot;
select 'region_completeness', 'rows', count(*) from region_completeness;
select 'region_continuous', 'rows', count(*) from region_continuous;
select 'region_categorical', 'rows', count(*) from region_categorical;
\if :has_snapshot_platform
select 'region_snapshot.platform', platform, count(*) from region_snapshot group by platform order by platform;
\endif
\if :has_completeness_platform
select 'region_completeness.platform', platform, count(*) from region_completeness group by platform order by platform;
\endif
\if :has_continuous_platform
select 'region_continuous.platform', platform, count(*) from region_continuous group by platform order by platform;
\endif
\if :has_categorical_platform
select 'region_categorical.platform', platform, count(*) from region_categorical group by platform order by platform;
\endif

-- The columns `records.csv` exports today (apps/api/src/dataset/export.ts,
-- recordsCsv), named one by one so a column a migration adds does not change
-- the checksum. Over every record, not one viewer's visible set: the
-- Visibility-dependent `contested` and `n_contests` are left out (the contest
-- counts above cover them). Hashed per row so the aggregate stays small.
select 'export.records', count(*), md5(string_agg(md5(x::text), '' order by x.id)) from (
  select r.id, r.record_code, f.order_name, f.name as family, g.name as genus,
    s.canonical_name, s.name_source, c.key as category, t.key as trait,
    coalesce(r.unit, t.unit) as unit, l.key as level,
    r.numeric_value, r.mean_value, r.median_value, r.min_value, r.max_value,
    r.sd_value, r.se_value, r.n, r.unit_status,
    coalesce(r.raw_value, case when r.harmonisation <> 'harmonised' then r.value_text end) as raw_value,
    (select string_agg(b.citation_key || ':' || b.kind || ':' || x.pos, '; ' order by x.pos, b.citation_key)
      from (select r.primary_reference_id as id, 0 as pos
            union all select r.secondary_reference_id, 1
            union all select rr.reference_id, 2 from record_references rr where rr.record_id = r.id) x
      join bibliographic_references b on b.id = x.id) as refs,
    r.origin, r.intent,
    (select y.record_code from trait_records y where y.id = r.responds_to_record_id) as responds_to,
    (select count(distinct a.actor_id) from record_annotations a
      where a.record_id = r.id and a.kind = 'confirm') as n_validations,
    r.source_folder, r.source_file, r.taxonomic_status,
    r.gbif_genus, r.gbif_family, r.taxon_order, r.summary_source, r.records_behind_row,
    r.outlier_flag, r.counts_as_evidence, r.evidence_code, r.also_reported_by,
    r.dispersal_phase, r.created_at, r.harmonisation
  from trait_records r
  join species s on s.id = r.species_id
  left join genera g on g.id = s.genus_id
  left join families f on f.id = g.family_id
  join traits t on t.id = r.trait_id
  join trait_categories c on c.key = t.category_key
  left join trait_levels l on l.id = r.level_id
) x;

-- Last, so no other section's diff context can print an id line.
-- Spec 2026-11-11 §2: an active user with no role would be locked out once a role
-- is required per platform. A nonzero list goes to the owner before 15c merges.
select 'users.active_without_role', u.id, '' from users u
  where u.status = 'active' and not exists (select 1 from user_roles ur where ur.user_id = u.id)
  order by u.id;
