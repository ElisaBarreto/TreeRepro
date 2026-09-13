# RFC-13 — Presentation layer

| Field | Value |
|---|---|
| Status | accepted |
| Category | platform |
| Supersedes | — |

## Context

`apps/web` is a display layer over the API (RFC-10 R3). These rules say how it routes, how it learns who the visitor is and what they may do, how it talks to the API, and what the production Content-Security-Policy allows it to do. Components cite these rules instead of the architecture rule they used to cite.

## Rules

- **R1** The web app contains no business rules and reaches the API only through `apiFetch` (`apps/web/src/api/client.ts`); every request and response type comes from `packages/contracts`. Business decisions (who may do what, what is valid) are answered by the API; the web app only reflects them.
- **R2** Routes. Public: `/` (sign-in, the landing page), `/invite/$token`, `/forgot-password`, `/reset-password/$token`. Authenticated, under the `/app` layout route: `/app`, `/app/settings`, and the areas later RFCs add (`/app/admin/*` in RFC-13's plan 05b, dataset pages in RFC-6x). The `/app` layout resolves `GET /api/auth/me` before rendering and redirects to `/` when it fails; `/` redirects a visitor with a live session to `/app`.
- **R3** Navigation entries and action buttons render only when `me.permissions` holds the permission the target route or API call requires (`hasPermission`); `admin.access` gates the Admin section of the navigation and the `/app/admin` layout, which shows "You do not have permission to open this area." without redirecting. This is presentation only: the API is the authority (RFC-32 R4).
- **R4** An `AUTH_UNAUTHENTICATED` answer (HTTP 401) to any call made under `/app` clears the session state (the `me` query) and returns to `/`; other 401 codes (`AUTH_INVALID_CREDENTIALS`, `AUTH_TOTP_INVALID`) are form errors shown where the action was attempted; a 403 answer is shown where the action was attempted as "You do not have permission to do this." There are no global toasts.
- **R5** Content-Security-Policy: no `style` attributes in markup and no `<style>`/`<link>` injection by libraries, no third-party scripts, styles or fonts. Styling is Tailwind utility classes and the tokens of `apps/web/src/styles.css`; CSSOM property assignment (React's `style` prop, a canvas library) is not blocked by the CSP but is avoided. The end-to-end suite asserts the served document has no inline script or style and that no CSP violation is reported (plan 05c).
- **R6** Forms hold local state, validate with the contracts' schemas for immediate feedback, and treat the API answer as authoritative. Each page maps the API codes it can receive to one English sentence each (`errorMessage`); `VALIDATION_FAILED` and `AUTH_PASSWORD_WEAK` `details` are shown under the field named by `path`; unknown codes show "Something went wrong. Try again."
- **R7** Motion is confined to the landing page (visual identity spec); every other screen uses hover and focus transitions only and honours `prefers-reduced-motion`.
- **R8** Every page and shared component has component tests (Vitest, Testing Library, `vi.mock` of `apps/web/src/api/*`): rendering by permission, the happy path, mapped errors, and — for `/app` routes — the 401 and 403 behaviour of R4. Critical flows have Playwright end-to-end tests (RFC-01 R6, plan 05c).
- **R9** Copy is English. Error messages never echo internals (RFC-02 R9); on sign-in, unknown email and wrong password share one sentence (RFC-22 R2).
- **R10** Dialogs and drawers are modal: while one is open the rest of the document is `inert` (not focusable, not clickable, hidden from assistive technology), Tab and Shift+Tab cycle inside it, focus moves into it on open and returns to the element that opened it on close. The native `<dialog>` opened with `showModal` provides this; the `Drawer` renders through a portal at the end of `document.body` and marks its siblings `inert` itself.

## Open questions

None.

## Changelog

- 2026-09-13 — created.
- 2026-09-13 — accepted.
- 2026-09-13 — R5 clarified: markup vs CSSOM.
- 2026-09-13 — R10: modal focus trap and inert background (plan 07b).
