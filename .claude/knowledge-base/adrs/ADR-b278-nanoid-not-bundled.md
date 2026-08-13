# ADR — Allowlist the `nanoid` HIGH instead of bumping it locally, because the bump would change nothing that ships

**Status:** accepted
**Date:** 2026-08-13
**Context item:** B-278 · **Sunset:** 2026-11-11 (90 days, the maximum `deps-audit-golden-rule.md § 4` permits)

## Context

`npm audit --omit=dev` on `dashboard/` reports one HIGH:

```
nanoid  HIGH  GHSA-2v37-7h3g-55p8  cvss 5.9  — custom generators loop indefinitely when size is zero
path:   @theokit/ui@1.3.2 -> vite@6.4.3 -> postcss@8.5.25 -> nanoid@3.3.16
```

`deps-audit-golden-rule.md § 2` classifies a HIGH on a declared dependency as `FAIL_INSECURE`,
which blocks `/plan-confidence`. So it has to be either fixed or explicitly exempted.

Two facts decide this ADR, and both are measured rather than argued.

1. **It is in the production tree only because another package mis-declares its dependencies.**
   `npm ls nanoid --omit=dev` shows the whole path above. `vite` is a build tool; `@theokit/ui`
   declares it as a runtime dependency, so `--omit=dev` walks into it. Nothing in
   `dashboard/package.json` asks for `vite` at runtime.
2. **It is not in the bundle.** Rollup does not put `vite` or `postcss` in the app. `nanoid` here is
   used by postcss internals during the build; no code path in `dist/` can reach it. The advisory
   describes an infinite loop in a *custom generator* invoked with size zero — a call our shipped
   code never makes because the package is not shipped.

The item's block originally said the opposite: it named `prismjs` as the HIGH and said it reached
the bundle. That was wrong on both halves and is corrected in the registry — this ADR exists partly
so the corrected reading is written where an auditor looks.

## Decision

Allowlist `nanoid <3.3.17` for 90 days, with the cause named in the entry. Do not bump it locally.
Do not force-resolve it.

## Rationale

The obvious action — add a `overrides` entry pinning `nanoid@^3.3.17` — is available and **wrong**,
for a reason worth stating plainly: it would make `npm audit` green **without changing a single byte
of what we ship**. The package is not in the bundle either way. What the override would change is
the report, and a report that improves while reality does not is the exact failure this repository
keeps registering under other names.

Alternatives considered:

- **`npm overrides` pin** — rejected, above. It buys a green number, not safety.
- **Drop `@theokit/ui`** — disproportionate. It is the design system; one mis-declared transitive
  is not a reason to remove it.
- **Fix `@theokit/ui`'s packaging** — the CORRECT fix, and it is not in this repository. The
  package has no checkout in this umbrella (`cycle-backlog § Repos an inventory names but disk does
  not`), so it is recorded here and in the registry rather than pretended into existence.
- **Say nothing and let the audit stay red** — rejected: an unexplained red is indistinguishable
  from an unexamined one, and the next person pays the same investigation.

## Consequences

- `/deps-audit` downgrades the finding by one level for 90 days. On 2026-11-11 the entry expires and
  the HIGH re-fires at full severity, which is the point of the sunset: this is a deferral with an
  alarm, not a dismissal.
- The `prismjs` MODERATE — the one that DOES ship — is not covered by this ADR. It was fixed by
  taking `react-syntax-highlighter@16.1.1`, which moves `prismjs` to 1.30.0 and drops `refractor`
  entirely.
- If `@theokit/ui` fixes its packaging before the sunset, the entry becomes dead and should be
  deleted rather than renewed.

## Cross-references

- `.claude/rules/deps-audit-golden-rule.md` § 2, § 4
- `.claude/rules/deps-audit-allowlist.txt` — the entry
- `BACKLOG.md` § B-278 — the corrected measurement
