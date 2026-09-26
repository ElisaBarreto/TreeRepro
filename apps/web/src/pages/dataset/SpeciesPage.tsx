import { useQuery } from '@tanstack/react-query';
import type { Species, TraitRef } from '@treerepro/contracts';
import { type ReactNode, useState } from 'react';
import { annotateRecord, type ValidateBody, validateLevel } from '../../api/curation.ts';
import {
  datasetKeys,
  fetchDictionary,
  fetchSpecies,
  fetchSpeciesTraits,
} from '../../api/dataset.ts';
import { AddNameDialog } from '../../components/catalog/AddNameDialog.tsx';
import { SpeciesDialog } from '../../components/catalog/SpeciesDialog.tsx';
import { AddEntriesDialog, type RespondTo } from '../../components/curation/AddEntriesDialog.tsx';
import { ValidateDialog } from '../../components/curation/ValidateDialog.tsx';
import { EmptyTraitCard } from '../../components/dataset/EmptyTraitCard.tsx';
import { RecordDrawer } from '../../components/dataset/RecordDrawer.tsx';
import { TraitCard } from '../../components/dataset/TraitCard.tsx';
import { TraitPanel } from '../../components/dataset/TraitPanel.tsx';
import { useBreadcrumb } from '../../components/shell/Breadcrumb.tsx';
import {
  Alert,
  Badge,
  Button,
  Chip,
  EmptyState,
  Icon,
  PageHeader,
} from '../../components/ui/index.ts';
import { detailErrorMessage } from '../../lib/errors.ts';
import { hasPermission, useMe } from '../../lib/session.ts';

function errorMessage(error: unknown): string {
  return detailErrorMessage(error, 'SPECIES_NOT_FOUND', 'This species does not exist.');
}

// Family › Genus; a missing family (or both) reads as RFC-60 R3's term.
function taxonomyLine(species: Species): string {
  return [species.family?.name ?? 'unresolved taxonomy', species.genus?.name]
    .filter((part): part is string => part !== undefined)
    .join(' › ');
}

// The three decisions every level and quantitative record offers (RFC-70 R9);
// the icons are decorative, the words carry them.
function Legend() {
  return (
    <ul aria-label="Legend" className="flex flex-wrap gap-x-6 gap-y-1 text-body text-canopy-900">
      <li className="inline-flex items-center gap-1.5">
        <Icon name="thumbsUp" size={16} /> Validate
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Icon name="thumbsDown" size={16} /> Contest
      </li>
      <li className="inline-flex items-center gap-1.5">
        <Icon name="plus" size={16} /> Complement
      </li>
    </ul>
  );
}

function SpeciesHeader({
  species,
  missing,
  onMissingChange,
  actions,
}: {
  species: Species;
  missing: boolean;
  onMissingChange: (missing: boolean) => void;
  actions?: ReactNode;
}) {
  const me = useMe();
  const canManagePlots = hasPermission(me, 'plots.manage');
  const gbifNames = species.names.filter((n) => n.nameType === 'gbif');
  const synonyms = species.names.filter((n) => n.nameType === 'synonym');
  const commonNames = species.names.filter((n) => n.nameType === 'common');
  return (
    <PageHeader
      title={
        <span className="flex flex-wrap items-center gap-3">
          <em>{species.canonicalName}</em>
          {species.unresolvedTaxon ? <Badge tone="amber">unresolved taxon</Badge> : null}
          {species.active ? null : <Badge tone="neutral">inactive</Badge>}
        </span>
      }
      description={
        <>
          <span className="block">{taxonomyLine(species)}</span>
          {species.plots && species.plots.length > 0 ? (
            <span className="block">
              {canManagePlots ? 'Plots: ' : 'In your plots: '}
              {species.plots.map((p) => p.name).join(', ')}
            </span>
          ) : null}
          {gbifNames.length > 0 ? (
            <span className="block">
              Also known as{' '}
              <span className="italic">{gbifNames.map((n) => n.name).join(', ')}</span>
            </span>
          ) : null}
          {synonyms.length > 0 ? (
            <span className="block">
              Synonyms <span className="italic">{synonyms.map((n) => n.name).join(', ')}</span>
            </span>
          ) : null}
          {commonNames.length > 0 ? (
            <span className="flex flex-wrap items-center gap-2">
              Common names
              {commonNames.map((n) => (
                <span key={n.name} className="inline-flex items-center gap-1.5">
                  <em>{n.name}</em>
                  {n.language ? <Chip>{n.language}</Chip> : null}
                </span>
              ))}
            </span>
          ) : null}
          <span className="block">
            {species.recordCount} {species.recordCount === 1 ? 'record' : 'records'} ·{' '}
            {species.traitCount} {species.traitCount === 1 ? 'trait' : 'traits'}
          </span>
        </>
      }
      actions={
        <>
          <label className="flex h-11 items-center gap-2.5 text-body text-canopy-900">
            <input
              type="checkbox"
              className="size-5 accent-canopy-700"
              checked={missing}
              onChange={(event) => onMissingChange(event.target.checked)}
            />
            Show traits with no data
          </label>
          {actions}
        </>
      }
    />
  );
}

/**
 * One species: its taxonomy and names, grouped by type as "Also known as"
 * (gbif), "Synonyms" and "Common names" (the last with a language chip per
 * name; an empty group renders nothing) (RFC-60 R4, R7), and, per category in
 * dictionary order, a card per trait with the summary the API computed
 * (RFC-63 R10). A legend at the top names the three decisions (RFC-70 R9).
 * With `records.annotate`, each level of a categorical card and each row of a
 * quantitative panel carries Validate, which opens the validation question
 * and validates every record of the level or the row's one record (RFC-70
 * R4). With `records.create`, they carry Contest and Complement, which open
 * the entry dialog: Contest already chosen, Complement with only the
 * responded level or record set, so the user still picks the intent; the
 * card's "+" opens it unanswered, and it asks Contest or Complement first
 * whenever records exist (RFC-70 R9, R10). A card opens the trait's records in a panel; a row there
 * opens the record's detail in a drawer on top — the same drawer the route's
 * `record` search param opens on mount, the digest e-mail's deep link
 * (RFC-74 R5). With `records.create`, an
 * "Add entries for another trait" button in the header and one on each
 * trait card open the add-entries dialog (RFC-70 R1) — the header button
 * without a fixed trait, a card's button with its trait; the first record
 * the API created opens in the drawer (RFC-70 R3). Both fetches fail
 * together for an unknown id, so one alert covers the page. The open panel
 * is remembered by trait id and its summary read from the traits query on
 * every render, so it follows every write that invalidates the summary
 * instead of freezing at the click; a trait that leaves the summary closes
 * its panel. With `taxa.manage`, "Edit
 * species" and "Add name" in the header open the species editor and the
 * alternative-name dialog (RFC-60 R9); their write invalidates the species
 * detail, so the header re-renders from the refetch. An inactive species is
 * flagged after the unresolved-taxon badge (RFC-33 R7). The header's "Show
 * traits with no data" checkbox is owned by the route's `missing` search
 * param (RFC-70 R7): checking it asks the traits query for
 * `includeMissing`, which the query key carries too, so the two answers
 * never share a cache entry. A trait the summary reports with no records
 * (`recordCount === 0`, only possible with the flag on) renders as an
 * `EmptyTraitCard` instead of `TraitCard` — nothing to open, no panel — with
 * "Add the first entry" wired to the same add-entries dialog as a card's own
 * button. The dictionary loads alongside the traits, purely for the `?`
 * descriptions the cards show (RFC-13 R11); its own loading or error state
 * blocks nothing, a card with no description just shows none. The page
 * registers the canonical name as the shell's trailing crumb, so the
 * breadcrumb reads `Data › Species › <canonical name>` in italics once the
 * species resolved, and nothing extra while it loads or fails (RFC-13 R3).
 * @rfc RFC-13 R2, R3, R4
 * @rfc RFC-60 R4, R7, R9
 * @rfc RFC-33 R7
 * @rfc RFC-63 R10
 * @rfc RFC-65 R1
 * @rfc RFC-70 R1, R3, R7
 * @rfc RFC-70 R4, R9, R10
 * @rfc RFC-13 R11
 * @rfc RFC-74 R5
 */
export function SpeciesPage({
  id,
  missing,
  onMissingChange,
  initialRecordId,
}: {
  id: string;
  missing: boolean;
  onMissingChange: (missing: boolean) => void;
  /**
   * The `record` search param (RFC-74 R5): the digest e-mail's deep link.
   * Seeds the drawer's initial state only — opened this way, the drawer
   * still closes and reopens exactly like one clicked from a row.
   */
  initialRecordId?: string;
}) {
  const me = useMe();
  const canAdd = hasPermission(me, 'records.create');
  const canAnnotate = hasPermission(me, 'records.annotate');
  const canManageTaxa = hasPermission(me, 'taxa.manage');
  const species = useQuery({
    queryKey: datasetKeys.speciesDetail(id),
    queryFn: () => fetchSpecies(id),
  });
  const traits = useQuery({
    queryKey: datasetKeys.speciesTraits(id, missing),
    queryFn: () => fetchSpeciesTraits(id, { includeMissing: missing }),
  });
  const dictionary = useQuery({
    queryKey: datasetKeys.dictionary(),
    queryFn: () => fetchDictionary(),
  });
  useBreadcrumb(species.data ? [{ label: <em>{species.data.canonicalName}</em> }] : []);
  const [openTraitId, setOpenTraitId] = useState<string | null>(null);
  const openTrait =
    openTraitId === null
      ? undefined
      : traits.data?.flatMap((c) => c.traits).find((t) => t.trait.id === openTraitId);
  // The trait left the summary (a refetch no longer lists it): forget it
  // during this render so a later summary cannot reopen the panel unasked.
  if (openTraitId !== null && traits.data && !openTrait) setOpenTraitId(null);
  const [openRecord, setOpenRecord] = useState<string | null>(initialRecordId ?? null);
  const [adding, setAdding] = useState<{ trait: TraitRef | null; respondTo?: RespondTo } | null>(
    null,
  );
  const [validating, setValidating] = useState<{
    subject: string;
    write: (body: ValidateBody) => Promise<unknown>;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [addingName, setAddingName] = useState(false);
  const error = species.error ?? traits.error;

  return (
    <>
      {species.data ? (
        <SpeciesHeader
          species={species.data}
          missing={missing}
          onMissingChange={onMissingChange}
          actions={
            canAdd || canManageTaxa ? (
              <>
                {canAdd ? (
                  <Button onClick={() => setAdding({ trait: null })}>
                    Add entries for another trait
                  </Button>
                ) : null}
                {canManageTaxa ? (
                  <>
                    <Button variant="secondary" onClick={() => setEditing(true)}>
                      Edit species
                    </Button>
                    <Button variant="secondary" onClick={() => setAddingName(true)}>
                      Add name
                    </Button>
                  </>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : (
        <PageHeader title="Species" />
      )}
      <div className="flex flex-col gap-8">
        {species.isSuccess ? <Legend /> : null}
        {error ? <Alert tone="error">{errorMessage(error)}</Alert> : null}
        {!error && (species.isPending || traits.isPending) ? (
          <p className="text-body text-mist-500">Loading…</p>
        ) : null}
        {species.isSuccess && traits.data && traits.data.length === 0 ? (
          <EmptyState title="No trait records for this species yet." />
        ) : null}
        {species.isSuccess &&
          traits.data?.map((category) => (
            <section key={category.category.key} className="flex flex-col gap-3">
              <h2 className="font-display text-section font-semibold text-canopy-950">
                {category.category.label}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {category.traits.map((summary) =>
                  summary.recordCount === 0 ? (
                    <EmptyTraitCard
                      key={summary.trait.id}
                      summary={summary}
                      dictionary={dictionary.data}
                      onAdd={canAdd ? () => setAdding({ trait: summary.trait }) : undefined}
                    />
                  ) : (
                    <TraitCard
                      key={summary.trait.id}
                      summary={summary}
                      dictionary={dictionary.data}
                      onOpen={() => setOpenTraitId(summary.trait.id)}
                      onAdd={canAdd ? () => setAdding({ trait: summary.trait }) : undefined}
                      onValidateLevel={
                        canAnnotate
                          ? (level) =>
                              setValidating({
                                subject: level.key,
                                write: (body) =>
                                  validateLevel(id, summary.trait.id, level.levelId, body),
                              })
                          : undefined
                      }
                      onRespondLevel={
                        canAdd
                          ? (level, intent) =>
                              setAdding({
                                trait: summary.trait,
                                // ＋ leaves the intent to the user (RFC-70 R9).
                                respondTo:
                                  intent === 'contest'
                                    ? { intent, levelId: level.levelId }
                                    : { levelId: level.levelId },
                              })
                          : undefined
                      }
                    />
                  ),
                )}
              </div>
            </section>
          ))}
      </div>
      {openTrait ? (
        <TraitPanel
          speciesId={id}
          summary={openTrait}
          onClose={() => setOpenTraitId(null)}
          onSelectRecord={setOpenRecord}
          isOwnRecord={(record) => record.createdBy?.id === me.user.id}
          onValidateRecord={
            canAnnotate
              ? (record) =>
                  setValidating({
                    subject: record.recordCode,
                    write: (body) => annotateRecord(record.id, { kind: 'confirm', ...body }),
                  })
              : undefined
          }
          onRespondRecord={
            canAdd
              ? (record, intent) =>
                  setAdding({
                    trait: record.trait,
                    respondTo:
                      intent === 'contest'
                        ? { intent, recordId: record.id }
                        : { recordId: record.id },
                  })
              : undefined
          }
        />
      ) : null}
      <RecordDrawer
        recordId={openRecord}
        onClose={() => setOpenRecord(null)}
        onOpenRecord={setOpenRecord}
      />
      {adding ? (
        <AddEntriesDialog
          speciesId={id}
          initialTrait={adding.trait}
          respondTo={adding.respondTo}
          onClose={() => setAdding(null)}
          onCreated={(result) => {
            setAdding(null);
            const [first] = result.created;
            if (first) setOpenRecord(first.id);
          }}
          onOpenRecord={(recordId) => {
            setAdding(null);
            setOpenRecord(recordId);
          }}
        />
      ) : null}
      {validating ? (
        <ValidateDialog
          subject={validating.subject}
          speciesId={id}
          write={validating.write}
          onClose={() => setValidating(null)}
        />
      ) : null}
      {editing && species.data ? (
        <SpeciesDialog
          species={species.data}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
      {addingName && species.data ? (
        <AddNameDialog
          species={species.data}
          onClose={() => setAddingName(false)}
          onSaved={() => setAddingName(false)}
        />
      ) : null}
    </>
  );
}
