# TreeRepro — Conceptual Development Plan

> **Status:** Living document — captures high-level goals and desired changes to the platform.
> Will be decomposed into RFCs and GitHub issues as each topic matures.
> Last updated: 2026-09-16

---

## 1. Project Purpose

TreeRepro is a scientific data-collection and verification platform for functional trait data of trees. The core dataset is a large, pre-harmonised assembly drawn from open sources (references, species, trait values). The platform's mission is to:

- **Share** this curated dataset with a community of specialist scientists (contributors).
- **Fill gaps**: allow contributors to manually enter new trait records for species where data is missing, strictly following standardised vocabularies.
- **Validate** existing records: contributors indicate whether they agree or disagree with a record (confirmation / dispute), without ever altering or deleting it. All contributions are strictly incremental — nothing is erased, everything is audited.
- **Export** a curated, accepted-value dataset once the curation process reaches sufficient coverage.

---

## 2. User Roles (Revised Design)

The current platform has a generic role system (admin + custom roles with permission combinations). The scientific workflow requires three clearly distinguished roles with different scope of data visibility and write permissions.

### 2.1 Administrator (1 person: Elisa Barreto)

Full control over the platform. Can:
- Import and export data.
- Manage all users, roles, and role assignments.
- Create and edit trait categories, trait keys, and standardised levels.
- Add or edit species, genera, families, and bibliographic references.
- Set accepted values per species/trait — **admin-only**.
- View all data with no restrictions (including inactive species and traits).
- Access all admin and curation pages.

### 2.2 Manager (small number, ~2–5)

A trusted science co-coordinator role, between admin and contributor. Can:
- Do everything a contributor can.
- View **all species and traits** — including inactive ones — with their active/inactive status clearly labelled. No plot-scoped home view.
- Manage the harmonisation queue and disputed records.
- **Cannot** set accepted values per species/trait — that is admin-only.
- **Cannot** import/export bulk data, create new trait keys or categories, or manage users and roles.

### 2.3 Contributor (~50 now, expandable)

The main user group: specialist scientists invited to validate and fill gaps. Can:
- Browse the species and trait catalog (only active species and traits; default view scoped to their assigned plots — see Section 3).
- View existing trait records for any active species.
- Confirm or dispute existing records.
- Add new trait records for traits that are already in the platform, strictly using active, standardised levels or numeric values in the declared unit. No free text.
- **Cannot** delete or alter any existing record, create new traits or levels, add new species, import or export data, or see the admin area.

> **Key principle:** Contributor activity is purely incremental. The dataset only grows; it is never overwritten.

---

## 3. Data Visibility Scoping

This is one of the most important design changes needed. Currently, all authenticated users see the same set of species and traits.

### 3.1 Trait Visibility

- Some traits are still under definition or are sensitive, and should not be exposed to the contributor community yet.
- We will use the existing **`active`** flag on the `traits` table to control this.
- **Active traits:** Visible to everyone. Contributors can see them, filter by them, and add new records for them.
- **Inactive traits:** Invisible to contributors. They do not appear in the catalog, filters, or species pages for contributors.
- **Admins and managers** can see all traits (active and inactive), with their status explicitly labelled, allowing them to prepare and review traits before "activating" them for the community.

### 3.2 Species Visibility — Two-Layer Model

Species visibility for contributors works on **two independent layers**.

#### Layer 1 — Active / Inactive Species (Hard Barrier, Contributors Only)

Some species in the database are not ready to be seen by contributors. This includes:
- Species from regions or continents not yet in scope for the current project phase.
- Species whose taxonomy or data quality has not yet been verified by the admin.
- Species reserved for a future phase.

Rules:
- **Inactive species are invisible to contributors only.** They do not appear in any list, search result, or species page for contributors.
- **Admins and managers can see all species**, including inactive ones, with their `active/inactive` status explicitly labelled in the interface.
- The admin can activate a species when ready, at which point it becomes visible to contributors.
- This is a **hard visibility barrier**, enforced at the API level, not just in the UI.

> **Implementation note:** The current `species` table has no `active` column. One must be added, analogous to the `active` flag on `traits` and `trait_levels`. `GET /api/species` would filter to active-only for contributors, but return all for admin/manager roles.

#### Layer 2 — Plot Assignment (Configurable Home Scope)

Researchers are recruited through specific **field plots** (each with a plot ID). Each plot has a defined species list.

- Each contributor is **assigned one or more plots** via their user profile.
- The species in those plots form their **"home scope"**: the default view shown on their dashboard and the species tab.
- **Admin Configuration:** The admin can set whether a contributor is strictly restricted to their plots or allowed to browse the entire active database.
  - If **unrestricted**, contributors can freely browse and contribute to any active species outside their plot. They will have a toggle **"Show species outside my plots"** on the species tab to expand to the full active dataset.
  - If **restricted**, contributors only ever see the species within their assigned plots (the toggle is hidden).
- Managers and admins see all species without a plot-scoped home view.

**New data model elements needed:**
- A `plots` table (`id`, `plot_id`, `name`, `description`, geographic location metadata).
- A `plot_species` join table (many plots can share species; one species can appear in multiple plots).
- A `user_plots` join table (contributors assigned to one or more plots).
- A configuration column on the `users` table (e.g., `restrict_to_assigned_plots` boolean).

> **Note:** The plot–species list is imported — see Section 9 (Data Import Requirements).

---

## 4. Workspace — Home Page

The workspace landing page (shown immediately after login) needs a brief, welcoming project overview. Exact text to be finalised, but the intent is:

> *TreeRepro is a collective data assembly of reproductive trait data for trees, covering traits across all reproductive stages — flower, fruits, and seeds. Its core data comes from open-source papers and data repositories spanning X studies from X different sources. It is shared here with a community of specialist scientists to fill gaps and validate existing records. For questions, contact [elisabpereira@gmail.com](mailto:elisabpereira@gmail.com).*

Beyond the description, the home page serves as a **personalised dashboard**:

**For contributors:**
- A summary card: "Your assigned species" (from their plot scope) with counts of pending validation tasks and missing records.
- Quick-access buttons: "Validate records", "Enter new data", "Browse species".
- "Top traits missing data in your plots" — ranked list to direct their effort.
- "Records awaiting your validation" — records in their scope with no confirmation yet.

**For admins/managers:**
- Dataset coverage summary (% of species × trait combinations with accepted values).
- Recent dispute queue and harmonisation queue status.

---

## 5. Data Section — Tab-by-Tab Redesign

### 5.1 Species Tab

#### 5.1.1 Scope Toggle (Plot vs. Full Dataset)

- Contributors see **only the species from their assigned plot(s)** by default.
- **If the user is unrestricted by the admin**, a clearly visible toggle/checkbox: **"Show species outside my plots"** expands to all active species.
- **If the user is restricted by the admin**, this toggle is hidden, and they cannot view species outside their plots.
- Managers and admins always see all species; no plot-scoped default.

#### 5.1.2 Filter Panel — Taxonomy Filters

The existing taxonomy filters are well-liked. Revised order:
1. **Species** — free-text search (keep as-is, loved)
2. **Genus** — autofill search (keep as-is, loved)
3. **Family** — drop-down menu (keep as-is)

All three can be combined.

#### 5.1.3 Filter Panel — Trait Filters (New)

A second filter group, combinable with taxonomy filters:
1. **Broad trait category** — drop-down (e.g., Dispersal, Fruit, Flower, Seed, …)
2. **Specific trait** — drop-down, updates dynamically based on selected category

Selecting a trait filter narrows the species list to those that have at least one record for that trait (or, in "missing data" mode — see Section 7 — those that are *missing* it).

#### 5.1.4 Filter Panel — Geographic Filters (Planned)

A third filter group, to be implemented once the species distribution data is available:
- **Country** and/or **State / Region** level.
- Filtering is based on **species presence per country or state**.
- The data source and geographic resolution will be confirmed when the distribution dataset is prepared for import (see Section 9.4).

#### 5.1.5 Breadcrumb Navigation

Always reflects the full navigation path:
- Species list: `Data > Species`
- Species detail: `Data > Species > Anathallis funerea`

#### 5.1.6 Species Synonyms and Common Names

Species are canonically named under WCVP, but researchers know them by many names. The platform should:
- Maintain a list of **synonyms and common names** per species, beyond the existing GBIF alternative names.
- Allow the species free-text search to match on any synonym or common name, **with strict priority**: the search must look for an exact match on the canonical species name first. Only if there is no exact canonical match should it search through the synonyms and common names.
- Display the matched alternative name clearly when a species is found via a synonym (e.g., *Canonical Name* (found as: *Synonym*)).
- The admin imports a synonyms table (to be provided by Elisa). Minimum format: `wcvp_canonical_name`, `synonym_or_common_name`, `name_type` (e.g., `synonym`, `common_en`, `common_pt`), `source`.

#### 5.1.7 "Add entries for another trait" Button

The orange "Add value" button is renamed to **"Add entries for another trait"**. The form contains:
1. Drop-down: **Broad trait category**
2. Drop-down: **Specific trait** (updates based on category)
3. **Value field** — level selector (categorical) or numeric input (quantitative).
4. **Primary reference** — DOI input. If left blank, automatically recorded as "Personal observation". A `?` tooltip explains: *"If this comes from your own field work or expert knowledge, leave blank. Otherwise, provide a DOI."*
5. **Add another reference** button — multiple references allowed per entry.
6. Logged-in user **automatically attributed** — no manual user field.

Fields **removed** from current form: Secondary reference, "As written in the source", Note.

#### 5.1.8 Trait Description Tooltips

Each trait row in the species detail panel shows a **`?` icon**. Hovering or clicking it reveals the trait's description from the trait dictionary.

#### 5.1.9 Missing Records Filter / Order

A filter or toggle to highlight or filter species with missing data for a selected trait (details in Section 7).

---

### 5.2 Traits Tab

#### 5.2.1 Filter Panel

1. **Broad trait category** — drop-down
2. **Specific trait** — drop-down, updates based on category
3. **Value type** — `Categorical` / `Continuous (quantitative)`

All three combinable.

#### 5.2.2 Trait Cards / List

Each trait entry shows:
- Trait name and description (keep as-is).
- Unit for quantitative traits (keep as-is).
- **Active / Inactive status** — shown only to admins and managers; hidden from contributors.

#### 5.2.3 Levels Display

The "Show levels" button currently expands a long vertical list. Desired change: levels displayed as **horizontal chips / tags in rows**, saving screen space.

#### 5.2.4 Trait Detail — Species with Data (Clicking a Trait)

Clicking a trait opens a **trait detail view** showing:
- All species for which at least one record exists for that trait.
- The accepted value (if set) and its source reference.
- A summary of record counts per level (categorical) or value range (quantitative).

**Implementation options (to decide):**
- **Option A:** Opens the **Species tab pre-filtered** to that trait. Simpler; reuses existing UI.
- **Option B:** Opens a dedicated **Trait detail page** (`Data > Traits > [Category] > [Trait]`). More powerful; requires new routes and components.

> This should mirror the behaviour already loved in the References tab, where clicking a reference navigates to the associated species and records.

#### 5.2.5 Breadcrumb Navigation

- `Data > Traits`
- `Data > Traits > Dispersal`
- `Data > Traits > Dispersal > diaspore_color`

---

### 5.3 References Tab

#### 5.3.1 Enriched Reference Data (Import)

The current references table stores only a short key. The enriched import (Section 9.8) adds:
- **Short citation** (e.g., `Alfaro et al. (2023)`) — primary displayed label.
- **Full citation** — shown on expansion or hover.
- **DOI** — clickable hyperlink.
- Existing `primary_reference` / `secondary_reference` role columns kept.
- Year embedded in the short citation string; no separate year column.

#### 5.3.2 Filters

Filter by **broad trait category** and/or **specific trait** — to see which references provide data for which traits.

#### 5.3.3 Clicking a Reference (Keep and Extend)

The behaviour of clicking a reference to navigate to the associated species and their records is **loved and must be preserved**. This is the exact model to replicate for the Traits tab (Section 5.2.4).

---

### 5.4 My Contributions Tab (New)

A new tab under Data, visible to the logged-in user:
- Lists all records manually entered by that user.
- Lists all annotations (confirmations / disputes / complements / contests) made by that user.
- Filterable by trait, species, date range, and contribution type.
- Shows current status of each record (harmonised, disputed, accepted, withdrawn).
- Allows contributors to review the impact and status of all their work in one place.
- Admins/managers can view any user's contribution list.

---

## 6. Contributing Data — Redesigned Workflow

The current curation UI (confirm / dispute / add value) needs a full UX overhaul.

### 6.1 Two Clear Actions per Record

For every existing record in the species detail view, a contributor sees exactly **two action buttons**:

| Button | Colour | Label | Meaning |
|---|---|---|---|
| Validate | 🟢 Green | ✓ Validate | "I agree with this record as-is." |
| Add different record | 🔴 Red | + Add different record | "I have a different or additional value." |

Both buttons have a short tooltip on hover and a `?` icon for a longer explanation on click.

### 6.2 Green Button — Validation

- Records a **confirmation annotation** attributed to the logged-in user.
- Optional: attach a supporting DOI (validated — Section 6.4).
- No note field, no secondary reference, no "as written in source".
- Record stays unchanged; only the annotation is added.

### 6.3 Red Button — Contesting or Complementing (Two-Step Form)

#### Step 1 — Declare Intent (all value fields disabled until completed)

The contributor selects one option via **radio buttons**:

| Choice | Meaning | Example |
|---|---|---|
| **Contest** | "I believe the existing value is wrong; mine should replace it." | Existing: `biotic`; New: `abiotic` — the mode is abiotic, not biotic. |
| **Complement** | "The existing value is also correct; I am adding another observation." | Existing: `biotic`; New: `abiotic` — it can be both. |

> Intent is stored on the new record and surfaced to the admin in the curation queue, so they can distinguish replacement candidates from additive observations.

#### Step 2 — Enter the New Record (unlocks after Step 1)

- **Trait value** — level selector (categorical) or numeric input (quantitative), from active levels only.
- **Primary reference** — DOI input. If blank, recorded as "Personal observation". `?` tooltip explains.
- **Add another reference** button — multiple references allowed.
- Logged-in user automatically attributed.

Fields **not included**: Secondary reference, "As written in the source", Note.

### 6.4 DOI Validity Check

When a DOI is entered, the platform checks:
1. **Format** — must match the standard pattern `10.XXXX/...`.
2. **Resolution** — the DOI must resolve against `https://doi.org/<doi>`.

Shown as a real-time indicator on blur:
- ✅ DOI resolved successfully.
- ❌ DOI not found or malformed — blocks submission (or strong warning).
- No DOI entered → "Personal observation" path; no check performed.

> **Technical note:** Requires a backend proxy endpoint (e.g., `GET /api/references/check-doi?doi=...`) to avoid browser CORS restrictions.

### 6.5 Trait Description Tooltip in Contributing Forms

Wherever a trait is shown in contributing forms, a `?` icon displays the trait description from the dictionary, so contributors always know exactly what they are recording.

---

## 7. Missing Records — Guided Contribution System

Multiple complementary mechanisms to help contributors find where they are most needed:

### 7.1 Species-Level: "Missing traits" Toggle

On a species detail page, a toggle **"Show traits with no data"** displays traits without any record yet, in an empty state that invites the contributor to add the first entry.

### 7.2 Trait-Level: Species Missing That Trait

From the trait detail view (Section 5.2.4), a filter or tab:
- "Species with data for this trait" (default)
- "Species missing data for this trait" — all active species for which no record exists for this trait.

This is the primary tool for trait-expert contributors.

### 7.3 Dashboard: Priority Queue

On the home page:
- "Top traits missing data in your plots" — ranked by how many of the contributor's assigned species lack records.
- "Records awaiting your validation" — records in the contributor's scope not yet confirmed by anyone.

### 7.4 Species List: Order by Completeness

In `Data > Species`, an option to order by completeness (most incomplete first) or a filter: "Show only species missing data for [selected trait]."

> Exact implementation will be refined once the plots and coverage metrics data model is in place.

---

## 8. Key Principles (Non-Negotiable)

1. **Incremental-only** — No record, annotation, or accepted value is ever deleted. The database is an append-only ledger of scientific contributions.
2. **Controlled vocabulary** — All categorical values must match an active, standardised level. No free text enters a trait value.
3. **Separation of roles** — Contributors never gain admin capabilities. Escalation always goes through the admin.
4. **Data privacy** — No dataset file (raw or processed) is ever committed to GitHub or shared outside the platform. Data lives only in the local/production database.
5. **Auditability** — Every write carries actor, time, and reference. The provenance of every accepted value must be traceable to a bibliographic source.

---

## 9. Data Import Requirements

All datasets must be loaded in the order listed. Some already have an import mechanism; others need to be built.

### 9.1 Trait Dictionary ✅ Already Importable

**File:** `apps/api/seed/trait-dictionary.csv`
**Columns:** `final_standard_trait`, `broad_category`, `trait_value_type`, `standard_unit`, `description`, `harmonised_levels`
**Command:** `pnpm seed:traits` — idempotent, safe to re-run.

**Missing capability:** No `active` column yet. One should be added so traits can be loaded in a deactivated state on import.

---

### 9.2 Raw Trait Records (Core Dataset) ✅ Already Importable

**File:** `data/sample_data.csv` — **never committed to GitHub**
**Command:** `pnpm import:records --file <csv> [--run-by <email>]`
**What it does:** Creates species, genera, families, references, and trait records in bulk. Unmatched records go to the harmonisation queue.

---

### 9.3 Species Active / Inactive Status 🔴 Not Yet Importable

**Purpose:** Mark which species are visible to contributors.
**Needs:** A new `active` column on the `species` table + an import command or supplementary CSV column.
**Minimum columns:** `wcvp_species`, `active` (`true` / `false`)

---

### 9.4 Species Distribution by Country / State 🔴 Not Yet Importable

**Purpose:** Power geographic filtering in the species tab (Section 5.1.4).
**Approach:** A CSV mapping each species to the countries and/or states where it is present.
**Minimum columns:** `wcvp_species`, `country`, `state` (optional)
**Note:** Data source and resolution to be confirmed.

---

### 9.5 Plot Definitions and Plot–Species Lists 🔴 Not Yet Importable

**Purpose:** Define field plots and link them to their species lists, feeding the contributor home scope.
**Needs:** New `plots`, `plot_species`, and `user_plots` tables.

| File | Columns | Purpose |
|---|---|---|
| `plots.csv` | `plot_id`, `name`, `description`, `latitude`, `longitude`, `country`, `biome` | Defines each field plot |
| `plot_species.csv` | `plot_id`, `wcvp_species` | Maps species to plots |

---

### 9.6 Plot–User Assignment & Settings 🔴 Not Yet Importable

**Purpose:** Link contributors to their assigned plots and configure their access scope.
**Columns (User plots):** `user_email`, `plot_id`
**Columns (User settings):** `user_email`, `restrict_to_assigned_plots` (boolean)
**Notes:** Multiple plots per contributor allowed. The restriction setting dictates if they can toggle to see species outside their plots. Manageable via the admin UI. Requires users to have active accounts.

---

### 9.7 Species Synonyms and Common Names 🔴 Not Yet Importable

**Purpose:** Enable species search by synonym or common name (Section 5.1.6).
**Minimum columns:** `wcvp_canonical_name`, `synonym_or_common_name`, `name_type` (e.g., `synonym`, `common_en`, `common_pt`), `source`
**To be provided by Elisa.**

---

### 9.8 Bibliographic References — Enriched Metadata 🔴 Partially Importable

**Current state:** References created during raw import store only the short key.
**Missing:** Full citation metadata for display to contributors.
**Proposed columns:** `reference_key`, `short_citation`, `full_citation`, `doi`, `url`

---

### Summary Table

| # | Dataset | Status | Priority |
|---|---|---|---|
| 9.1 | Trait dictionary | ✅ Works | Done |
| 9.2 | Raw trait records | ✅ Works | Done |
| 9.3 | Species active/inactive status | 🔴 Needs new column + import | High |
| 9.4 | Species distribution by country/state | 🔴 Needs new table + import | Medium |
| 9.5 | Plot definitions + plot–species | 🔴 Needs new tables + import | High |
| 9.6 | Plot–user assignment | 🔴 Needs new table + admin UI | High |
| 9.7 | Species synonyms and common names | 🔴 Needs import + search update | Medium |
| 9.8 | Enriched bibliographic references | 🔴 Needs enriched import | Medium |

---

## 10. Further Topics (To Be Explored)

- **10.1 Notification system** — alerting admins and managers when disputes are raised or significant new entries are submitted.
- **10.2 Data export controls** — who can export, in what format, and whether contributors can download a filtered view of accepted values.
- **10.3 Onboarding and in-platform instructions** — guided tutorial or help pages for new contributors explaining the workflow, vocabulary, and contribution types.
- **10.4 External taxonomy lookups** — querying WCVP / GBIF automatically when a contributor proposes a species not yet in the catalog.
- **10.5 Coverage metrics dashboard** — for admins/managers: % of species × trait cells filled, filterable by family, trait category, or contributor group.
- **10.6 Admin Page Requirements** — detailed specification of new tools, queues, and settings required for administrators and managers to manage users, import datasets, review disputes, and monitor platform health.

---

## 11. Next Steps

1. Prioritise the features above into **short-term** (must-have for contributor launch), **medium-term** (important but not blocking), and **long-term** (desirable).
2. Translate each section into formal **GitHub Issues**, grouped by component and linked to existing RFCs where applicable.
3. For items that change the existing data model, draft **updated or new RFCs** before any code is written.
4. Collect and prepare all import files listed in Section 9 (species status, plots, user assignments, synonyms, references).

---

*This document is local only and is not committed to GitHub.*
