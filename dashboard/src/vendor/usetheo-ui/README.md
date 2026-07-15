# Vendored `@usetheo/ui` CSS token layers

These three CSS files are **vendored** copies of the design-system token layers,
taken verbatim from `@usetheo/ui`'s own Ladle preview (`usetheo-ui/.ladle/`), which
is the canonical reference for how to consume the package's Tailwind-v4 model.

## Why they are here

`@usetheo/ui@0.22` (T-A regression **#10**) stopped publishing the CSS assets the
dashboard's `src/index.css` imported (`@usetheo/ui/preset.css`, `/components.css`,
`/fonts-cdn.css`) — the package migrated to a JS Tailwind-v4 preset and no longer
ships those `.css` specifiers. That broke `vite build` for **every** consumer of the
dashboard bundle (`Missing "./preset.css" specifier in "@usetheo/ui"`), so the
served dist was stale.

Rather than downgrade `@usetheo/ui` 8 versions (which would break the component APIs
the whole dashboard uses) we vendor the token layers and let Tailwind scan the
package's compiled components (`@source '../node_modules/@usetheo/ui/dist'` in
`src/index.css`) for the utility classes they use.

| File | Source | What it is |
|---|---|---|
| `tokens.css` | `usetheo-ui/.ladle/tokens.css` | runtime `--*` CSS vars (theme cascade target) |
| `tokens-v4.css` | `usetheo-ui/.ladle/tokens-v4.css` | Tailwind v4 `@theme` namespace aliases |
| `fonts-cdn.css` | `usetheo-ui/.ladle/fonts-cdn.css` | Geist + Geist Mono via Google Fonts CDN |

## Maintenance

- These are **tokens, not logic** — do not edit values here; they mirror the design
  system. When `@usetheo/ui` publishes proper CSS exports again (fixes #10), delete
  this directory and restore the package imports in `src/index.css`.
- Keep them in sync with the installed `@usetheo/ui` version if the token layers
  change materially across a bump.
