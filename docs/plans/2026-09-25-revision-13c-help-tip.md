# Revision 13c — Bigger Help Tip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `?` help tip clearly larger (spec §2, "The `?` trait tip is larger"). The trigger grows from a 20px button with a 16px icon to a 28px button with a 20px icon, and keeps its focus ring and behaviour.

**Architecture:** This is a class and prop change in the one shared primitive, `apps/web/src/components/ui/HelpTip.tsx`. Every tip inherits it. There is no new prop and no variant.

**Tech Stack:** unchanged (React 19, Tailwind 4, Vitest 5 + Testing Library). No new dependencies.

**Spec:** `docs/specs/2026-09-25-record-model-revision-design.md` — §2 (last bullet), §3 row 13c.

**Depends on:** nothing. It can run in any wave. RFC-13 R11 defines the tip's behaviour, not its size, so no RFC changes.

## Global Constraints

- English everywhere. TDD: failing test first, seen failing, then the minimum code. Tests name the rule (`RFC-13 R11`). The existing `@rfc RFC-13 R11` tag on `HelpTip` stays.
- The touch target must not drop below 24×24 px (WCAG 2.5.8). 28px clears it. The `focus-visible:outline-*` ring classes stay unchanged.
- Branch `feat/revision-13c-help-tip`, cut from `origin/main` in its own worktree. Rebase onto `origin/main` before pushing.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

### Verification (no Node on this Mac — Docker)

```sh
git fetch origin
git worktree add ../TreeRepro-13c -b feat/revision-13c-help-tip origin/main
cd ../TreeRepro-13c
docker run -d --name treerepro-13c -w /workspace treerepro-verify:base sleep infinity   # base image per memory "verify-in-docker-no-node"
```

**Sync.** Run this from the worktree root before every run:

```sh
docker exec treerepro-13c sh -c 'cd /workspace && find . -name node_modules -prune -o -type f -exec rm -f {} +' \
&& COPYFILE_DISABLE=1 tar -cf - --exclude='./node_modules' --exclude='*/node_modules' --exclude='./.git' \
    --exclude='./data' --exclude='./.claude' --exclude='*/dist' \
    --exclude='.DS_Store' --exclude='._*' --exclude='*/._*' . \
  | docker exec -i treerepro-13c tar -x -C /workspace \
&& docker exec treerepro-13c sh -c 'cd /workspace && pnpm --filter @treerepro/contracts build'
```

## File Structure

```
apps/web/src/components/ui/HelpTip.tsx        # button size-5 → size-7, icon 16 → 20
apps/web/src/components/ui/HelpTip.test.tsx   # one size test
```

---

### Task 1: Larger `?` trigger

**Files:** `apps/web/src/components/ui/HelpTip.tsx` (lines 74–76), `apps/web/src/components/ui/HelpTip.test.tsx`

**Interfaces:** `HelpTip({ label?, children, learnMore? })` is unchanged.

- [ ] **Step 1: Write the failing test.** Append inside `describe('RFC-13 R11 HelpTip', …)` in `HelpTip.test.tsx`:

```tsx
  it('shows a larger trigger — a 28px button around a 20px icon — keeping its focus ring', () => {
    render(<HelpTip>Explains things.</HelpTip>);
    const button = screen.getByRole('button', { name: 'What does this mean?' });
    expect(button).toHaveClass('size-7', 'focus-visible:outline-2', 'focus-visible:outline-pollen-500');
    expect(button).not.toHaveClass('size-5');
    expect(button.querySelector('svg')).toHaveAttribute('width', '20');
  });
```

- [ ] **Step 2: Run it.** Run **Sync**, then:

```sh
docker exec treerepro-13c sh -c 'cd /workspace && pnpm --filter @treerepro/web exec vitest run src/components/ui/HelpTip.test.tsx'
```

Expected: FAIL. The button has `size-5`, not `size-7`.

- [ ] **Step 3: Implement.** In `HelpTip.tsx`, change the button's class and the icon size:

```tsx
        className="inline-flex size-7 items-center justify-center rounded-full text-mist-400 transition-colors hover:bg-mist-50 hover:text-canopy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pollen-500"
      >
        <Icon name="help" size={20} />
```

- [ ] **Step 4: Run to pass.** Run **Sync**, then:

```sh
docker exec treerepro-13c sh -c 'cd /workspace && pnpm --filter @treerepro/web test && pnpm --filter @treerepro/web typecheck && pnpm lint && pnpm rfc:check'
```

Expected: all green. The whole web suite runs because seven components render `HelpTip`, and none of their tests asserts its size.

- [ ] **Step 5: Commit.**

```sh
git add apps/web/src/components/ui/HelpTip.tsx apps/web/src/components/ui/HelpTip.test.tsx
git commit -m "feat(web): larger ? help tip (spec 13c, RFC-13 R11)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and PR.** Run `git fetch origin && git rebase origin/main`, rerun Step 4 on the rebased tree, and run `coderabbit review --agent --base main` once. Then:

```sh
git -c http.version=HTTP/1.1 -c http.postBuffer=524288000 push -u origin feat/revision-13c-help-tip
gh pr create --title "feat(web): larger ? help tip (plan 13c)" --body "$(cat <<'EOF'
Spec §2 (docs/specs/2026-09-25-record-model-revision-design.md): the `?` tip is larger — trigger 20px → 28px, icon 16px → 20px; focus ring and RFC-13 R11 behaviour unchanged.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Read the PR's CodeRabbit comments before merging.

## Spec notes

1. The spec says "the `?` **trait** tip". `HelpTip` is one primitive, used by the trait cards and by five other places (the entry dialog, record actions, the sources field). The minimal reading enlarges the primitive, so every tip grows alike. A size prop only for trait cards would be a new variant the spec does not ask for.
2. RFC-13 fixes no size (R11 is behaviour only), so no RFC changes and no 13a dependency.
3. Plan 13h rewrites `TraitCard` and `RecordActions`, which both render `HelpTip`. Neither sets a size of its own, so the change carries over with no conflict.
