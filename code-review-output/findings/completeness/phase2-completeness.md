# Phase 2 — Completeness findings

Target: dashboard/ · 36 findings · 64 files inspected

| # | Severity | File:line | Finding |
|---|---|---|---|
| 1 | high | `src/pages/auth/recovery.tsx:21` | recovery.tsx ignores the ACCOUNTS_URL runtime config the sibling auth module honors |
| 3 | high | `nginx-security-headers.conf:31` | The shipped response-header CSP is strictly narrower than the meta CSP, silently revoking six allowances index.html documents as required |
| 5 | high | `src/routes/settings-routes.tsx:51` | Placeholder screens advertise theo CLI commands that do not exist (settings domain) |
| 8 | high | `src/routes/profile-routes.tsx:32` | Placeholder screens advertise theo CLI commands that do not exist (profile domain) |
| 9 | high | `src/pages/overview/overview.tsx:154` | Overview project cards display a hardcoded deploy branch of main for every project |
| 2 | medium | `src/lib/http/config.ts:9` | ENGINE_URL runtime config key is plumbed through four layers and read by no production code |
| 4 | medium | `TESTING.md:174` | TESTING.md documents the tree-shake gate as a grep that was proven to be a tautology |
| 6 | medium | `DESIGN.md:306` | DESIGN.md forbids rendering ANSI logs as HTML; the log viewer renders them via dangerouslySetInnerHTML |
| 7 | medium | `DESIGN.md:304` | DESIGN.md mandates @tanstack/react-virtual for log virtualization; the dependency is absent and the code rejects it by design |
| 10 | medium | `DOGFOOD.md:17` | DOGFOOD.md documents two npm scripts that do not exist (test:lighthouse, test:visual) |
| 11 | medium | `DOGFOOD.md:13` | DOGFOOD.md states a 180 KB brotli bundle cap; the enforced size-limit gate caps 320 kB |
| 12 | medium | `src/components/layout/team-switcher.tsx:126` | Create team menu item does not create a team — it opens a docs page in a new tab |
| 13 | medium | `src/pages/settings/billing.tsx:380` | Billing upgrade CTAs hardcode prices and quotas that the API already exposes |
| 15 | medium | `docs/architecture.md:99` | docs/architecture.md presents stale measurements as current fact (app.tsx 757 LoC, promptly/detail.tsx 916 LoC, 28 component subfolders) |
| 20 | medium | `DESIGN.md:56` | DESIGN.md mandates <EnvironmentBadge> on every environment-scoped screen; the component does not exist |
| 30 | medium | `.llms.txt:10` | .llms.txt at the dashboard root documents a different @usetheo/ui version and contradicts the repo lint ban on raw Alert |
| 14 | low | `src/components/layout/app-sidebar.tsx:42` | Stale TODO in app-sidebar doc comment describes a hard-coded plan tier the file no longer renders |
| 16 | low | `docs/architecture.md:112` | docs/architecture.md says eight ADRs await acceptance; there are 14 ADRs, 8 already accepted |
| 17 | low | `docs/architecture.md:16` | docs/architecture.md cites system-design-output/final_report.md as the provenance of every number; the path does not exist |
| 18 | low | `src/pages/memory/exports.tsx:212` | Four duplicate page exports, two of which are alias exports with zero importers |
| 19 | low | `src/lib/api/types.ts:172` | 84 exported types are never imported, concentrated in the API contract mirror src/lib/api/types.ts |
| 21 | low | `DESIGN.md:126` | DESIGN.md prescribes composites and an onboarding route sequence that do not exist in the codebase |
| 22 | low | `DESIGN.md:683` | DESIGN.md points UX instrumentation at src/lib/rum.ts; the module lives in src/lib/telemetry/ and ux-metrics.ts was never created |
| 23 | low | `src/routes/settings-routes.tsx:26` | Two placeholder routes are unreachable from navigation and duplicate screens that already shipped |
| 24 | low | `DESIGN.md:809` | DESIGN.md Cross-references section points at four knowledge-base paths that do not exist |
| 25 | low | `DESIGN.md:93` | DESIGN.md § 3 dependency-reach measurements are stale (183 vs 231 importers; 3 vs 5 files) |
| 26 | low | `DESIGN.md:139` | DESIGN.md file:line pointers into the source are stale (index.css, top-bar.tsx, settings.tsx/profile.tsx) |
| 31 | low | `docs/adr/README.md:8` | docs/adr/README.md contradicts itself on the ADR range and points at the wrong path for the nomenclature gate |
| 32 | low | `docs/padronizacao-ui-2026-08-09.md:217` | docs/padronizacao-ui-2026-08-09.md still prescribes P1/P2 work that has already been executed, and references a deleted file |
| 33 | low | `docs/adr/0002-orcamento-de-loc-por-arquivo.md:15` | Three different sizes are given for the max-lines allowlist (ADR-0002 says 32, architecture.md says 18, eslint.config.js says 18 while listing 15) |
| 27 | info | `src/components/layout/app-sidebar-menus.ts:144` | no_completeness_issues: placeholder review-date markers are all current |
| 28 | info | `src/pages/projects/components/signal-detail-sheet.tsx:89` | no_completeness_issues: no dead controls found in the src/pages and src/components sweep |
| 29 | info | `src/pages/projects/project-status.tsx:74` | no_completeness_issues: no commented-out code blocks and no unreachable branches |
| 34 | info | `package.json:6` | no_completeness_issues: package.json scripts all resolve |
| 35 | info | `TESTING.md:84` | no_completeness_issues: TESTING.md render-helper and DOGFOOD.md journey inventory verified against source |
| 36 | info | `docs/adr/README.md:13` | no_completeness_issues: ADR decisions 0003, 0004, 0010, 0012, 0014 verified as implemented |

## Detail

### [1] HIGH — recovery.tsx ignores the ACCOUNTS_URL runtime config the sibling auth module honors

**Location:** `src/pages/auth/recovery.tsx:21`

src/lib/http/config.ts exports ACCOUNTS_URL (line 36) as a first-class runtime config key, populated by docker-entrypoint.sh:41 and declared in the TheoConfig interface. src/pages/auth/kratos.ts:8 consumes it correctly with an explicit documented rationale at kratos.ts:5-6: "Prefer dedicated ACCOUNTS_URL (Kratos may live at accounts.theo.dev in prod while API lives at api.theo.dev). Falls back to API_URL for same-origin dev." src/pages/auth/recovery.tsx:21 declares a LOCAL const with the SAME NAME shadowing that intent, assigned unconditionally from API_URL. Because the shadowed name is identical, the divergence is invisible at the two call sites (recovery.tsx:202 and recovery.tsx:392) that read it. Both sites do a full-page window.location.href navigation, so the failure is not a recoverable fetch error: in the exact deployment topology ACCOUNTS_URL exists to describe (Kratos on a separate origin), password recovery navigates the browser to the API origin instead of the accounts origin. Span: recovery.tsx:21 (declaration), :202 and :392 (uses).

**Evidence**

> src/pages/auth/recovery.tsx:19-21 — import { API_URL } from '@/lib/http/config'; / const ACCOUNTS_URL = API_URL;  ||  src/pages/auth/kratos.ts:7-8 — import { API_URL, ACCOUNTS_URL as CONFIG_ACCOUNTS_URL } from '@/lib/http/config'; / const ACCOUNTS_URL = CONFIG_ACCOUNTS_URL || API_URL;  ||  grep of ACCOUNTS_URL across non-test src/ returns exactly these two declaration sites.

**Remediation**

Replace recovery.tsx:19-21 with the kratos.ts form (import ACCOUNTS_URL as CONFIG_ACCOUNTS_URL; const ACCOUNTS_URL = CONFIG_ACCOUNTS_URL || API_URL), or import the resolved value from kratos.ts so one module owns the fallback. Why: the recovery flow must reach the same origin as every other Kratos self-service flow, and today it provably does not when the two origins differ.

### [3] HIGH — The shipped response-header CSP is strictly narrower than the meta CSP, silently revoking six allowances index.html documents as required

**Location:** `nginx-security-headers.conf:31`

The app ships TWO Content-Security-Policies: a <meta> policy baked into index.html:52 and a response-header policy from nginx-security-headers.conf:31 (included at five locations in nginx.conf). Per the CSP spec, when multiple policies are delivered a resource must be permitted by ALL of them — the effective policy is the intersection, i.e. the narrower header wins on every directive where they disagree. They disagree on six: (1) connect-src — meta allows auth-dev.usetheo.dev, cloud-dev.usetheo.dev, storage.usetheo.dev, storage-dev.usetheo.dev, checkout.stripe.com, *.stripe.com, ws:, wss:; the header allows only self + auth.usetheo.dev + cloud.usetheo.dev. (2) form-action — meta allows auth-dev.usetheo.dev; the header does not. (3) img-src — meta allows blob: and https:; the header allows only self + data:. (4) style-src — meta allows fonts.googleapis.com; the header does not. (5) font-src — meta allows data: and fonts.gstatic.com; the header allows only self. (6) script-src matches (both self), so the one directive the guard test covers is the one directive that cannot drift. index.html is not silent about the intent behind the entries the header revokes: lines 23-28 state data:/blob:/https: in img-src cover avatars, base64 favicons, S3 assets, lines 41-46 state connect-src includes auth.usetheo.dev because the init flow GET XHR reads the flow JSON and cloud.usetheo.dev needed for post-login /v1/auth/session/token JWT exchange, and lines 48-51 state CSP extended to allow auth-dev.usetheo.dev + cloud-dev.usetheo.dev so the dashboard hosted at app-dev.usetheo.dev can complete the same flows against the dev-public Kratos/cloud. app-dev.usetheo.dev is this project declared live target (.claude/rules/live-target.txt), so the header policy blocks the auth flow on the one environment the project measures against. Related: the Dockerfile:7-8 claims config is injected at runtime, making the image environment-independent (same commit = same artifact), yet both policies hardcode environment hostnames at image-build time, so the image is not in fact environment-independent for any origin outside the baked allowlists.

**Evidence**

> nginx-security-headers.conf:31 — add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://auth.usetheo.dev https://cloud.usetheo.dev; ..." always;  ||  index.html:52 — <meta http-equiv="Content-Security-Policy" content="... img-src 'self' data: blob: https:; connect-src 'self' ws: wss: https://checkout.stripe.com https://*.stripe.com https://auth.usetheo.dev https://auth-dev.usetheo.dev https://cloud.usetheo.dev https://cloud-dev.usetheo.dev https://storage.usetheo.dev https://storage-dev.usetheo.dev; ..." />  ||  nginx.conf:13,51,71,78,86 — include /etc/nginx/security-headers.conf;  ||  src/build/csp.test.ts asserts only that script-src lacks 'unsafe-inline' in index.html and dist/index.html — it never compares the two policies, so the drift is unguarded.

**Remediation**

Derive both policies from one source of truth (generate the nginx snippet from the same directive list the meta uses, or drop the meta and keep only the header) and extend src/build/csp.test.ts to assert directive-by-directive that the header policy is not narrower than the meta. Why: two hand-maintained copies of a security policy diverge silently, and the intersection semantics mean the divergence surfaces as unexplained runtime blocking rather than as a build error.

### [5] HIGH — Placeholder screens advertise theo CLI commands that do not exist (settings domain)

**Location:** `src/routes/settings-routes.tsx:51`

SubPagePlaceholder renders the copy "Use the CLI below to do this today" plus a copyable CodeBlock with the cliCommand prop. In src/routes/settings-routes.tsx three of the four placeholder routes pass commands that are NOT registered in the theo CLI (verified against theo-platform/theo-cli): (a) /settings/billing offers `theo billing status` — the billing command registers only the `portal` subcommand plus a bare default action (theo-cli/src/register/infra.ts:338-395), there is no `status` subcommand; (b) /settings/notifications offers `theo notify list` — `notify` is not a top-level command (registered set: audit, auth, billing, build, cancel, connect, deploy, disconnect, doctor, domain, env, login, logout, logs, preview, project, promote, rollback, scale, secret, status, storage, team, validate, whoami); (c) /settings/danger offers `theo team delete --confirm` — the team command registers list/add/remove/role/switch only (theo-cli/src/register/team.ts:17-148), no delete. Only /settings/members (`theo team list`) is real. The escape hatch IS the honesty of the placeholder pattern: a user who copies the command gets an unknown-command error, strictly worse than the blank page the pattern was built to avoid. The same convention gets it right elsewhere — src/app.tsx:180-186 deliberately omits cliCommand for /databases, commenting that inventing one would be "mentir de forma mais convincente que a ausencia".

**Evidence**

> src/routes/settings-routes.tsx:51  cliCommand="theo billing status"
> src/routes/settings-routes.tsx:89  cliCommand="theo notify list"
> src/routes/settings-routes.tsx:106 cliCommand="theo team delete --confirm"
> src/pages/sub-page-placeholder.tsx:49 description="This screen is part of the navigation but the full UI is still being built. Use the CLI below to do this today."
> theo-cli/src/register/team.ts:17,21,51,82,112,148 -> team | list | add | remove | role | switch (no delete)

**Remediation**

Either drop cliCommand for these three routes (the /databases precedent in src/app.tsx:180 is the governed answer), or replace each with a command that exists. Add a guard to placeholder-honesty.test.ts asserting every cliCommand names a command registered by theo-cli, so a fabricated escape hatch fails the suite the way a fabricated route already does.

### [8] HIGH — Placeholder screens advertise theo CLI commands that do not exist (profile domain)

**Location:** `src/routes/profile-routes.tsx:32`

Same defect class as the settings domain, but here ALL THREE placeholder routes fabricate their CLI escape hatch. /profile/security offers `theo login --rotate-credentials` — the login command registers --token, --team, --refresh-token, --expires-in, --device-flow (theo-cli/src/register/auth.ts:21-36); there is no --rotate-credentials flag, and commander will reject the unknown option. /profile/sessions offers `theo session list` and /profile/danger offers `theo account delete --confirm` — neither `session` nor `account` is a registered top-level theo command. The screen tells the user this is what they can do TODAY from the terminal; every one of these three fails at the shell. Verified against theo-platform/theo-cli by enumerating program.command(...) across src/register/*.ts.

**Evidence**

> src/routes/profile-routes.tsx:32 cliCommand="theo login --rotate-credentials"
> src/routes/profile-routes.tsx:49 cliCommand="theo session list"
> src/routes/profile-routes.tsx:66 cliCommand="theo account delete --confirm"
> theo-cli registered top-level commands: audit, auth, billing, build, cancel, connect, deploy, disconnect, doctor, domain, env, login, logout, logs, preview, project, promote, rollback, scale, secret, status, storage, team, validate, whoami — no session, no account
> theo-cli/src/register/auth.ts:21-36 login options: --token, --team, --refresh-token, --expires-in, --device-flow

**Remediation**

Drop cliCommand on all three profile placeholders (matching the governed /databases precedent in src/app.tsx:180) until the corresponding CLI commands ship, and extend placeholder-honesty.test.ts with a cliCommand-exists assertion.

### [9] HIGH — Overview project cards display a hardcoded deploy branch of main for every project

**Location:** `src/pages/overview/overview.tsx:154`

The Overview screen maps each project into a ProjectCard with branch literally set to the string main. ProjectCard renders that value verbatim (node_modules/@usetheo/ui/dist/index.js:6040 renders project.branch), so a project whose deploy branch is develop, release, or anything else is shown to the user as main. This is not a loading or empty state — it is fabricated data presented with the same visual weight as the real fields next to it (name, commit, status). The in-code comment acknowledges it as a legacy placeholder pending wire exposure of deploy_branch, but nothing in the rendered UI signals uncertainty; there is no em-dash, no tooltip, no skeleton — the pattern the rest of this codebase uses for unknown values (see kpi-strip-status.tsx formatNullable, which renders an em-dash rather than pretending).

**Evidence**

> src/pages/overview/overview.tsx:144-154
>   // #120 (qa-dogfood-cleanup-2026-06-21 T4.1 / ADR-Q3):
>   // hardcoded 'main' is the legacy placeholder until
>   // the wire payload exposes `deploy_branch` for the listing.
>   branch: 'main',
> node_modules/@usetheo/ui/dist/index.js:6040  project.branch  (rendered verbatim by ProjectCard)

**Remediation**

Until the projects summary payload exposes deploy_branch, render an honest unknown state rather than a plausible wrong one — pass an em-dash or omit the branch line entirely, consistent with the codebase-wide null-to-em-dash convention. When the wire field lands, bind it and delete the literal.

### [2] MEDIUM — ENGINE_URL runtime config key is plumbed through four layers and read by no production code

**Location:** `src/lib/http/config.ts:9`

ENGINE_URL is declared in the TheoConfig interface (src/lib/http/config.ts:9), defaulted in getConfig (config.ts:23), written by the container entrypoint (docker-entrypoint.sh:39), validated by validate_url (docker-entrypoint.sh:32), shipped as a non-empty dev default (public/__config.js:4 — "/engine"), and mirrored in 8 test mock objects. It is never exported from config.ts and never read by any production module. The /engine prefix it appears to configure is instead HARDCODED at src/lib/http/api.ts:315 (cloudFetch(`/engine${path}`)). Two consequences beyond the dead key itself: (1) an operator reading docker-entrypoint.sh reasonably concludes VITE_ENGINE_URL is a supported deployment knob, sets it, and observes no effect; (2) the value the dev default uses ("/engine", a same-origin path) would be REJECTED by validate_url (docker-entrypoint.sh:15-21 accepts only http:// or https:// or empty), so the key is not merely dead but unusable in the shape its own default demonstrates.

**Evidence**

> src/lib/http/config.ts:9 — ENGINE_URL: string;  (interface field, no corresponding `export const ENGINE_URL`, unlike API_URL:32, AUTH_URL:34, ACCOUNTS_URL:36)  ||  docker-entrypoint.sh:39 — ENGINE_URL: "${VITE_ENGINE_URL:-}",  ||  public/__config.js:4 — ENGINE_URL: "/engine",  ||  src/lib/http/api.ts:315 — return cloudFetch<T>(`/engine${path}`, options, cfg);  ||  grep -rn ENGINE_URL over non-test src/ yields only config.ts declarations and mock-comment mentions — zero readers.

**Remediation**

Either delete ENGINE_URL from the interface, the entrypoint, __config.js and the 8 test mocks, or make api.ts:315 read it (export const ENGINE_URL, default "/engine") and relax validate_url to accept a leading-slash path. Why: a config key an operator can set and that silently does nothing is worse than no key at all.

### [4] MEDIUM — TESTING.md documents the tree-shake gate as a grep that was proven to be a tautology

**Location:** `TESTING.md:174`

TESTING.md:174-181 tells a new contributor that `npm run tree-shake-check` greps the production bundle for the string `lib/mocks` and fails if found. That check no longer exists: it was deleted precisely because it could never fail. scripts/check-mocks-tree-shaken.mjs opens with the post-mortem (B-067/B-068) and now asserts two string sentinels (`__theo_mocks_present_in_bundle__` and `choose_method`) instead. A contributor who trusts TESTING.md will believe the gate proves something the current gate proves differently, and — worse — could reinstate the grep as a `fix` if the sentinels ever look odd.

**Evidence**

> TESTING.md:174-181 — "The CI gate `npm run tree-shake-check` greps the prod bundle for `lib/mocks` strings" / "! grep -q 'lib/mocks' dist/assets/*.js"  ||  scripts/check-mocks-tree-shaken.mjs:7-16 — "O `tree-shake-check` anterior era: grep -q 'lib/mocks' dist/assets/*.js. Ele procurava o caminho do modulo, e o empacotador apaga caminhos. Medido em 2026-08-08: injetei `installAllMocks` em `main.tsx`, os mocks foram para o bundle de producao, e o check imprimiu PASS."  ||  scripts/check-mocks-tree-shaken.mjs:43-68 — MARCAS = [{marca: '__theo_mocks_present_in_bundle__'}, {marca: 'choose_method'}]

**Remediation**

Rewrite TESTING.md § VITE_USE_MOCKS to describe the sentinel-marker gate (two markers, one per mock framework, plus the source-presence pre-check), and delete the `grep -q lib/mocks` snippet so nobody restores it.

### [6] MEDIUM — DESIGN.md forbids rendering ANSI logs as HTML; the log viewer renders them via dangerouslySetInnerHTML

**Location:** `DESIGN.md:306`

DESIGN.md is declared the locked single source of truth (DESIGN.md:3-5) and its LogViewer performance contract states ANSI codes are stripped via `strip-ansi` and must NEVER be rendered as HTML. The shipped implementation does the opposite: it converts ANSI to HTML with the `ansi-to-html` dependency and injects the result with `dangerouslySetInnerHTML`. The implementation documents a real mitigation (escapeXML plus an adversarial test) and is a deliberate, reasoned choice — the divergence is that the locked design contract still bans it. A reviewer applying DESIGN.md literally would reject the current code, and an engineer copying the ansi.tsx pattern to another surface without escapeXML would ship an XSS sink while believing DESIGN.md forbids only the naive form.

**Evidence**

> DESIGN.md:306 — "ANSI escape codes stripped via `strip-ansi` (NEVER render as HTML)."  ||  src/pages/deploy/components/ansi.tsx:1 — "import Convert from 'ansi-to-html';"  ||  src/pages/deploy/components/ansi.tsx:65 — "return <span dangerouslySetInnerHTML={{ __html: html }} />;"  ||  src/pages/deploy/components/ansi.tsx:21-24 — "`ansi-to-html` was chosen over ... `strip-ansi` (loses color)"  ||  package.json:73 — "ansi-to-html": "^0.7.2" declared; no strip-ansi dependency exists

**Remediation**

Update DESIGN.md § 7.3 to record the actual decision (ansi-to-html with `escapeXML: true` plus the adversarial test) and restate the ban as `never render unescaped ANSI-to-HTML output`, or open an ADR that supersedes the clause. Either way the locked contract and the code must state the same rule.

### [7] MEDIUM — DESIGN.md mandates @tanstack/react-virtual for log virtualization; the dependency is absent and the code rejects it by design

**Location:** `DESIGN.md:304`

DESIGN.md § 7.3 lists virtualized rendering with `@tanstack/react-virtual` above 1000 lines as a hard performance requirement of the LogViewer. The dependency is not declared in package.json, and log-viewer.tsx documents a measured decision NOT to use it (jsdom cannot lay out, 14 assertions would break, accessibility loss when nodes are removed), choosing native `content-visibility: auto` instead. The locked design doc still asserts the rejected option, so an engineer implementing a new large list will add a dependency the team decided against.

**Evidence**

> DESIGN.md:304 — "Virtualized rendering (`@tanstack/react-virtual`) for >1000 lines."  ||  src/pages/deploy/components/log-viewer.tsx:86-89 — "A escada da parcimonia respondeu antes da biblioteca. `@tanstack/react-virtual` NAO esta instalado (verificado no package.json)"  ||  src/pages/deploy/components/log-viewer.tsx:57-61 — "Renderiza ate MAX_LOG_LINES (5000) sem remover nos do DOM: o custo ... e pago por `content-visibility`"  ||  package.json:60-91 — dependencies block contains no @tanstack/react-virtual

**Remediation**

Replace the § 7.3 virtualization bullet with the content-visibility decision actually shipped (and cite log-viewer.tsx), or record an ADR that keeps virtualization as the target and marks the current implementation as an accepted deviation.

### [10] MEDIUM — DOGFOOD.md documents two npm scripts that do not exist (test:lighthouse, test:visual)

**Location:** `DOGFOOD.md:17`

The DOGFOOD runbook — the document a release engineer follows before declaring a release ready — lists `npm run test:lighthouse` and `npm run test:visual` in its quick reference. Neither script exists in package.json (scripts are: dev, build, preview, lint, typecheck, test, test:watch, postinstall, size, size:why, bundle:analyze, storybook, storybook:build, tree-shake-check, test:e2e). Running either yields `Missing script`, so the release checklist silently cannot be completed as written. Section 6 of the same document concedes the visual-regression vendor is still an open decision, which confirms `test:visual` was never implemented.

**Evidence**

> DOGFOOD.md:17-18 — "npm run test:lighthouse           # Lighthouse CI against dev server with mocks" / "npm run test:visual               # Visual regression (vendor TBD)"  ||  package.json:6-22 — scripts block has no test:lighthouse and no test:visual  ||  DOGFOOD.md:124 — "## 6. Visual regression — vendor decision OPEN"

**Remediation**

Either add the two scripts (lighthouse: `lhci autorun --config=./lighthouserc.json`, which already has a config file; visual: whichever vendor is chosen) or delete the two lines from the quick reference and keep only the manual `npx lhci autorun` instructions already present in § 5.

### [11] MEDIUM — DOGFOOD.md states a 180 KB brotli bundle cap; the enforced size-limit gate caps 320 kB

**Location:** `DOGFOOD.md:13`

DOGFOOD.md declares the bundle budget twice — in the quick reference and as a release acceptance criterion — as 180 KB brotli. The gate that actually runs (`npm run size` → size-limit) declares a TOTAL EAGER hard gate of 320 kB across the four modulepreloaded chunks, plus per-chunk limits summing to 335 KB. A release reviewer using DOGFOOD.md would either block a compliant build or, if they trust the doc without running the tool, believe a much tighter budget is being enforced than is.

**Evidence**

> DOGFOOD.md:13 — "npm run size                      # size-limit cap (180 KB brotli)"  ||  DOGFOOD.md:173 — "- [ ] Production build green + bundle <180 KB brotli cap"  ||  package.json:50-57 — {"name": "TOTAL EAGER — HARD GATE (os 4 chunks com modulepreload no index.html, brotli)", "limit": "320 kB"}

**Remediation**

Update both DOGFOOD.md lines to cite the size-limit configuration as the single source of the budget (TOTAL EAGER 320 kB) rather than restating a number that drifts, e.g. "npm run size — budget enforced by package.json#size-limit".

### [12] MEDIUM — Create team menu item does not create a team — it opens a docs page in a new tab

**Location:** `src/components/layout/team-switcher.tsx:126`

The TeamSwitcher dropdown ends with a Plus-icon item labelled Create team, which reads as the affordance that creates a team. Its onSelect calls the optional onCreateTeam prop when provided; the sole caller (src/components/layout/app-sidebar.tsx:142 renders <TeamSwitcher fallbackName={userName} />) does NOT pass it, so the default branch always runs in production and simply opens https://docs.usetheo.dev/teams/create in a new tab. The user clicks a create control and gets documentation. The code comment is honest about it ("directs to CLI until backend POST /v1/teams ships") but nothing in the UI is: no external-link icon, no coming-soon marker, no copy change — unlike the governed comingSoon convention this repo applies to every other unshipped surface (app-sidebar-menus.ts, placeholder-honesty.test.ts).

**Evidence**

> src/components/layout/team-switcher.tsx:126-138
>   <DropdownMenu.Item onSelect={() => { if (onCreateTeam) { onCreateTeam(); } else {
>     // Default: directs to CLI until backend POST /v1/teams ships
>     window.open('https://docs.usetheo.dev/teams/create', '_blank');
>   } }}>
>     <Plus className="size-4" aria-hidden="true" />
>     <span>Create team</span>
> src/components/layout/app-sidebar.tsx:142  <TeamSwitcher fallbackName={userName} />   // onCreateTeam never supplied

**Remediation**

Relabel the item to match what it does (e.g. How to create a team) with an external-link icon, or mark it with the same coming-soon treatment used elsewhere, until POST /v1/teams ships. Once the endpoint exists, wire onCreateTeam at the app-sidebar call site and delete the docs fallback.

### [13] MEDIUM — Billing upgrade CTAs hardcode prices and quotas that the API already exposes

**Location:** `src/pages/settings/billing.tsx:380`

The BillingPage upgrade cards embed the price and the quota copy as literals: "Upgrade to Pro — $29/mo" with "10 projects, 3 environments, 1000 builds/month", and "Upgrade to Team — $99/mo". The same product surface already derives price from the API elsewhere: src/pages/overview/components/overview-kpi-strip.tsx:15-17 defines formatPlanPrice(pp) computing pp.amount_minor / 100 from an OverviewPlanPrice the backend returns, and its test asserts 2900 -> $29/mo and 9900 EUR -> EUR 99/mo. So the wire carries the authoritative price while the checkout CTA — the one place where a wrong number costs money and trust — states it from a literal. Any Stripe price change, currency, or regional plan silently desynchronizes the dashboard from what the user is actually charged, with no test that can catch it. The quota line has the same problem: the current-plan quota rows immediately above (billing.tsx:331-343) come from billing.usage limits, the target-plan quotas do not.

**Evidence**

> src/pages/settings/billing.tsx:374-384
>   aria-label="Upgrade to Pro — $29 per month"
>   ...
>   Upgrade to Pro — $29/mo
>   10 projects, 3 environments, 1000 builds/month
> src/pages/settings/billing.tsx:394-400  aria-label="Upgrade to Team — $99 per month" / Upgrade to Team — $99/mo
> src/pages/overview/components/overview-kpi-strip.tsx:15-17  export function formatPlanPrice(pp: OverviewPlanPrice | null): string { ... const amount = pp.amount_minor / 100;

**Remediation**

Bind the upgrade CTAs to the plan catalogue the API already returns (reuse formatPlanPrice from overview-kpi-strip rather than duplicating the formatting), and render the target-plan quotas from the same source as the current-plan rows. If the catalogue is not yet exposed for non-current plans, that is the wire gap to file — do not leave a price literal in the checkout path.

### [15] MEDIUM — docs/architecture.md presents stale measurements as current fact (app.tsx 757 LoC, promptly/detail.tsx 916 LoC, 28 component subfolders)

**Location:** `docs/architecture.md:99`

docs/architecture.md opens by asserting "Nada aqui e estimativa" (line 13) and then builds its argument on three numbers that no longer hold. app.tsx is cited as 757 lines to justify ADR-0002; it is 226. pages/promptly/detail.tsx is cited as the extreme case at 916 LoC with 15 useState and 9 useQuery; it is 465. src/components is described as having 28 subfolders with a single index.ts; it has 9 subfolders (still one index.ts). The document is the repository architecture contract, so a new engineer reading it will go looking for decomposition work that was already done and will mis-size the residence-rule migration. The failure mode is the exact one the document itself diagnoses in line 25 about unverified metrics.

**Evidence**

> docs/architecture.md:99 — "`app.tsx` tem 757 linhas — 49 a mais que o `trace-detail.tsx`" vs `wc -l src/app.tsx` = 226  ||  docs/architecture.md:106 — "`pages/promptly/detail.tsx`, 916 LOC num unico componente com 15 `useState` e 9 `useQuery`" vs `wc -l src/pages/promptly/detail.tsx` = 465  ||  docs/architecture.md:53 — "Hoje existe **um** (`components/layout/index.ts` ...) nas **28** subpastas de `src/components/`" vs `find src/components -mindepth 1 -type d | wc -l` = 9  ||  docs/architecture.md:25 cites `components/lens/ask-thread.tsx`; that directory no longer exists (file is now src/pages/lens/components/ask-thread.tsx)

**Remediation**

Re-run the measurements and either refresh the table or date-stamp each number inline ("medido 2026-08-06, nao re-medido"). Given the doc is cited as the architecture contract, prefer regenerating the numbers from a script that can be re-run, so drift is visible in a diff.

### [20] MEDIUM — DESIGN.md mandates <EnvironmentBadge> on every environment-scoped screen; the component does not exist

**Location:** `DESIGN.md:56`

DESIGN.md § 2.1 is a safety clause: every screen that operates on a specific environment MUST show an environment badge (red PROD / yellow STAGING / blue PREVIEW / gray DEV) in the TopBar context and on every action button context, implemented as the `<EnvironmentBadge env={env}>` composite. Grepping the whole src/ tree for `EnvironmentBadge`, `EnvBadge`, `environment-badge` and `env-badge` returns zero hits — production and test files alike. The clause that is supposed to keep an operator from firing a destructive action against production while believing they are in staging has no implementation and no substitute under any of the obvious names.

**Evidence**

> DESIGN.md:47 — "Every screen that operates on a specific environment MUST show the environment badge"  ||  DESIGN.md:56 — "Implementation: `<EnvironmentBadge env={env}>` composite (T4.6 from plan)."  ||  `grep -rln "EnvironmentBadge\|EnvBadge\|environment-badge\|env-badge" src/` returns no files

**Remediation**

Either implement the composite and wire it into TopBar plus the action-button contexts, or downgrade § 2.1 from MUST to a recorded gap with an owner. Do not leave a MUST-level safety clause with zero implementation and no test.

### [30] MEDIUM — .llms.txt at the dashboard root documents a different @usetheo/ui version and contradicts the repo lint ban on raw Alert

**Location:** `.llms.txt:10`

.llms.txt sits at the dashboard root and declares itself the factual ground truth an LLM should treat as non-negotiable contract. It is in fact the upstream @usetheo/ui library manifest for version 0.9.0-next.0, describing that package repo layout (src/components/primitives/**), its scripts (pnpm quality:gates, Ladle, Biome) and its component inventory — none of which exist in the dashboard. The dashboard installs @usetheo/ui ^0.35.1, a different release line, and DESIGN.md:93 also states 0.35.1. Concretely misleading: .llms.txt:96 and :106 present `Alert` as a shipped 0.9 primitive to use, while eslint.config.js bans importing `Alert` from @usetheo/ui outright because the raw component silently drops a children body (upstream #175) and routes consumers to @/components/ui/alert-guard. An agent primed by .llms.txt writes the exact import the repo lint rejects.

**Evidence**

> .llms.txt:10 — "**Current version:** `0.9.0-next.0` (npm dist-tag `next`; latest release line)" vs package.json:72 — "@usetheo/ui": "^0.35.1"  ||  .llms.txt:5 — "Treat the bullets below as non-negotiable contracts"  ||  .llms.txt:96 lists **`alert`** (NEW 0.9) among primitives to use  ||  eslint.config.js:42-44 — importNames: ['Alert'] ... "Import Alert from '@/components/ui/alert-guard' — the raw @usetheo/ui Alert silently drops a `children` body (#175)"  ||  .llms.txt:150-153 declares quality-gate command `pnpm quality:gates`, Ladle stories and Biome — none present in this repo (package.json uses vitest, storybook, eslint)

**Remediation**

Move the upstream manifest out of the dashboard root (or rename to something explicitly upstream, e.g. docs/vendor/usetheo-ui.llms.txt) and, if a dashboard .llms.txt is wanted, write one describing this repo. At minimum pin the version line to the version actually installed and add the alert-guard exception.

### [14] LOW — Stale TODO in app-sidebar doc comment describes a hard-coded plan tier the file no longer renders

**Location:** `src/components/layout/app-sidebar.tsx:42`

The AppSidebar doc block carries the codebase-wide sole genuine TODO: plan tier hard-coded to hobby, to be resolved when BillingPage wires /v1/billing tier. The code it describes is gone — app-sidebar.tsx contains no occurrence of hobby, plan, or tier outside this comment, and the only tier literal left in src/ is the legitimate PLAN_TIER_MAP lookup in settings/billing.tsx:97-104, which is API-driven. The sidebar renders TeamSwitcher (name + team slug + role badge) and no plan badge at all. The TODO therefore points a reader at work that either already landed or was silently dropped, and it survives every TODO sweep as a false signal of outstanding work.

**Evidence**

> src/components/layout/app-sidebar.tsx:42-43
>  * Plan tier currently hard-coded to "hobby" (EC-14 v1.1 acknowledged TODO —
>  * resolves when BillingPage wires /v1/billing tier).
> $ grep -niE "plan|tier" src/components/layout/app-sidebar.tsx  -> only lines 42-43 (the comment itself)
> $ grep -rn "hobby" src --include=*.tsx --include=*.ts | grep -v .test. -> src/pages/settings/billing.tsx:100 (PLAN_TIER_MAP, API-driven) and the comment above

**Remediation**

Delete lines 42-43 if the plan badge was intentionally removed from the sidebar; if a plan badge is still wanted there, restore it bound to the /v1/billing tier and keep the TODO only until that binding lands.

### [16] LOW — docs/architecture.md says eight ADRs await acceptance; there are 14 ADRs, 8 already accepted

**Location:** `docs/architecture.md:112`

The section "Onde as decisoes vivem" tells the reader that docs/adr/ holds eight ADRs, all in status: proposed and awaiting team acceptance. The directory now holds 14 ADRs of which 8 are status: accepted (0001, 0003, 0004, 0010, 0011, 0012, 0013, 0014) and 6 are proposed (0002, 0005, 0006, 0007, 0008, 0009). A reader following this doc treats binding, accepted decisions — including the organisation axis of ADR-0001 that the same document depends on — as drafts.

**Evidence**

> docs/architecture.md:112 — "`docs/adr/`. Oito ADRs em `status: proposed`, aguardando aceite do time"  ||  `head -3` of each file in docs/adr/ shows status: accepted in 0001, 0003, 0004, 0010, 0011, 0012, 0013, 0014 and status: proposed in 0002, 0005, 0006, 0007, 0008, 0009 (14 files total)

**Remediation**

Replace the count with a pointer to docs/adr/README.md (which already carries the index) and state only the invariant: "o aceite e do time". A count restated in two places drifts by construction.

### [17] LOW — docs/architecture.md cites system-design-output/final_report.md as the provenance of every number; the path does not exist

**Location:** `docs/architecture.md:16`

The document states twice that all its measurements come from the /loop-system-design audit whose report lives at system-design-output/final_report.md. No such path exists anywhere under theo-cloud (searched to depth 3, excluding node_modules). Since the doc explicitly grounds its authority on that report ("Nada aqui e estimativa"), none of its figures can be re-verified by a reader — which is how the stale numbers in the same file went unnoticed.

**Evidence**

> docs/architecture.md:16 — "cujo relatorio esta em `system-design-output/final_report.md`"  ||  docs/architecture.md:123 — "Relatorio completo em `system-design-output/final_report.md`"  ||  `find /home/paulo/Projetos/theo/theo-platform/theo-cloud -maxdepth 3 -name system-design-output -not -path "*/node_modules/*"` returns nothing

**Remediation**

Commit the report (or its summary) under .claude/knowledge-base/audits/ and update both citations, or mark the numbers as unverifiable-by-reference and re-derive them with a committed script.

### [18] LOW — Four duplicate page exports, two of which are alias exports with zero importers

**Location:** `src/pages/memory/exports.tsx:212`

Aggregated finding for the 4 duplicate exports knip reports. Two are pure dead aliases: src/pages/memory/exports.tsx:212 exports MemoryExportsPage = ExportsPage and src/pages/memory/playground.tsx:284 exports MemoryPlaygroundPage = PlaygroundPage; grepping the whole tree for those two identifiers outside their defining files returns nothing, so both are unreferenced re-namings kept alive only by being exported. The other two are named + default export pairs on the same symbol (src/pages/promptly/create.tsx:26 and :210; src/pages/promptly/diff.tsx:72 and :235), which gives the lazy-route registry two equally valid import spellings for one page — the kind of ambiguity that lets a future route file import the default while a test imports the named binding and neither notices they diverged.

**Evidence**

> src/pages/memory/exports.tsx:212   export const MemoryExportsPage = ExportsPage;
> src/pages/memory/playground.tsx:284 export const MemoryPlaygroundPage = PlaygroundPage;
> $ grep -rn "MemoryExportsPage|MemoryPlaygroundPage" src --include=*.ts --include=*.tsx (excluding the two defining files) -> no matches
> src/pages/promptly/create.tsx:26 export function PromptlyCreatePage() / :210 export default PromptlyCreatePage;
> src/pages/promptly/diff.tsx:72 export function PromptlyDiffPage() / :235 export default PromptlyDiffPage;

**Remediation**

Delete the two unreferenced aliases. For create.tsx and diff.tsx, pick one export style and align them with the rest of src/pages (the named export, which app-routes-lazy already consumes) and drop the default.

### [19] LOW — 84 exported types are never imported, concentrated in the API contract mirror src/lib/api/types.ts

**Location:** `src/lib/api/types.ts:172`

Aggregated finding for the 84 unused exported types knip reports. The dominant concentration is src/lib/api/types.ts, a 861-line hand-maintained mirror of the Go API structs with 72 exported declarations. An independent cross-check (every exported interface/type name grepped across src/ excluding its own file) confirms a large unused subset, notably the whole family of write-path input shapes: ProjectCreateInput (:172), BuildCreateInput (:253), EnvironmentCreateInput (:359), DomainCreateInput (:408), SecretSetInput (:433), TeamMemberInput (:457), TeamMemberRoleUpdate (:462), PreviewCreateInput (:491), RollbackInput (:608), PromoteInput (:617), ProjectConnectInput (:649), TeamSwitchInput (:49), plus AppSBOMSummary (:279), LogStreamEvent (:318), DomainTLS (:393), DomainVerification (:398), ScaleAutoscaling (:585), BillingPlanPrice (:712). Every mutation in the app therefore sends a body typed somewhere other than the declared contract, which is exactly the drift the file header says it exists to prevent ("single source of truth for API shapes ... so drift is visible in code review"). This is type-level only — no runtime impact — but the file is not doing the job it claims.

**Evidence**

> src/lib/api/types.ts:1-5  // TypeScript types mirroring Go API structs ... single source of truth for API shapes
> src/lib/api/types.ts:172 export interface ProjectCreateInput {
> src/lib/api/types.ts:457 export interface TeamMemberInput {
> $ wc -l src/lib/api/types.ts -> 861 ; grep -c "^export" -> 72
> $ per-name grep across src/ excluding types.ts -> 0 importers for the 18 declarations listed above

**Remediation**

Decide per type: either wire the input shapes into the corresponding mutation hooks (so the declared contract actually types the request bodies), or delete the ones no longer mirrored by the Go API. Leaving them exported-but-unused keeps a contract file that no compiler check can hold to the truth.

### [21] LOW — DESIGN.md prescribes composites and an onboarding route sequence that do not exist in the codebase

**Location:** `DESIGN.md:126`

DESIGN.md § 3.2 lists anchor composites required per surface type, and § 8 prescribes a seven-step onboarding sequence as routes. `BuildStepList` and `CanaryProgress` appear nowhere in src/. None of the seven /onboarding/* routes exists — src/routes/ contains no onboarding route file and no route path matches /onboarding. The only onboarding artifact is src/components/onboarding/onboarding-panel.tsx, an in-page panel, not the routed flow. An engineer told to use these anchors will grep, find nothing, and either invent a divergent component or assume the doc describes a different codebase.

**Evidence**

> DESIGN.md:126-127 — "| Deploy progress | `DeployTimeline` + `BuildStepList` |" / "| Canary | `CanaryProgress` |"  ||  `grep -rl BuildStepList src/` and `grep -rl CanaryProgress src/` return zero files (DeployTimeline returns 7)  ||  DESIGN.md:315-322 lists /onboarding/{welcome,github,repo,configure,deploy,streaming,success}  ||  `grep -rn onboarding src/routes/*.tsx src/app.tsx` returns nothing; ls src/components/onboarding/ shows only onboarding-panel.tsx

**Remediation**

Split DESIGN.md into what is contracted-and-shipped versus what is still target state, marking each unbuilt item with its backlog id. A locked contract that mixes both is unusable as a review gate.

### [22] LOW — DESIGN.md points UX instrumentation at src/lib/rum.ts; the module lives in src/lib/telemetry/ and ux-metrics.ts was never created

**Location:** `DESIGN.md:683`

DESIGN.md § 17 says instrumentation lives in `cloud/dashboard/src/lib/rum.ts` plus a new `lib/ux-metrics.ts`. The Web Vitals module is at src/lib/telemetry/rum.ts (with src/lib/telemetry/rum.test.ts); src/lib/rum.ts does not exist, and no ux-metrics module exists anywhere. Every metric in § 17.1-17.3 (time-to-first-deploy, clicks-to-rollback, rage clicks, dead clicks) is therefore documented as instrumented but has no capture point, and § 17 opens with "If we do not measure, we are opining".

**Evidence**

> DESIGN.md:683 — "Instrumentation lives in `cloud/dashboard/src/lib/rum.ts` (Web Vitals already wired) + new `lib/ux-metrics.ts` (planned T4.7)."  ||  `ls src/lib/` shows no rum.ts and no ux-metrics.ts; `ls src/lib/telemetry/` shows error-reporter.ts, error-reporter.test.ts, rum.ts, rum.test.ts  ||  `grep -rl ux-metrics src/` returns zero files

**Remediation**

Fix the path to src/lib/telemetry/rum.ts and mark the § 17.1-17.3 metrics as not-yet-captured (with backlog ids) instead of implying instrumentation exists.

### [23] LOW — Two placeholder routes are unreachable from navigation and duplicate screens that already shipped

**Location:** `src/routes/settings-routes.tsx:26`

/settings/members and /settings/billing render SubPagePlaceholder (Members is coming soon / Billing settings is coming soon), but neither path appears in app-sidebar-menus.ts: the Settings group deliberately points Members at /team and Billing at /billing, both of which are fully built screens (app-sidebar-menus.ts:209-210, with the rationale at :200-203). The two placeholder routes are therefore reachable only by typing the URL or following a stale bookmark, and when reached they tell the user a shipped capability is coming soon. placeholder-honesty.test.ts explicitly permits an out-of-menu placeholder ("uma rota em placeholder pode legitimamente ficar FORA do menu"), so the guard cannot catch this case — but that carve-out was written for capabilities with no real screen, not for ones that already exist elsewhere.

**Evidence**

> src/routes/settings-routes.tsx:26-38  <Route path="/settings/members" ... <SubPagePlaceholder title="Members" ...
> src/routes/settings-routes.tsx:43-55  <Route path="/settings/billing" ... <SubPagePlaceholder title="Billing settings" ...
> src/components/layout/app-sidebar-menus.ts:209-210  { label: 'Members', path: '/team' }, { label: 'Billing', path: '/billing' }
> src/lib/placeholder-honesty.test.ts:46-47  "Nao exige o contrario: uma rota em placeholder pode legitimamente ficar FORA do menu"

**Remediation**

Replace both routes with <Navigate to="/team" replace /> and <Navigate to="/billing" replace /> (the same treatment /api-keys already gets at src/app.tsx:173), so an old bookmark lands on the working screen instead of a coming-soon page for a shipped feature.

### [24] LOW — DESIGN.md Cross-references section points at four knowledge-base paths that do not exist

**Location:** `DESIGN.md:809`

The closing Cross-references block of the locked design contract routes the reader to the AS-IS audit, the remediation plan, the edge-case review and the C4 architecture docs. Three of the four paths do not exist under theo-cloud/.claude/knowledge-base (there is no audits/2026-05-25/ directory, no plan file matching 2026-05-25-dashboard-faang-*, and no architecture/ directory at all; a repo-wide search for *faang* returns nothing). Since DESIGN.md refers to the remediation plan by task id throughout (T1.4, T2.10, T3.5, T4.1, T4.6, T4.7), none of those task references can be resolved by anyone reading the document today.

**Evidence**

> DESIGN.md:809-812 cites `.claude/knowledge-base/audits/2026-05-25/dashboard-faang-review.md`, `.claude/knowledge-base/plans/2026-05-25-dashboard-faang-remediation-plan.md`, `.claude/knowledge-base/plans/2026-05-25-dashboard-faang-remediation-edge-cases.md`, `.claude/knowledge-base/architecture/dashboard/`  ||  `ls theo-cloud/.claude/knowledge-base/` = adrs audits backlog discoveries grills implementations plans reviews roadmap-runs (no architecture/)  ||  `ls .claude/knowledge-base/audits/2026-05-25/` = no such directory  ||  `find theo-cloud -name "*faang*" -not -path "*/node_modules/*"` returns nothing  ||  DOGFOOD.md:147-149 cites the same missing audit file

**Remediation**

Either restore the referenced artifacts under .claude/knowledge-base/ or strip the dead citations and the T-numbers that depend on them, replacing each with the ADR or backlog id that survives.

### [25] LOW — DESIGN.md § 3 dependency-reach measurements are stale (183 vs 231 importers; 3 vs 5 files)

**Location:** `DESIGN.md:93`

DESIGN.md § 3 presents the two-package split as a measured fact dated 2026-08-08: @usetheo/ui imported by 183 files and @theokit/ui confined to 3 files / 4 symbols. Measured now: 231 files import @usetheo/ui and 8 TypeScript files reference @theokit/ui (main.tsx, test/render.tsx, lib/theme/theo-theme.ts, pages/settings/billing.tsx, pages/overview/overview.tsx plus three test files), i.e. 5 non-test modules. The narrative conclusion — that the surfaces are disjoint and there is nothing to consolidate — is not invalidated, but the containment claim for @theokit/ui is weaker than the doc states, and the doc gives no way to tell.

**Evidence**

> DESIGN.md:93-94 — "| `@usetheo/ui` | `0.35.1` | components | 183 files import it |" / "| `@theokit/ui` | `1.3.2` | the theme ... | 3 files, 4 symbols |"  ||  `grep -rl "@usetheo/ui" src/ | wc -l` = 231  ||  `grep -rln "@theokit/ui" src/` = src/main.tsx, src/test/render.tsx, src/lib/theme/theo-theme.ts, src/pages/settings/billing.tsx, src/pages/overview/overview.tsx, src/index.primary-token.test.ts, src/pages/lens/traces.test.tsx, src/pages/lens/compare.test.tsx, src/pages/lens/traces/columns-toggle.test.tsx

**Remediation**

Turn the containment claim into an executable check (a test asserting the @theokit/ui importer set) rather than a number in prose; the doc already states the split is only defensible while the surface stays small.

### [26] LOW — DESIGN.md file:line pointers into the source are stale (index.css, top-bar.tsx, settings.tsx/profile.tsx)

**Location:** `DESIGN.md:139`

Four DESIGN.md clauses anchor themselves to specific source coordinates that no longer point at what the clause describes. Motion tokens are cited at index.css:113-119 but live at 108-114; the reduced-motion block is cited at index.css:122-136 but starts at 181; the accessibility clause cites a non-semantic heading at top-bar.tsx:67 which is now a Select.Trigger with aria-label; the danger-zone anti-pattern cites a setTimeout(1500) fake at settings.tsx:13-21 and profile.tsx:30-40, but there is no src/pages/settings.tsx and profile.tsx:32-45 performs a real DELETE /api/v1/tenants/{id}. Individually cosmetic, collectively they make the locked contract unusable as a review pointer.

**Evidence**

> DESIGN.md:139 "`--motion-{instant,fast,base,slow}` in `index.css:113-119`" vs src/index.css:108 `--motion-instant: 0ms;` .. :111 `--motion-slow: 320ms;`  ||  DESIGN.md:466 "Already partially done in `cloud/dashboard/src/index.css:122-136`" vs src/index.css:181 `@media (prefers-reduced-motion: reduce) {`  ||  DESIGN.md:492 "NOT `<span>` like current `top-bar.tsx:67`" vs src/components/layout/top-bar.tsx:65-67 `<Select.Trigger aria-label="Select project" ...>`  ||  DESIGN.md:663 "the exact smoking gun in `settings.tsx:13-21` + `profile.tsx:30-40`" vs src/pages/settings/profile.tsx:31-40 "SG-05 CLOSED ... replaced setTimeout fake with real DELETE /api/v1/tenants/{id}" and no src/pages/settings.tsx exists

**Remediation**

Drop the line numbers and cite symbols/files only, or add a doc-link test (the repo already has this pattern in src/lib/*.test.ts) that fails when a cited path stops resolving.

### [31] LOW — docs/adr/README.md contradicts itself on the ADR range and points at the wrong path for the nomenclature gate

**Location:** `docs/adr/README.md:8`

The ADR index states the directory holds files 0001 through 0009 while the table immediately below it lists 14 ADRs (0001-0014), all of which exist on disk. The same file tells the reader that the gate preventing new `ADR D<n>` citations lives at docs/adr/adr-nomenclature.test.ts; the test is at src/lib/adr-nomenclature.test.ts (the docs/adr/ directory contains only markdown). Both are one-line fixes, but the second means a contributor who wants to check or raise the ceiling cannot find the gate.

**Evidence**

> docs/adr/README.md:8 — "Arquivos neste diretorio: `0001-…` a `0009-…`." vs docs/adr/README.md:13-26 listing ADR-0001..ADR-0014, and `ls docs/adr/` showing 0001..0014 plus README.md  ||  docs/adr/README.md:62 — "`docs/adr/adr-nomenclature.test.ts` falha se a contagem de `ADR D<n>` no codigo crescer" vs actual location src/lib/adr-nomenclature.test.ts (verified: `find . -name "*nomenclature*"` = ./src/lib/adr-nomenclature.test.ts)

**Remediation**

Change line 8 to "0001-… a 0014-…" (or drop the range, since the table below is the index) and correct the test path to src/lib/adr-nomenclature.test.ts.

### [32] LOW — docs/padronizacao-ui-2026-08-09.md still prescribes P1/P2 work that has already been executed, and references a deleted file

**Location:** `docs/padronizacao-ui-2026-08-09.md:217`

The UI-standardisation report carries no superseded marker and reads as current guidance, but its central recommendation is done: P2 required deleting components/ui/dialog.tsx and migrating its call sites, and the file no longer exists (the only remaining `ui/dialog` occurrences in src/ are prose comments recording the migration). Its measured table is correspondingly stale: dialog.tsx is described at 97 LoC (deleted), app-modal.tsx at 104 LoC (now 148), and the codebase at 423 .tsx files (now 434). A reader who starts at this document begins a migration that is finished and looks for a primitive that is gone.

**Evidence**

> docs/padronizacao-ui-2026-08-09.md:217 — "### P2 — Migrar os 14 call sites de pagina e remover `ui/dialog`"; :230 — "**Pronto quando:** `components/ui/dialog.tsx` e deletado e a suite passa."  ||  `wc -l src/components/ui/dialog.tsx` = "Arquivo ou diretorio inexistente"; `ls src/components/ui/ | grep -i dialog` returns nothing  ||  `grep -rln "ui/dialog" src/` returns only files where the string appears inside comments (redeploy-dialog.tsx:63, confirm-dialog.test.tsx:138, redeploy-dialog.test.tsx:99, modal-primitive.test.ts, promote-to-production-dialog.test.tsx)  ||  doc:54 "`components/ui/dialog.tsx` (97 LoC) e `components/ui/app-modal.tsx` (104 LoC)" vs `wc -l src/components/ui/app-modal.tsx` = 148  ||  doc:10 "423 arquivos `.tsx`" vs `find src -name "*.tsx" | wc -l` = 434

**Remediation**

Add a status header to the document (executed / superseded, with the commit or backlog ids that closed P1-P3) or move it under a docs/history/ directory. A dated measurement report is fine; a dated report that still reads as an open work order is not.

### [33] LOW — Three different sizes are given for the max-lines allowlist (ADR-0002 says 32, architecture.md says 18, eslint.config.js says 18 while listing 15)

**Location:** `docs/adr/0002-orcamento-de-loc-por-arquivo.md:15`

The LoC-budget rule is described with a different allowlist size in every place it is written down. ADR-0002 (status: proposed) decides on an explicit allowlist of the 32 files then exceeding 500 lines. docs/architecture.md states 18. eslint.config.js — the executable rule — says in its own comment "Os 18 arquivos que hoje excedem estao listados" but enumerates 15 paths, and its worked example ("O caso mais gritante que a lista expoe e `src/app.tsx`") names a file that is no longer in the list and is now 226 lines. The rule itself works; what is unreliable is every prose statement of its size, including the one inside the config.

**Evidence**

> docs/adr/0002-orcamento-de-loc-por-arquivo.md § Decisao — "acompanhado de uma **allowlist explicita dos 32 arquivos atuais** que excedem o limite"  ||  docs/architecture.md:67 — "| `max-lines` (B-033) | 500 LOC por arquivo, com allowlist de 18 arquivos que carrega o LOC de cada um. |"  ||  eslint.config.js:222 — "Esta regra NAO pede refactor: ela trava a divida onde esta. Os 18 arquivos que hoje excedem estao listados" vs eslint.config.js:253-267 which lists 15 paths  ||  eslint.config.js:227-230 cites src/app.tsx as the flagship allowlist entry; app.tsx is absent from the list and is 226 lines

**Remediation**

Let the allowlist be its own source of truth: remove the count from the eslint comment and from architecture.md, and mark ADR-0002 as superseded-in-part by the B-033 implementation (which is what src/lib/loc-budget-ratchet.test.ts already enforces).

### [27] INFO — no_completeness_issues: placeholder review-date markers are all current

**Location:** `src/components/layout/app-sidebar-menus.ts:144`

Audited every PLACEHOLDER marker in src/ (9 occurrences across src/routes/settings-routes.tsx, src/routes/profile-routes.tsx, src/app.tsx:180, src/components/layout/app-sidebar-menus.ts:144). All carry an explicit review date — 2026-11-06 for the B-082 settings/profile set and 2026-11-07 for Databases — and today is 2026-08-11, so NONE has expired. Every marker also states the review outcome contract (ship it or remove it together with the nav entry) and every SubPagePlaceholder passes a non-generic description of what the screen will do. The comingSoon menu flags are consistent with the placeholder routes that appear in the menu (Databases, /settings/notifications, /settings/danger, /profile/security, /profile/sessions, /profile/danger), which is what placeholder-honesty.test.ts asserts. NOTE: the review-date and marker discipline is clean; the cliCommand content of these same placeholders is NOT — filed separately as two high findings.

**Evidence**

> src/components/layout/app-sidebar-menus.ts:144  // PLACEHOLDER · revisar ate 2026-11-07.
> src/routes/settings-routes.tsx:22,39,77,94  PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
> src/routes/profile-routes.tsx:20,37,54       PLACEHOLDER · rastreio B-082 · revisar ate 2026-11-06.
> src/app.tsx:180                              PLACEHOLDER · revisar ate 2026-11-07.

**Remediation**

None required before 2026-11-06.

### [28] INFO — no_completeness_issues: no dead controls found in the src/pages and src/components sweep

**Location:** `src/pages/projects/components/signal-detail-sheet.tsx:89`

Swept every non-test, non-story .tsx under src/pages and src/components for interactive elements that render as functional but do nothing. Method: (1) regex for empty handlers — onClick={() => {}}, => null, => undefined, => void 0, => {} — zero hits outside three .catch(() => {}) telemetry fire-and-forget calls in auth/login.tsx:136 and auth/register.tsx:110,119 (error-swallowing is a phase-3 concern, not a dead control); (2) a brace-aware parse of every <Button>/<button> opening tag, flagging any without onClick, type=submit, asChild, href, or spread props — 4 hits, all legitimate on inspection: signal-detail-sheet.tsx:89 and rag/connectors.tsx:357 are deliberately disabled with an explanatory aria-label and adjacent helper text ("Select a collection to enable the providers"), team-switcher.tsx:54 is a DropdownMenu.Trigger asChild target, and billing.tsx:357 was a false positive inside a comment; (3) every <form> without onSubmit — 3 hits, all correct (bulk-delete-projects-dialog.tsx:105 and app-modal.tsx use the native form= attribute to bind a footer submit button rendered outside the form, a pattern the file documents at :80-84). Disabled controls consistently pair with an explanation.

**Evidence**

> src/pages/projects/components/signal-detail-sheet.tsx:89-98  <Button ... disabled aria-label="Grafana deep-link not configured">
> src/pages/rag/connectors.tsx:357-373  disabled provider buttons + "Select a collection to enable the providers."
> src/pages/projects/components/bulk-delete-projects-dialog.tsx:94-105  <Button type="submit" form="bulk-delete-projects-form"> bound to <form id=...>

**Remediation**

None.

### [29] INFO — no_completeness_issues: no commented-out code blocks and no unreachable branches

**Location:** `src/pages/projects/project-status.tsx:74`

Swept src/pages, src/components, src/hooks and src/lib for disabled-code comments (lines beginning with // followed by const/let/return/if/import/export/function/JSX/closing braces/await/useEffect/setState) and for statically-unreachable conditions (if (false), if (true), || true, && false, returns after throw). Zero commented-out code blocks of any length, let alone the >5-line kind. The one line that pattern-matches — src/pages/projects/project-status.tsx:88 — is inside an 18-line explanatory block that documents a hook call which was REMOVED rather than commented out, and states verbatim "a chamada a useStatusStream foi REMOVIDA daqui, nao comentada"; the single // const ... line is a usage example for whoever reintroduces it. Zero unreachable branches: the only match was src/hooks/use-auth.ts:75 return null (a reachable loading guard). Comment density in this codebase is high but the content is rationale, not disabled code.

**Evidence**

> src/pages/projects/project-status.tsx:74  // B-051 — a chamada a useStatusStream foi REMOVIDA daqui, nao comentada.
> src/pages/projects/project-status.tsx:88  //   const { signals, connected } = useStatusStream(name, status?.environment);  <- documented reintroduction example, inside that block
> src/hooks/use-auth.ts:75  if (!checked) return null; // Still loading  <- reachable

**Remediation**

None.

### [34] INFO — no_completeness_issues: package.json scripts all resolve

**Location:** `package.json:6`

Audited every entry of package.json#scripts against the filesystem. All referenced files exist and every tool is a declared dependency: scripts/check-guard-pairs.mjs (lint), scripts/check-mocks-tree-shaken.mjs (tree-shake-check), e2e/tsconfig.json (typecheck second pass), playwright.config.ts (test:e2e), patch-package (postinstall, devDependency), size-limit + @size-limit/preset-app (size, size:why), rollup-plugin-visualizer (bundle:analyze), storybook + @storybook/react-vite (storybook, storybook:build), vitest (test). No documented-but-unparsed flag and no script pointing at a missing file. The only script-level divergence found is on the documentation side (DOGFOOD.md advertises test:lighthouse and test:visual, filed separately).

**Evidence**

> ls scripts/ = check-guard-pairs.mjs, check-mocks-tree-shaken.mjs  ||  ls e2e/tsconfig.json = present (extends ../tsconfig.json, include: ["."])  ||  playwright.config.ts, vitest.config.ts present at root  ||  patch-package, size-limit, @size-limit/preset-app, rollup-plugin-visualizer, storybook, @storybook/react-vite, vitest all in devDependencies (package.json:92-123)

**Remediation**

None.

### [35] INFO — no_completeness_issues: TESTING.md render-helper and DOGFOOD.md journey inventory verified against source

**Location:** `TESTING.md:84`

Verified the two documentation claims most likely to mislead a new contributor and found both correct. TESTING.md § Render helper describes @/test/render as providing QueryClientProvider (retry:false, gcTime:0), NuqsAdapter, ThemeProvider, Toaster, MemoryRouter with initialEntries and PageMetaProvider — src/test/render.tsx provides exactly that chain, with the documented test-client options. DOGFOOD.md § 1 tabulates 11 journey test names in src/test/e2e-journeys.test.tsx; all 11 exist in the file with the exact names given. The two-layer mock pattern described in TESTING.md also matches the codebase (hook-level vi.mock plus lib-level @/lib/api mocks).

**Evidence**

> TESTING.md:88-97 lists the provider chain; src/test/render.tsx:36-54 renders QueryClientProvider > ThemeProvider > Toaster > MemoryRouter > NuqsAdapter > PageMetaProvider, with makeTestQueryClient() at :26-32 setting retry:false and gcTime:0  ||  DOGFOOD.md:29-39 lists journey_1..journey_8b; `grep -o "journey_[a-z0-9_]*" src/test/e2e-journeys.test.tsx | sort -u` returns exactly those 11 names

**Remediation**

None.

### [36] INFO — no_completeness_issues: ADR decisions 0003, 0004, 0010, 0012, 0014 verified as implemented

**Location:** `docs/adr/README.md:13`

Cross-checked the accepted ADRs whose decisions are mechanically verifiable against current code and found no contradiction. ADR-0003 (theme has a single owner): src/lib/theme/theo-theme.ts exists and is imported by both src/main.tsx and src/test/render.tsx. ADR-0004 (service worker keeps asset rules, API cache leaves): vite.config.ts imports SW_RUNTIME_CACHING and BFF_NAVIGATION_DENYLIST from src/build/, keeping the denylist and the runtime-caching table in one place. ADR-0010 (nuqs for typed filters, useSearchParams for point reads — do not migrate): both remain in use (8 files with useQueryState, 31 with useSearchParams). ADR-0012 (React Compiler stays on): vite.config.ts:90 still registers babel-plugin-react-compiler. ADR-0014 (do not split lib/http/api.ts; rename logout to clearTokenAcrossTabs): api.ts is 456 lines, under the 500 budget, and exports clearTokenAcrossTabs at :282, consumed by lib/auth/session.ts:140. The architecture.md honesty table also holds: madge, dependency-cruiser and eslint-plugin-import are still absent from package.json, and eslint.config.js carries three no-restricted-imports blocks as claimed.

**Evidence**

> src/lib/theme/theo-theme.ts present; imported at src/test/render.tsx:7 and by src/main.tsx  ||  vite.config.ts:15-16 imports BFF_NAVIGATION_DENYLIST and SW_RUNTIME_CACHING; :166-167 wires both  ||  `grep -rl useQueryState src/ | wc -l` = 8, `grep -rl useSearchParams src/ | wc -l` = 31  ||  vite.config.ts:90 — ["babel-plugin-react-compiler", {}]  ||  wc -l src/lib/http/api.ts = 456; src/lib/http/api.ts:282 export function clearTokenAcrossTabs(); src/lib/auth/session.ts:140-141 imports and calls it  ||  `grep -c "madge|eslint-plugin-import|dependency-cruiser" package.json` = 0; eslint.config.js:129,162,189 are the three no-restricted-imports blocks

**Remediation**

None.
