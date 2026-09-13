# TreeRepro — Workspace UI Pattern

**Date:** 2026-09-13
**Status:** implemented
**Scope:** the screen pattern and the element standard of every page behind sign-in (`/app/*`). Extends the visual identity (`2026-09-12-visual-identity.md`) and the UI kit of the web UI design (`2026-09-13-ui-design.md` §2). Mockup: the "TreeRepro Workspace UI" design canvas (session artifact): a list page, a detail page, a form page and the elements sheet.

## 1. Decisions summary

| Topic | Decision |
|---|---|
| Brief | The workspace gets one pattern for every screen, the tree emblem in the chrome, and a larger type scale for easy reading; nothing moves (RFC-13 R7 — motion stays on the landing page). |
| Shell | Dark sidebar 264px (`canopy-900`): emblem 40px + "TreeRepro / Workspace" wordmark, then grouped entries — ungrouped (Workspace), **Data** (Species, Traits, References, Imports), **Admin** (Users, Roles, Audit; `admin.access`), then Settings without a heading. Items are 44px with a 20px stroke icon; the current one is white on white/10 with the icon in `pollen-400`. Top bar 64px, white: breadcrumb (group › entry) on the left, user block (initials, name, email) and a small "Sign out" on the right. Content padding 32/40. |
| Current entry | `currentEntry(pathname)` in `nav.ts`: the longest `to` that is the path or a prefix at a segment boundary. It drives both `aria-current` on the links (with `activeOptions={{ exact: true }}`, so the router never disagrees) and the breadcrumb. |
| Type scale | Seven named steps in `styles.css` (`@theme`), used as `text-<step>`: `title` 32/1.2 · `section` 22/1.3 · `card` 18/1.35 · `body` 16/1.5 · `cell` 15/1.45 · `meta` 14/1.45 · `label` 13/1.4. Nothing in the workspace goes below `label`. Headings, buttons and the wordmark stay in Sora; everything else Manrope. |
| Controls | One height, 44px (`h-11`), radius 10px, 16px text; focus is a `pollen-500` border with a 3px halo at 25%; invalid is red with the message under the control. `Select` joins the kit with the same dress. Buttons are pills with Sora 15px semibold; `size="sm"` (36px, 14px) inside table rows and the top bar. |
| Emblem | `components/ui/Emblem.tsx` is the still tree-in-fruit SVG with `useId`-scoped gradients; the landing `TreeEmblem` wraps it in its motion. |
| Sections | `Section` (kit): heading and description in a 280px left column, content on the right, hairline above — the settings page is four of them. |
| Feedback | `Alert` gains a leading icon; `Badge` is 26px tall at 13px; `Dialog` and `Drawer` titles are `section` size with a 36px round close button. |
| Icons | `components/ui/Icon.tsx`: inline stroke paths on a 20px grid, 1.75 stroke, round caps; decorative (`aria-hidden`), the control carries the name. No emoji, no icon font. |
| Colour | Unchanged: the identity tokens only. |

## 2. Type and size map (old → new)

| Element | Before | After |
|---|---|---|
| Body copy, nav items | 14px | 16px (`text-body`) |
| Meta / muted, hints, errors | 12px | 14px (`text-meta`) |
| Field labels, table heads, badges, group labels | 12px | 13px (`text-label`) |
| Inputs, selects | 40px / 15px | 44px / 16px |
| Buttons | 40px / 14px | 44px / 15px (`sm`: 36px / 14px) |
| Page title (h1) | 24px | 32px (`text-title`) |
| Section heading (h2) | 18px | 22px (`text-section`) |
| Card title (h3) | 16px | 18px (`text-card`) |
| Table cells | 14px | 15px (`text-cell`), padding 18/14 |
| Sidebar / top bar | 240px / 56px | 264px / 64px |

## 3. Files

| File | Role |
|---|---|
| `apps/web/src/styles.css` | the seven `--text-*` steps |
| `apps/web/src/components/ui/Emblem.tsx`, `Icon.tsx`, `Select.tsx`, `Section.tsx` | new kit members |
| `apps/web/src/components/ui/{Button,Input,Field,Badge,Alert,Table,PageHeader,EmptyState,Dialog,Drawer}.tsx` | resized to the scale |
| `apps/web/src/components/shell/nav.ts` | `icon`, `section`, `NAV_SECTIONS`, `currentEntry` |
| `apps/web/src/components/shell/AppShell.tsx` | the shell above |
| `apps/web/src/components/settings/*Section.tsx` | on `Section` |
| `apps/web/src/components/dataset/*`, `apps/web/src/pages/**` | class renames to the scale; row buttons `sm` |

## 4. Out of scope

Public pages (landing, invite, password recovery) keep their own sizes; a dark theme; responsive collapse of the sidebar below tablet width.
