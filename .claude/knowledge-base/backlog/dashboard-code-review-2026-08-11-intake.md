---
name: dashboard-code-review-2026-08-11-intake
generated_by: backlog-item
status: completed
date: 2026-08-11
verdicts: ITEM_REGISTERED x97, ITEM_MERGED x1
---

# Intake — dashboard code review findings

## Gates

- **G1 domain+repo resolve** — PASS. Every finding is in `theo-cloud/dashboard`, which routes to
  `frontend-dashboard` per `cycle-backlog.md § Domain routing`. Single domain, so **G3 PASS** too.
- **G2 dedup search** — RAN. File-basename collision was rejected as too coarse (`api.ts` alone
  collides with 15 open items). Semantic dedup read the colliding blocks and produced:
    - `B-128` (status `raw`, OPEN, same problem) absorbed the 8 `naming` findings → **ITEM_MERGED**,
      no new id allocated, AST quantification appended to its block.
    - `B-014` (shipped) — findings 60,61,62,63,64,71,75 break what it fixed → `regression_of: B-014`.
    - `B-129` (shipped) — findings 83..95,104,110 break a DoD bullet it shipped against →
      `regression_of: B-129`.
- **G4 verifiable DoD** — PASS. Every item carries >=2 bullets; the first is a test obligation
  (a failing test for the 11 findings the review falsified BY EXECUTION, a regression test
  otherwise), the second is the concrete remediation.
- **G5 no prior-art justification** — PASS, no reformulation needed. Every `why_now` cites our own
  `file:line` measured on 2026-08-11. No finding is justified by what another project does.

## Grill

The 4-question grill was NOT run per item. Its inputs already existed in measured form: `why_now`
is the review itself with a file:line per finding, `domain`/`repo` is single-valued across all 105,
`suggested_mode` follows from the finding's nature, and `dod` follows from the remediation every
finding already carries. Grilling 97 times would have re-derived the same answers.

## Registered

| item | finding | sev | category | mode | location |
|---|---|---|---|---|---|
| B-130 | F1 | high | completeness | review | `src/pages/auth/recovery.tsx:21` |
| B-131 | F3 | high | completeness | review | `nginx-security-headers.conf:31` |
| B-132 | F5 | high | completeness | review | `src/routes/settings-routes.tsx:51` |
| B-133 | F8 | high | completeness | review | `src/routes/profile-routes.tsx:32` |
| B-134 | F9 | high | completeness | review | `src/pages/overview/overview.tsx:154` |
| B-135 | F12 | high | completeness | review | `src/components/layout/team-switcher.tsx:126` |
| B-136 | F13 | high | completeness | review | `src/pages/settings/billing.tsx:380` |
| B-137 | F39 | high | code | review | `src/pages/infra/domains.tsx:189` |
| B-138 | F40 | high | security | review | `src/pages/auth/login.tsx:230` |
| B-139 | F41 | high | error_handling | bug | `src/lib/auth/session.ts:163` |
| B-140 | F42 | high | error_handling | bug | `src/hooks/use-auth.ts:17` |
| B-141 | F43 | high | error_handling | bug | `src/pages/auth/login.tsx:136` |
| B-142 | F44 | high | contract | review | `src/lib/http/api.ts:303` |
| B-143 | F62 | high | concurrency | bug | `src/hooks/deploy/use-sse-stream.ts:192` |
| B-144 | F63 | high | error_handling | bug | `src/hooks/deploy/use-sse-stream.ts:234` |
| B-145 | F65 | high | error_handling | bug | `src/hooks/mutations/use-cancel-build.ts:9` |
| B-146 | F83 | high | code | bug | `src/pages/promptly/components/projections.ts:77` |
| B-147 | F84 | high | error_handling | bug | `src/pages/promptly/components/projections.ts:113` |
| B-148 | F85 | high | contract | bug | `src/components/charts/category-bars.tsx:100` |
| B-149 | F86 | high | contract | bug | `src/pages/skills/overview.tsx:263` |
| B-150 | F87 | high | contract | bug | `src/pages/trust/overview.tsx:204` |
| B-151 | F88 | high | contract | bug | `src/pages/trust/overview.tsx:213` |
| B-152 | F110 | high | code | bug | `src/pages/skills/overview.test.tsx:184` |
| B-153 | F2 | medium | completeness | review | `src/lib/http/config.ts:9` |
| B-154 | F4 | medium | completeness | review | `TESTING.md:174` |
| B-155 | F6 | medium | completeness | review | `DESIGN.md:306` |
| B-156 | F7 | medium | completeness | review | `DESIGN.md:304` |
| B-157 | F10 | medium | completeness | review | `DOGFOOD.md:17` |
| B-158 | F11 | medium | completeness | review | `DOGFOOD.md:13` |
| B-159 | F15 | medium | completeness | review | `docs/architecture.md:99` |
| B-160 | F20 | medium | completeness | review | `DESIGN.md:56` |
| B-161 | F30 | medium | completeness | review | `.llms.txt:10` |
| B-162 | F38 | medium | code | review | `src/pages/workspace/overview.tsx:193` |
| B-163 | F45 | medium | concurrency | bug | `src/lib/http/api.ts:379` |
| B-164 | F46 | medium | error_handling | bug | `src/pages/auth/kratos.ts:72` |
| B-165 | F47 | medium | error_handling | bug | `src/pages/auth/recovery.tsx:240` |
| B-166 | F48 | medium | contract | review | `src/lib/http/api.ts:93` |
| B-167 | F49 | medium | contract | review | `src/lib/http/api.ts:305` |
| B-168 | F50 | medium | contract | review | `src/components/dialogs/plan-limit-upgrade-modal.tsx:55` |
| B-169 | F51 | medium | error_handling | bug | `src/pages/auth/kratos.ts:48` |
| B-170 | F52 | medium | error_handling | bug | `src/lib/auth/logout-cache-purge.ts:79` |
| B-171 | F53 | medium | contract | review | `src/hooks/use-api.ts:48` |
| B-172 | F60 | medium | concurrency | bug | `src/hooks/deploy/use-sse-stream.ts:234` |
| B-173 | F64 | medium | code | review | `src/hooks/deploy/use-sse-stream.ts:229` |
| B-174 | F66 | medium | code | review | `src/hooks/deploy/use-deploy-timeline.ts:176` |
| B-175 | F67 | medium | concurrency | bug | `src/hooks/deploy/use-build-logs.ts:211` |
| B-176 | F68 | medium | contract | review | `src/hooks/projects/use-metrics-range.ts:72` |
| B-177 | F69 | medium | code | review | `src/hooks/deploy/use-deployments-list-stream.ts:131` |
| B-178 | F70 | medium | concurrency | bug | `src/lib/mocks/handlers.ts:343` |
| B-179 | F71 | medium | contract | review | `src/hooks/deploy/use-sse-stream.ts:150` |
| B-180 | F72 | medium | contract | review | `src/hooks/deploy/use-build-logs.ts:203` |
| B-181 | F73 | medium | concurrency | bug | `src/hooks/deploy/use-deploy-timeline.ts:136` |
| B-182 | F79 | medium | complexity | evolve | `src/hooks/deploy/use-deploy-timeline.ts:138` |
| B-183 | F81 | medium | code | review | `src/pages/memory/webhooks.tsx:34` |
| B-184 | F82 | medium | code | review | `src/pages/lens/sessions.tsx:58` |
| B-185 | F89 | medium | code | review | `src/components/charts/category-bars.tsx:54` |
| B-186 | F90 | medium | code | review | `src/components/charts/category-bars.tsx:82` |
| B-187 | F91 | medium | contract | review | `src/components/charts/category-bars.tsx:95` |
| B-188 | F92 | medium | code | bug | `src/pages/memory/overview.test.tsx:158` |
| B-189 | F93 | medium | code | bug | `src/pages/skills/overview.test.tsx:184` |
| B-190 | F94 | medium | code | bug | `src/pages/trust/overview.test.tsx:39` |
| B-191 | F95 | medium | code | bug | `src/lib/capability-overview.test.ts:76` |
| B-192 | F104 | medium | code | review | `src/pages/memory/overview.tsx:255` |
| B-193 | F105 | medium | code | review | `src/pages/memory/webhooks.tsx:470` |
| B-194 | F106 | medium | code | review | `src/pages/projects/components/kpi-strip-status.tsx:74` |
| B-195 | F108 | medium | code | review | `src/pages/infra/components/delete-secret-dialog.tsx:41` |
| B-196 | F109 | medium | code | review | `src/build/manual-chunks.ts:1` |
| B-197 | F111 | medium | code | review | `src/test/arvore-estavel.ts:1` |
| B-198 | F113 | medium | code | review | `src/build/manual-chunks.ts:1` |
| B-199 | F14 | low | completeness | review | `src/components/layout/app-sidebar.tsx:42` |
| B-200 | F16 | low | completeness | review | `docs/architecture.md:112` |
| B-201 | F17 | low | completeness | review | `docs/architecture.md:16` |
| B-202 | F18 | low | completeness | review | `src/pages/memory/exports.tsx:212` |
| B-203 | F19 | low | completeness | review | `src/lib/api/types.ts:172` |
| B-204 | F21 | low | completeness | review | `DESIGN.md:126` |
| B-205 | F22 | low | completeness | review | `DESIGN.md:683` |
| B-206 | F23 | low | completeness | review | `src/routes/settings-routes.tsx:26` |
| B-207 | F24 | low | completeness | review | `DESIGN.md:809` |
| B-208 | F25 | low | completeness | review | `DESIGN.md:93` |
| B-209 | F26 | low | completeness | review | `DESIGN.md:139` |
| B-210 | F31 | low | completeness | review | `docs/adr/README.md:8` |
| B-211 | F32 | low | completeness | review | `docs/padronizacao-ui-2026-08-09.md:217` |
| B-212 | F33 | low | completeness | review | `docs/adr/0002-orcamento-de-loc-por-arquivo.md:15` |
| B-213 | F54 | low | security | review | `src/pages/auth/kratos.ts:57` |
| B-214 | F55 | low | complexity | evolve | `src/pages/auth/safe-redirect.ts:57` |
| B-215 | F56 | low | complexity | evolve | `src/lib/telemetry/error-reporter.ts:21` |
| B-216 | F57 | low | code | review | `src/pages/auth/error-mapper.ts:135` |
| B-217 | F58 | low | code | review | `src/lib/telemetry/rum.ts:30` |
| B-218 | F59 | low | code | review | `src/lib/http/api.ts:256` |
| B-219 | F61 | low | contract | review | `src/hooks/deploy/use-sse-stream.ts:25` |
| B-220 | F74 | low | contract | review | `src/hooks/deploy/shared-event-source.ts:113` |
| B-221 | F75 | low | contract | review | `src/hooks/deploy/use-sse-stream.ts:262` |
| B-222 | F76 | low | code | review | `src/hooks/deploy/use-deployment-stream.ts:177` |
| B-223 | F77 | low | code | review | `src/lib/mocks/sse.ts:163` |
| B-224 | F78 | low | code | review | `src/hooks/deploy/use-log-stream.ts:95` |
| B-225 | F80 | low | complexity | evolve | `src/hooks/projects/use-readiness-signals.ts:62` |
| B-226 | F107 | low | code | review | `src/pages/deploy/components/promote-to-production-dialog.tsx:216` |
