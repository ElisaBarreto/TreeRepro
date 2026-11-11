# Plan 15g — PlantRepro identity

**Spec:** `docs/specs/2026-11-11-plantrepro.md` §7. **Epic plan:** `docs/plans/2026-11-11-plantrepro.md`. Visual reference: the plum “Bloom” mockup chosen on 2026-11-11 (forest emblem: the TreeRepro tree, a conifer, a pink flower, a fern, grass, on a plum disc).

**After merge, TreeRepro users see nothing new.**

## Tasks

1. **RFC.** RFC-13 (presentation): brand per platform, decided by `location.hostname` (first label `plantrepro`), and `data-platform` set before first paint.
2. **Platform in the SPA.**
   - `apps/web/src/lib/platform.ts`: `currentPlatform(): Platform`.
   - An inline snippet in `index.html` sets `document.documentElement.dataset.platform` before the bundle loads. The CSP is `script-src 'self'`, so it goes in a small same-origin `platform.js` loaded first, not inline.
   - Unit test the hostname rule.
3. **Theme.** Plum tokens under `[data-platform="plantrepro"]` in `styles.css` override the canopy tokens, in both light and dark. Check the contrast of the text tokens against the WCAG AA level the current palette meets.
4. **Emblem and favicon.**
   - `Emblem` gains `variant: Platform`, and the forest drawing for `plantrepro`.
   - `public/favicon-plantrepro.svg`, swapped by `platform.js`.
   - Snapshot test of both variants.
5. **Copy.** These all use `PLATFORM_NAMES[currentPlatform()]` and the platform's wording (trees or plants):
   - title, AppShell, AuthFrame, HomePage, InvitePage
   - `content/project.ts`
   - help where it names the platform
6. **Mail and API strings.** All of these follow the mail's platform, as passed by 15c:
   - `apps/api/src/mail/templates.ts`, `layout.ts`: name and sender display name
   - TOTP issuer: the platform where the user enrols
   - OpenAPI title: neutral “TreeRepro / PlantRepro API”
   - User-Agents: stay as they are
7. **Password managers.**
   - Read Google's current documentation on Digital Asset Links for sharing credentials between websites (`delegate_permission/common.get_login_creds`) and confirm it still applies to web-to-web sharing.
   - If it applies, serve `/.well-known/assetlinks.json` on both hosts from the web container, each listing both origins, and add a test that both hosts serve it.
   - If it does not apply, record what does in the issue.
   - The login form keeps `autocomplete="username"` and `autocomplete="current-password"`.
8. **Handbook.** Update `CLAUDE.md` Layout: the brand per platform.
9. **UI check.** Point the dev web container at the worktree and take screenshots of `localhost` and `plantrepro.localhost`: landing, login, species list, species page, in light and dark. Rafael reviews them before the PR.
