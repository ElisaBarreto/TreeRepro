# Web (React, Vite, Testing Library)

## Testing Library does not clean up between tests
**Symptom:** A second test in the same file fails with `Found multiple elements with the text of: …` although each test renders once.
**Cause:** Testing Library registers its automatic `cleanup` only when the runner exposes `afterEach` globally. `apps/web/vitest.config.ts` runs without `globals: true`, so nothing unmounts the previous render.
**Fix:** `apps/web/src/test/setup.ts` imports `cleanup` and registers `afterEach(cleanup)` itself. Do not turn on `globals` to get the same effect.

## Swapping two forms in place keeps the old input values
**Symptom:** After the login form switches to the verification-code step, the code field already contains the email address.
**Cause:** Both steps render `<form> → field → <input>` at the same position, so React reuses the DOM nodes; an uncontrolled input keeps whatever the DOM had.
**Fix:** Give each step's `<form>` a distinct `key` (`LoginForm.tsx`) so React remounts the subtree. The same applies to any conditional swap of similar uncontrolled forms.

## Biome flags `aria-hidden` on `<canvas>`
**Symptom:** `lint/a11y/noAriaHiddenOnFocusable` on a decorative canvas.
**Cause:** Biome counts `canvas` among focusable elements even without `tabIndex`.
**Fix:** Keep `aria-hidden="true"` (the drawing is decorative and `pointer-events: none`) and suppress the rule on that element with a `biome-ignore` comment stating why, as in `PollenField.tsx`.

## `useMe()` throws outside `/app`
**Symptom:** `Error: useMe: no session in the cache` in a component test or on a public page.
**Cause:** The `/app` layout's `beforeLoad` resolves the session; `useMe` assumes it did.
**Fix:** Render the component under `/app` (the route tree) or seed the session in tests with `renderWithProviders(ui, { me })` / mock `fetchMe` for `renderAt(path)`.

## A 401 under `/app` must navigate before the `me` query is dropped
**Symptom:** Infinite refetch loop on session expiry.
**Cause:** Removing an actively observed query makes the observer refetch; the refetch 401s again. Only code `AUTH_UNAUTHENTICATED` counts as session loss (`isSessionLoss`) — the other 401 codes (`AUTH_INVALID_CREDENTIALS`, `AUTH_TOTP_INVALID`, `AUTH_MFA_EXPIRED`) are form errors and must not sign the user out.
**Fix:** `createSessionErrorHandler` navigates to `/` first and forgets the session (`forgetSession`, which clears every query and mutation) only once the post-navigation location is outside `/app`; the shell's sign-out (`AppShell.tsx`) and "Sign out everywhere" (`SessionsSection.tsx`) follow the same navigate-then-forget order. Keep that order.

## jsdom has no `<dialog>`
**Symptom:** `showModal is not a function` in component tests.
**Fix:** `apps/web/src/test/setup.ts` polyfills `showModal`/`close`; do not mock `Dialog` itself.

## A `beforeEach` that returns the mock runs it as cleanup
**Symptom:** A test fails with the API error a persistent `mockRejectedValue` was set up to return, or a mock records one call more than the component made.
**Cause:** `beforeEach(() => auth.x.mockReset())` returns the mock (`mockReset()` returns it) and Vitest calls a function returned from a hook as that hook's cleanup, so the mock is invoked after every test.
**Fix:** Block bodies — `beforeEach(() => { auth.x.mockReset(); });`.

## `mutationFn` receives a second argument
**Symptom:** `expect(api.fn).toHaveBeenCalledWith(value)` fails with an unexpected second object argument.
**Cause:** TanStack Query 5.102 calls `mutationFn(variables, context)`.
**Fix:** Wrap it — `mutationFn: (name) => updateName(name)` — so the api function sees only its own parameters.

## Test files under `routes/`
**Symptom:** `Warning: Route file ".../routes/app.test.tsx" does not export a Route` at Vitest startup.
**Cause:** The router plugin scans `routes/` and the default ignore prefix is `-`.
**Fix:** `routeFileIgnorePattern: '\\.test\\.tsx?$'` in `apps/web/vite.config.ts`.

## jsdom has no `scrollTo`
**Symptom:** `Not implemented: Window's scrollTo() method` during router navigation tests.
**Cause:** TanStack Router's scroll restoration calls it on every navigation.
**Fix:** `window.scrollTo = () => {};` in `apps/web/src/test/setup.ts`.

## A file download is a plain `<a download>`
**Symptom:** Temptation to route a CSV export through `apiFetch` like every other request.
**Cause:** `apiFetch` buffers the whole response body in memory and returns it as parsed JSON; that loses the browser's native download UI (`Content-Disposition`, progress, the "Save As" prompt) and would hold a large export entirely in memory.
**Fix:** A file download is a plain `<a download>` to the API path (`EXPORT_ACCEPTED_URL` in `SpeciesSearchPage.tsx`) — the session cookie travels with the navigation like any other same-origin request, no `apiFetch` involved.

## A suggestion list is `<div role="listbox">` of `<button role="option">`
**Symptom:** Biome rejects `<ul role="listbox">` / `<li role="option">` (`noNoninteractiveElementToInteractiveRole`, `useFocusableInteractive`); with a `<button>` nested inside the `<li>`, `userEvent.click(getByRole('option'))` does nothing — the click lands on the `li`, not the button, and assistive technology behaves the same way because an option's children are presentational.
**Fix:** The element that carries `role="option"` must be the focusable, clickable one: render `<div role="listbox">` with `<button type="button" role="option" aria-selected>` as its direct children (`SpeciesSearchForm.tsx`). No `ul`/`li` in between.

## The router's `Link` overrides `aria-current` when it thinks it is active
**Symptom:** The sidebar marks both Workspace (`/app`) and Species as the current page under `/app/species/<id>`, although the shell passes `aria-current` itself.
**Cause:** TanStack Router's `Link` spreads its own `{ "data-status": "active", "aria-current": "page" }` *after* your props whenever it considers itself active, and by default a link is active on a prefix match — so `/app` is active everywhere.
**Fix:** `activeOptions={{ exact: true }}` on every sidebar link and `aria-current` computed from `currentEntry(pathname)` (`AppShell.tsx`, `nav.ts`): the router only ever agrees with that value, never overrides it with a prefix match.

## `Combobox` keyboard model is roving focus, not `aria-activedescendant`
**Symptom:** a listbox of `<button role="option">` cannot use `aria-activedescendant` (the options are real focusable buttons), and jsdom does not implement activedescendant either.
**Fix:** ArrowDown from the input focuses the first option button, the arrows move focus among options, Escape returns focus to the input (`Combobox.tsx`). Tests assert `toHaveFocus()` on the option buttons.

## Modals (`Dialog`, `Drawer`) portal to `document.body` and share one stack that marks the rest of the page `inert`
**Symptom:** Tab still reaches inputs behind the panel, or a screen reader announces content underneath, while a drawer is meant to be modal. Or: a dialog opened from inside a drawer is dead — the drawer's own `inert` mark on `#root` covers the dialog rendered inline there. Or: a dialog that saves successfully is unmounted still open and focus lands on `body`, because the browser restores focus only through the native `close` event.
**Cause:** A modal rendered inline in the component tree sits under whatever the page (or another modal) marked `inert`; jsdom's `showModal` polyfill (`test/setup.ts`) enforces neither a focus trap nor `inert`; and an unmounted `<dialog>` never fires `close`.
**Fix:** Both `Dialog` and `Drawer` render through `createPortal(..., document.body)` and register in the module-level stack of `components/ui/modal-stack.ts` (`pushModal(root)` in the open effect, the returned pop on close or unmount): after every open or close it recomputes `body`'s children — the topmost modal's root is the only active one, every other child is `inert` (children that already had the attribute are left alone; only what the module marked is ever unmarked). Focus: a drawer moves it to Close on open; on close the stack returns it to the closing modal's opener when that opener lives inside the modal left on top (a dialog opened from a drawer), else to that modal's Close, and back to the page opener once none remains (RFC-13 R10). Per-instance bookkeeping ("remove what I set") is not enough: two modals can be open at once (trait panel + record drawer) and the outer can close first — the page dropped it — while the inner stays open; an instance-local cleanup would then un-inert the page under the inner one and pull focus out of it. One combination stays impossible: a `Drawer` over an open `Dialog` — the native modal blocks everything outside its subtree, the drawer's portal included, and no `inert` bookkeeping can lift that; close the dialog first (in development `pushModal` reports the misuse with `console.error`).

## A dialog mounted only while open starts from fresh state
**Symptom:** A dialog's initial field values are stale or wrong after it is reopened for a different item.
**Cause:** Toggling an `open` prop keeps the component instance (and its `useState`) alive across opens; when the initial value depends on what opened it (which trait, which pending group), the old state leaks into the new open.
**Fix:** Mount and unmount the dialog instead of toggling `open` — render it only while a piece of state names what to open (`{addValueOpen ? <AddValueDialog ... /> : null}`), so every open is a fresh mount with fresh state (`AddValueDialog`, `MapDialog`).

## An edit dialog sends a diff, and an unchanged form is not a request

The catalog `PATCH` bodies are `nonEmpty` (400 `VALIDATION_FAILED` on `{}`) and a `PATCH` that changes nothing writes no audit row. Edit dialogs therefore compute the difference against the loaded entity — a changed field sends its value, an emptied optional field sends `null`, an untouched field is omitted — and close without a request when the difference is empty. Comparing trimmed strings against the stored value is what makes "typed a space and deleted it" a no-op.

## Reordering dictionary levels is two PATCHes, moved level first

`PATCH /api/traits/:id/levels/:levelId` changes one level; a move swaps the `sortOrder` of two. `LevelsEditor` sends the moved level first, then the neighbour, inside one `mutationFn`, and invalidates the dictionary once at the end — a first-call failure leaves the order untouched, a second-call failure leaves the two levels tied (the list then orders them by key), which the next move repairs. Ties are only possible in that state or in a dictionary seeded before `sortOrder` existed; a move across a tie sends a single shifted `sortOrder` instead of a swap. A move up across a tie at `sortOrder` 0 cannot shift the moved level below 0, so it pushes the neighbour down instead (the moved level's `sortOrder` stays put while the neighbour's becomes the moved level's `sortOrder + 1`). The invalidation runs in `onSettled`, not `onSuccess`, so a failed move still refetches the dictionary — the tie is visible in the list right away rather than after an unrelated refetch, and the next move repairs it.

## A `fieldset` is a named group only through its `legend`
**Symptom:** `getByRole('group', { name })` finds nothing although the fieldset has a heading inside.
**Cause:** The accessible name of a `fieldset` comes from its `legend`, not from a heading or paragraph child.
**Fix:** `<fieldset><legend>…</legend>…</fieldset>` (`RoleDialog.tsx`).

## A checkbox list seeded from a prop must re-seed when the prop changes
**Symptom:** After a save (or another section's write) the checked boxes still show the old roles.
**Cause:** `useState(initial)` reads the prop once; later prop values are ignored.
**Fix:** Keep a derived key next to the state and reset during render when it changes (`UserRolesSection.tsx`) — the adjust-state-during-render pattern `usePagedList` uses.

## Vite inlines small assets as `data:` URIs, which the CSP forbids
**Symptom:** The e2e CSP spec reports a `font-src` violation on every page although no code references a data URI.
**Cause:** Vite base64-inlines assets under 4 KiB into the CSS; `Caddyfile.prod`'s `font-src 'self'` has no `data:`.
**Fix:** `build.assetsInlineLimit: 0` in `apps/web/vite.config.ts`; verify with `grep -c "url(data:" apps/web/dist/assets/*.css` → 0.

## zod 4 probes `Function('')` and trips `script-src` without `unsafe-eval`
**Symptom:** `securitypolicyviolation` (`script-src` … `eval`) on every page load; zod catches its own error so nothing breaks, but the CSP report is real (#9).
**Cause:** zod caches the eval probe at the first object-schema construction; a static schema import anywhere in the entry's synchronous graph runs before app code can configure zod, because a chunk's static imports evaluate before its inlined modules.
**Fix:** `z.config({ jitless: true })` as the first import of `packages/contracts/src/index.ts` (`zod-jitless.ts`, issue #63); the configuration travels structurally with the schemas across both API and web, so any imported contracts schema is evaluated with jitless parsing without relying on bundler ordering or `main.tsx` conventions; `apps/e2e/tests/csp.spec.ts` guards against regressions.
