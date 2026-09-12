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
