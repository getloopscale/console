# ADR — Take the `nanoid` patch in the lockfile; do not allowlist it

**Status:** accepted
**Date:** 2026-08-13
**Context item:** B-278
**Supersedes:** the first draft of this ADR (same file, same day, never released), which decided the
opposite. See § What the first draft got wrong.

## Context

`npm audit --omit=dev` on `dashboard/` reported one HIGH:

```
nanoid  HIGH  GHSA-2v37-7h3g-55p8  cvss 5.9  — custom generators loop indefinitely when size is zero
```

`deps-audit-golden-rule.md § 2` classifies a HIGH on a declared dependency as `FAIL_INSECURE`, which
blocks `/plan-confidence`. So it has to be either fixed or explicitly exempted.

Four measurements decide this ADR. Each is a command and its output, not an inference.

1. **`nanoid` is not in the bundle.** After `npm run build`,
   `grep -rl "nanoid\|urlAlphabet\|useandom" dist/` returns nothing. This held before the fix and
   after it, and it is the one claim from the first draft that survived review.

2. **The physical install is required by our own direct devDependency**, not by a third party:

   ```
   $ npm explain nanoid
   nanoid@3.3.16
     nanoid@"^3.3.16" from postcss@8.5.25
       dev postcss@"^8.4.0" from the root project        <- dashboard/package.json
       postcss@"^8.5.3"  from vite@6.4.3
       dev vite@"^6.0.0" from the root project           <- dashboard/package.json
   ```

3. **A patch inside the existing range removes it.** `nanoid@^3.3.16` already admits `3.3.18`:

   ```
   $ npm update nanoid            # 3 lines of package-lock.json; package.json untouched
   $ npm audit --omit=dev
   found 0 vulnerabilities
   ```

4. **Nothing downstream moved.** `npm run build` exit 0; `dist/` still free of `nanoid`.

## Decision

Take the patch: `nanoid` 3.3.16 → 3.3.18 in `package-lock.json`. No allowlist entry, no ADR-backed
deferral, no `overrides` block, no change to `package.json`.

## Rationale

The first draft rejected "a local bump" on the grounds that it "would make `npm audit` green without
changing a single byte of what we ship". That principle is sound and this repository should keep
applying it — but it was applied to the wrong action, because two different things were being called
"a bump":

| Action | What it is | Verdict |
|---|---|---|
| `overrides: { "nanoid": "^3.3.17" }` | Forcing a version the dependency graph did not ask for, to move a number in a report | Still rejected — this is what the principle forbids |
| `npm update nanoid` | Taking the maintainer's patch release, already inside the range the lockfile declares | Correct. This is dependency hygiene, not report-gaming |

The second is what a `dependabot` patch PR would do, and refusing it because a sibling action would
have been gaming is the mirror error of gaming: paying a real cost (a live advisory in the tree, an
allowlist to police, a sunset alarm to answer in 90 days) to protect a principle that was never
under threat.

Alternatives considered:

- **Allowlist for 90 days with a sunset (the first draft's decision)** — rejected. An exemption is
  for a finding you cannot fix; this one takes one command. `deps-audit-golden-rule.md § 4` caps
  allowlist entries at 90 days precisely because they are debt, and taking on debt that a patch
  release retires today is a bad trade.
- **`npm overrides` pin** — rejected, above.
- **`npm audit fix`** — rejected as too broad. It also proposes `add fsevents 2.3.2, added 69
  packages`, which is a much larger change than the advisory requires. `npm update nanoid` touches
  three lines.
- **Fix `@theokit/ui`'s packaging** — no longer applicable. See below; there is nothing there to fix.
- **Drop `@theokit/ui`** — disproportionate, and now pointless: it was never the cause.

## What the first draft got wrong

Recorded rather than quietly deleted, because the failure mode is more instructive than the fix.

- **It named a mechanism it had not measured.** It asserted that `@theokit/ui@1.3.2` "declares `vite`
  as a runtime dependency", making the whole chain a third party's packaging defect. Measured:

  ```
  $ node -e "const p=require('./node_modules/@theokit/ui/package.json'); ..."
  dependencies      @radix-ui/react-dropdown-menu, class-variance-authority, clsx,
                    lucide-react, tailwind-merge, tailwindcss-animate, valibot, zod   # no vite
  peerDependencies  vite: ^6.0.0 || ^7.0.0
  peerDependenciesMeta  vite: { optional: true }
  ```

  An **optional peer** is the correct declaration for a design system that ships a Vite plugin. There
  was no packaging defect, and the "correct fix lives in another repository, which has no checkout
  here" conclusion — which is what made the deferral feel forced — followed entirely from that
  unmeasured claim.

- **It declared a local remedy impossible without checking.** `npm audit` names the remedy in its own
  output (`fix available via npm audit fix`, no `--force`, no breaking change — contrast `uuid`,
  which npm does flag as breaking). One command would have refuted the ADR before it was written.

- **What it got right, and which still holds:** `nanoid` is genuinely not in the bundle, and the
  first draft's refusal to green a report without changing shipped bytes is the right instinct. Only
  its application was wrong.

The general lesson, which is the same one B-278's own registry block already records against an
earlier reading of this item: *a rationale that is not measured is a rationale that is guessed*, and
a guess written into a signed ADR outlives the person who guessed it.

## Consequences

- `npm audit --omit=dev` on `dashboard/` reports **0 vulnerabilities**. No exemption is policing a
  known-live advisory, and there is no sunset alarm to answer in November.
- `.claude/rules/deps-audit-allowlist.txt` has no `nanoid` entry. Nothing was added and then removed
  in the released history — the entry existed only inside this unreleased slice.
- **The dev tree is not clean, and this ADR does not claim it is.** `npm audit` without `--omit=dev`
  still reports 16 findings (1 low, 3 moderate, 12 high) across `@babel/core`, `brace-expansion`,
  `extract-zip`, `fast-uri`, `ip-address`, `undici`, `uuid`, and a *different* `nanoid` range
  (`4.0.0 - 5.1.15`, reached via `estimo`). None is in the production surface and none is covered
  here; a dev-tree sweep is separate work and is registered as its own item.
- The `prismjs` MODERATE — the one that DOES ship — is not covered by this ADR. It was fixed by
  taking `react-syntax-highlighter@16.1.1`, which moves `prismjs` to 1.30.0. That bump also moves
  `refractor` from 3.6.0 to 5.0.0; it does **not** remove it, and an earlier draft of the CHANGELOG
  entry that said otherwise is corrected.

## Cross-references

- `.claude/rules/deps-audit-golden-rule.md` § 2, § 4
- `BACKLOG.md` § B-278 — the corrected measurement
- `dashboard/package-lock.json` — the three lines
