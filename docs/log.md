---
type: Log
title: theo-cloud docs bundle history
---

# Bundle history

## 2026-08-05

- **Created** the bundle by converting the nine documents already under `docs/` into OKF v0.2
  concepts, in place. Every body was preserved unchanged; frontmatter, a root and per-folder
  `index.md`, this log, and the cross-links were added.
- **Moved** six documents into folders that name their kind — `governance/`, `products/`,
  `architecture/`, `roadmaps/`, `handoffs/` — and flattened `meetings/records/` to `meetings/`.
  `operations/` and `releases/` kept their paths. All moves went through `git mv`, so history
  follows the files.
- **Crawl boundary.** The bundle covers `docs/` only. Documents this repository's knowledge
  depends on but does not contain are cited in prose and NOT absorbed as concepts: the plans and
  ADRs under `.claude/knowledge-base/`, the engine repo's `theo/.claude/rules/` mandates, and the
  cross-repo handoffs in `theo-data/` and `theo-workspace/`. Their paths appear in concept bodies
  as written references, not as concept links, because the targets are outside this bundle.
- **Converted four dead hyperlinks to prose references** in `governance/dashboard.md`. They pointed at
  `.claude/knowledge-base/...` and `docs/handoff/...` paths that resolve in the *engine* repository, not
  here — the document's own provenance note records that the historical plans stayed behind at M5. None
  of the four targets exists in this repository, so each rendered as navigable while leading nowhere.
  The visible text was already the path in backticks, so removing the link syntax changed nothing a
  reader sees and removed a false promise a traversing agent would follow.
- **Provenance is honest about what it can prove.** Each concept records `generated.by` as the
  agent that produced the concept document, never as a person — the prose is the team's, the OKF
  encoding is the agent's. No `verified` event was added, because nobody has confirmed the
  converted documents yet. `sources[].last_modified` comes from this repository's git history.
