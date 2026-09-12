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
