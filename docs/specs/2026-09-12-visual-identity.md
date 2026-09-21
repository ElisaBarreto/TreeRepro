# TreeRepro — Visual Identity and Landing Page

**Date:** 2026-09-12
**Status:** implemented (landing page); palette and type apply to every screen from plan 05 on
**Scope:** color tokens, typefaces, motion policy, and the landing page — the only public screen. Mockup: the "TreeRepro Landing" design canvas (session artifact). Reference for the mood, not copied: a login page with a particle network, a glowing emblem inside spinning rings and a dark glass card.

## 1. Decisions summary

| Topic | Decision |
|---|---|
| Palette | Five token families in `apps/web/src/styles.css` (`@theme`): `canopy` greens (surfaces, gradients), `pollen` ambers (actions, emphasis), `bark` browns (emblem), `mist` (text on dark surfaces), `ink` (text on amber). Tailwind default colors stay available but new UI uses these. |
| Typefaces | Sora (display: headings, buttons, wordmark) and Manrope (body), self-hosted from `@fontsource-variable/*`. No Google Fonts request: the production CSP is `font-src 'self'` and fonts must not leak visitor IPs to a third party. |
| Motion | Only the landing page moves: pollen canvas, emblem glow, rings, float, seeds, tilt, card entrance, button glow. Every effect is declared in `apps/web/src/components/landing/landing.css` and stops under `prefers-reduced-motion`. Other screens stay still; they may use plain hover/focus transitions and nothing else. |
| Landing page | `/` is the only public route. It is the sign-in screen: emblem and one-line description on the left, wordmark, "Welcome back", email + password (then a verification code when TOTP is on) on the right. No self-registration link: access is by invitation (RFC-20). A visitor with a live session sees "Signed in as …" and a sign-out button until the workspace pages exist (plan 05). |
| Pollen | Original simulation in `pollen.ts`: half of the grains lift off the canopy, half already hang in the open air outside the card; a slow wind carries them up and to the left with a gentle swirl; nearby grains are joined by faint threads (at most two per grain); the pointer scatters them and pulls amber threads toward itself. 50 grains on desktop, 24 under 720px. |
| Copy | English (README rule 5). Wordmark "TreeRepro", title "Welcome back", subtitle "Tracking how trees reproduce.", caption "Flowering, fruiting and seed data, recorded in the field." Error messages map API codes one to one in `loginErrorMessage`; unknown email and wrong password share a sentence (RFC-22 R2). |

## 2. Tokens

| Family | Tokens | Use |
|---|---|---|
| `canopy` | 950 `#071f1c` · 900 `#061a18` · 800 `#0d4c41` · 700 `#0f5c4f` · 600 `#1f8f7a` · 500 `#3faa86` · 400 `#5fbf8a` · 300 `#7fd1a5` · 200 `#b5ebc9` | page gradient (950 → 700 → pollen-600), card ground (900 at 90%), emblem |
| `pollen` | 600 `#c98a2e` · 500 `#e8a33d` · 400 `#f2c14e` · 300 `#ffd777` | primary button, subtitle, focus underline, alerts, pollen grains |
| `bark` | 700 `#8a5426` · 500 `#c1863f` | emblem trunk |
| `mist` | 50 `#eef4f1` · 100 `#cfd8d3` · 200 `#b7c4bf` · 300 `#a9b8b2` · 400 `#8fa39c` · 500 `#6f817b` | body text on dark, labels, links, placeholders |
| `ink` | `#1b1406` | text on amber |

Type scale on the landing page: wordmark 12px / 0.28em tracking, title 34px (28px under 720px), subtitle 16px semibold, labels 12px semibold, inputs 15px, button 14px uppercase / 0.08em tracking, footer 12px.

## 3. Components

| File | Role |
|---|---|
| `apps/web/src/pages/HomePage.tsx` | composition; owns the `me` query and the sign-out mutation |
| `apps/web/src/components/landing/LoginForm.tsx` | two-step form, error mapping, no session state of its own |
| `apps/web/src/components/landing/TreeEmblem.tsx` | SVG emblem, glow, rings, seeds, pointer tilt; exposes its stage through `ref` |
| `apps/web/src/components/landing/PollenField.tsx` | canvas renderer over `pollen.ts` |
| `apps/web/src/components/landing/pollen.ts` | pure simulation, unit-tested with a seeded random |
| `apps/web/src/api/auth.ts` | `login`, `loginTotp`, `fetchMe`, `logout` over `apiFetch` |
| `apps/web/src/lib/motion.ts` | `prefersReducedMotion`, `cssColorAsRgb` |

## 4. Out of scope

Forgot-password page (the link points to `/forgot-password`, not yet routed), invitation acceptance page, the workspace after sign-in, a privacy notice link in the footer. All belong to plan 05.

## 5. Sign-in reveal (2026-09-21, issue #139)

After sign-in resolves the landing page does not cut to the workspace; the emblem carries the visitor there. Design canvas: "TreeRepro Login Reveal" (session artifact). Rule: RFC-13 R7.

| ms | Beat | Where |
|---|---|---|
| 0 | Form, caption and links recede (450 ms). | landing, `.tr-recede` |
| 350 | The card fades and shrinks a touch (600 ms) while the emblem travels to the centre of the viewport and grows 1.65× (1200 ms, easing in and out); the rings ripple outward and vanish, the glow blooms; on arrival the canopy swells once (1.2 s) and the fruits pop one after the other (0.8 s each, 100 ms apart), the last pop ending on the leave beat — the navigation snapshots the page, so nothing may still be moving. Pollen keeps lifting off the emblem wherever it is (the field measures the stage every 30 frames). | landing, `.tr-gone` on the card, `.tr-grow` on the travel wrapper |
| 2750 | `navigate({ to: '/app', viewTransition: true })`. The workspace is revealed from the centre as a widening circle (950 ms, `::view-transition-new(root)`); the landing snapshot stays underneath (`::view-transition-old(root)` does not fade). The tree holds its full size meanwhile. | view transition |
| 3150 | After 1.6 s at full size the emblem glides into its 40 px slot in the sidebar (900 ms, easing in and out): the landing stage and the sidebar `Emblem` share `view-transition-name: tr-emblem`, so the browser morphs one into the other. | view transition |
| 4050 | Done. | — |

Pieces: `apps/web/src/components/landing/reveal.ts` (the beats and the travel offset, pure), `HomePage` (runs the beats, sets `--tr-dx`/`--tr-dy` on the travel wrapper through the CSSOM, as the tilt does, makes the receded form `inert` and ignores a second sign-in while the reveal runs), `LoginForm` (stays pending after a successful sign-in, so the credentials are never posted twice), `landing.css` (every class and the `::view-transition-*` rules), `TreeEmblem` (ring and glow wrappers so the ripple and the bloom do not fight the spin and pulse animations on the same `transform`), `Emblem` (`tr-canopy` and `tr-fruit` hooks, inert outside the reveal), `AppShell` (the sidebar emblem's `view-transition-name`), the `/` route (`viewTransition` on the navigation; mounts the page afresh should `/app`'s guard bounce the visitor back). Under `prefers-reduced-motion` `HomePage` skips the beats and the route navigates plainly; a browser without `document.startViewTransition` plays the landing beats and the router falls back to a plain navigation.
