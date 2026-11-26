# Vendored `@getloopscale/ui` CSS token layers

These three CSS files are **vendored** copies of the design-system token layers,
taken verbatim from `@getloopscale/ui`'s own Ladle preview (`loopscale-ui/.ladle/`), which
is the canonical reference for how to consume the package's Tailwind-v4 model.

## Why they are here

`@getloopscale/ui@0.22` (T-A regression **#10**) stopped publishing the CSS assets the
dashboard's `src/index.css` imported (`@getloopscale/ui/preset.css`, `/components.css`,
`/fonts-cdn.css`): the package migrated to a JS Tailwind-v4 preset and no longer
ships those `.css` specifiers. That broke `vite build` for **every** consumer of the
dashboard bundle (`Missing "./preset.css" specifier in "@getloopscale/ui"`), so the
served dist was stale.

Rather than downgrade `@getloopscale/ui` 8 versions (which would break the component APIs
the whole dashboard uses) we vendor the token layers and let Tailwind scan the
package's compiled components (`@source '../node_modules/@getloopscale/ui/dist'` in
`src/index.css`) for the utility classes they use.

| File | Source | What it is |
|---|---|---|
| `tokens.css` | `loopscale-ui/.ladle/tokens.css` | runtime `--*` CSS vars (theme cascade target) |
| `tokens-v4.css` | `loopscale-ui/.ladle/tokens-v4.css` | Tailwind v4 `@theme` namespace aliases |
| `fonts-cdn.css` | `loopscale-ui/.ladle/fonts-cdn.css` | Geist + Geist Mono via Google Fonts CDN |

## Why they are still here

`@getloopscale/ui` publishes its CSS files again, and since 0.37 they carry a different palette:
`tokens.css` declares another `--primary` from the one this dashboard ships. Importing the
package's file would repaint the product, so the copy stays until that is decided.
`src/lib/upstream-debt.test.ts` fails on the day the two files agree.

`tokens.css` is imported into `@layer theme` (see `src/index.css`), the layer the theme
provider of `@getloopscale/loopzero-ui` writes to. Outside that layer these fallbacks would
override the theme.

## Maintenance

- These are **tokens, not logic**. Do not edit values here: they mirror the design
  system. When `@getloopscale/ui` publishes proper CSS exports again (fixes #10), delete
  this directory and restore the package imports in `src/index.css`.
- Keep them in sync with the installed `@getloopscale/ui` version if the token layers
  change materially across a bump.
