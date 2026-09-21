# RFC-13 — Presentation layer

| Field | Value |
|---|---|
| Status | accepted |
| Category | platform |
| Supersedes | — |

## Context

`apps/web` is a display layer over the API (RFC-10 R3). These rules say how it routes, how it learns who the visitor is and what they may do, how it talks to the API, and what the production Content-Security-Policy allows it to do. Components cite these rules instead of the architecture rule they used to cite.

## Rules

- **R1** The web app contains no business rules and reaches the API only through `apiFetch` (`apps/web/src/api/client.ts`); every request and response type comes from `packages/contracts`. Business decisions (who may do what, what is valid) are answered by the API; the web app only reflects them. `apiFetch` takes the contracts schema of the response it expects and returns only what that schema parses — never a cast — so a fetcher cannot claim a shape the API does not send, and neither can a test fixture that stands in for the API, which the same parse checks. A request that reads nothing still names its answer (`okStatusSchema`, RFC-22 R9). A body the schema refuses is an `ApiError` with code `RESPONSE_INVALID`, the response's status and the failing paths as `details`, which a page shows through its ordinary error path.
- **R2** Routes. Public: `/` (sign-in, the landing page), `/invite/$token`, `/forgot-password`, `/reset-password/$token`. Authenticated, under the `/app` layout route: `/app`, `/app/settings`, and the areas later RFCs add (`/app/admin/*` in RFC-13's plan 05b including `/app/admin/plots` and `/app/admin/plots/$id` in RFC-67, dataset pages in RFC-6x including `/app/traits/$id` in RFC-62, `/app/contributions` in RFC-71, `/app/curation/coverage` in RFC-69 R5-R7, `/app/help` and `/app/help/$topic` in RFC-73, `/app/curation/proposals` in RFC-75, `/app/admin/health` in RFC-52). The `/app` layout resolves `GET /api/auth/me` before rendering and redirects to `/` when it fails; `/` redirects a visitor with a live session to `/app`.
- **R3** Navigation entries and action buttons render only when `me.permissions` holds the permission the target route or API call requires (`hasPermission`); `admin.access` gates the Admin section of the navigation and the `/app/admin` layout, which shows "You do not have permission to open this area." without redirecting. This is presentation only: the API is the authority (RFC-32 R4). The breadcrumb reads `Group › Entry › crumbs…`, where the trailing crumbs are registered by the page through `useBreadcrumb`; the last crumb is text, the others link.
- **R4** An `AUTH_UNAUTHENTICATED` answer (HTTP 401) to any call made under `/app` clears the session state (the `me` query) and returns to `/`; other 401 codes (`AUTH_INVALID_CREDENTIALS`, `AUTH_TOTP_INVALID`) are form errors shown where the action was attempted; a 403 answer is shown where the action was attempted as "You do not have permission to do this." There are no global toasts.
- **R5** Content-Security-Policy: no `style` attributes in markup and no `<style>`/`<link>` injection by libraries, no third-party scripts, styles or fonts. Styling is Tailwind utility classes and the tokens of `apps/web/src/styles.css`; CSSOM property assignment (React's `style` prop, a canvas library) is not blocked by the CSP but is avoided. The end-to-end suite asserts the served document has no inline script or style and that no CSP violation is reported (plan 05c).
- **R6** Forms hold local state, validate with the contracts' schemas for immediate feedback, and treat the API answer as authoritative. Each page maps the API codes it can receive to one English sentence each (`errorMessage`); `VALIDATION_FAILED` and `AUTH_PASSWORD_WEAK` `details` are shown under the field named by `path`; unknown codes show "Something went wrong. Try again."
- **R7** Motion is confined to the landing page (visual identity spec) and to the sign-in reveal that leaves it. Once sign-in resolves, the form recedes and the emblem grows and travels to the centre of the viewport, still on the landing page; the `/` → `/app` navigation then runs as one same-document view transition in which the workspace opens from the centre and the emblem settles into its slot in the sidebar. The workspace itself is still: every other screen uses hover and focus transitions only. Everything honours `prefers-reduced-motion`, under which the reveal is skipped and the navigation is plain; a browser without view transitions gets the landing beats and a plain navigation.
- **R8** Every page and shared component has component tests (Vitest, Testing Library, `vi.mock` of `apps/web/src/api/*`): rendering by permission, the happy path, mapped errors, and — for `/app` routes — the 401 and 403 behaviour of R4. Critical flows have Playwright end-to-end tests (RFC-01 R6, plan 05c).
- **R9** Copy is English. Error messages never echo internals (RFC-02 R9); on sign-in, unknown email and wrong password share one sentence (RFC-22 R2). `formatNumber` (`apps/web/src/lib/format.ts`) shows thousands separators and at most three decimal places, except when the value is non-zero and its absolute value is below `0.001`, where it shows three significant digits instead (`0.0004`, not `0`): a measurement that rounds to `0` under a fixed three decimals is a false value, not a rounded one, and this helper is the one place every numeric surface (species list, record tables, trait cards, trait page) goes through.
- **R10** Dialogs and drawers are modal: while one is open the rest of the document is `inert` (not focusable, not clickable, hidden from assistive technology), Tab and Shift+Tab cycle inside it, focus moves into it on open and returns to the element that opened it on close. The native `<dialog>` opened with `showModal` provides the trap; both `Dialog` and `Drawer` render through a portal at the end of `document.body` and share one stack of open modals that marks every other child of `body` `inert` and returns focus on close — also when a dialog is unmounted still open after a successful save, where the browser restores nothing. A drawer never opens over an open dialog: the native modal blocks everything outside it.
- **R11** A `?` help tip is a button that shows a `role="tooltip"` element it controls (`aria-controls`/`aria-expanded`); it opens on click, on focus and on pointer hover, and closes on Escape, on a pointerdown outside it and once focus leaves it. Opening is not a toggle: a pointer click also carries the hover that opened the tip, so a click never closes it; hover and focus leaving are what close it. Its text is plain content, never HTML from the API.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R5 clarified: markup vs CSSOM.
- 2026-09-13 — R10: modal focus trap and inert background (plan 07b).
- 2026-09-14 — R10: `Dialog` joins the `Drawer` modal stack (portal, shared `inert` marks, focus return on unmount); drawer-over-dialog ruled out (issue #59).
- 2026-09-17 — R2: /app/admin/plots, /app/admin/plots/$id (RFC-67, plan 08b).
- 2026-09-17 — R11: `?` help tip added — a button-controlled `role="tooltip"` popover, not a dialog (`HelpTip`, plan 09b).
- 2026-09-17 — R11 softened: the tip opens rather than toggles; a click cannot close what the hover before it opened (`HelpTip`, plan 09b).
- 2026-09-18 — R3: breadcrumb reads `Group › Entry › crumbs…`, trailing crumbs registered by pages through `useBreadcrumb` (plan 10a).
- 2026-09-18 — R2: `/app/contributions` (RFC-71, plan 11a).
- 2026-09-18 — R2: /app/traits/$id (RFC-62, plan 10c).
- 2026-09-18 — R2: /app/curation/coverage (RFC-69 R5-R7, plan 11c).
- 2026-09-19 — R9: `formatNumber` below `0.001` switches to three significant digits instead of showing a non-zero measurement as `0` (issue #98).
- 2026-09-19 — R2: /app/help, /app/help/$topic (RFC-73, plan 12a).
- 2026-09-19 — R2: /app/curation/proposals (RFC-75, plan 12c).
- 2026-09-19 — R2: /app/admin/health (RFC-52, plan 12d).
- 2026-09-20 — R1: `apiFetch` parses every response with the contracts schema the fetcher names and answers `RESPONSE_INVALID` on a mismatch; previously it cast the JSON to whatever type the fetcher claimed (issue #116).
- 2026-09-21 — R7: the sign-in reveal — landing beats, then one view transition into the workspace — joins the landing page as the only motion (issue #139).
