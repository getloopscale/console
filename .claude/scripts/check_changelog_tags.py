#!/usr/bin/env python3
"""Every versioned CHANGELOG section must have a tag that reached the release branch.

## The defect this closes

`CHANGELOG.md` announced `## [1.0.1] - 2026-08-11`. No `v1.0.1` tag exists, locally or on the
remote. The section was written by a real `chore(release): 1.0.1` commit that reached `develop`
and never reached `main` — so the public record claimed a release that did not happen, and the
content it described was still unreleased five days later (B-268).

Nothing detected it. `cycle-release.md` has a `tag-cut` phase gate, but it guards the run that
cuts the tag; it cannot see a run that wrote the CHANGELOG and then stopped. A release chain that
halts halfway leaves the announcement behind and takes the artifact with it.

## The two directions are different defects

  section without tag  — the record announces a release that does not exist. This is the one that
                         lies to a reader, and the one B-268 was.
  tag without section  — a release shipped with nothing describing it. Bad, but it under-claims
                         rather than over-claims.

Both are reported, separately, because conflating them would hide which way the record is wrong.

## Honest limits

- The release ref defaults to `origin/main` and is read with `git tag --merged`, the same ancestry
  question `skills/release/scripts/detect_current_version.py` asks (B-228). A stale local ref gives
  a stale answer; pass `--ref` when that matters.
- It matches `## [x.y.z] - date` headers only. `[Unreleased]` is skipped by design.
- IT FAILS DURING A RELEASE, BY DESIGN, and that is worth stating before someone wires it into CI
  and is surprised. Between the CHANGELOG rewrite and the tag being cut, the newest section has no
  tag — which is precisely the state `[1.0.1]` got stuck in. The window is the defect's own shape,
  so the check cannot exempt it without exempting the thing it exists to catch. Run it BEFORE the
  rewrite and AFTER the tag; do not put it on the release PR.

- It cannot tell a legitimately yanked release from a phantom one. A yanked version needs an
  explicit marker; today there is no convention for that in this repository, so a yank would be
  reported here and should be answered by adding the convention rather than by loosening this.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

DEFAULT_RELEASE_REF = "origin/main"

# Frozen 2026-08-12, after dissolving the phantom `[1.0.1]` (8 -> 7). ONLY GOES DOWN.
#
# A ratchet rather than a hard zero, and the reason is scope honesty: `[0.80.0]` and `[0.81.0]`
# describe work that DID ship (0.82.0 and up exist), so the header is wrong but the body is
# history — and Unbreakable Rule 6 forbids editing a released entry. Deciding what those two
# should say is archaeology on 2026-06 releases, not something to do under a release gate. The
# five tags with no section are the same shape from the other direction.
#
# What the ratchet buys is the thing that was missing: a NEW phantom cannot appear in silence.
DEFAULT_CEILING = 7
SECTION = re.compile(r"^## \[(\d+\.\d+\.\d+)\]", re.MULTILINE)


@dataclass(frozen=True)
class Divergence:
    kind: str  # "section_without_tag" | "tag_without_section"
    version: str

    def __str__(self) -> str:
        if self.kind == "section_without_tag":
            return (
                f"  [{self.version}] is announced in CHANGELOG.md and no tag for it reached the "
                f"release branch — the record claims a release that did not happen"
            )
        return (
            f"  v{self.version} is tagged on the release branch and CHANGELOG.md does not "
            f"describe it — a release nobody can read about"
        )


def sections(changelog: str) -> list[str]:
    """Versioned sections, in file order. `[Unreleased]` is not one."""
    return SECTION.findall(changelog)


def released_tags(ref: str, run) -> set[str]:
    """Semver tags REACHABLE FROM the release branch — not merely tags that exist.

    A tag on an unmerged branch is not a release, which is the same distinction B-228 had to draw
    for version detection.
    """
    out = run(("tag", "--merged", ref))
    if out is None:
        return set()
    found = set()
    for line in out.splitlines():
        m = re.fullmatch(r"v?(\d+\.\d+\.\d+)", line.strip())
        if m:
            found.add(m.group(1))
    return found


def git_runner(repo: Path):
    def run(args: tuple[str, ...]) -> str | None:
        try:
            proc = subprocess.run(
                ("git", *args), cwd=repo, capture_output=True, text=True, timeout=30
            )
        except (OSError, subprocess.SubprocessError):
            return None
        return proc.stdout if proc.returncode == 0 else None

    return run


def divergences(changelog: str, tags: set[str]) -> list[Divergence]:
    declared = sections(changelog)
    out = [
        Divergence("section_without_tag", v) for v in declared if v not in tags
    ]
    described = set(declared)
    out += [Divergence("tag_without_section", v) for v in sorted(tags - described)]
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changelog", default="CHANGELOG.md")
    parser.add_argument("--ref", default=DEFAULT_RELEASE_REF, help="release branch ref")
    parser.add_argument("--repo", default=".")
    parser.add_argument(
        "--max-divergences",
        type=int,
        default=DEFAULT_CEILING,
        help="frozen count of known divergences; a new one fails the check",
    )
    args = parser.parse_args()

    path = Path(args.repo) / args.changelog
    if not path.exists():
        print(f"check_changelog_tags: {path} not found", file=sys.stderr)
        return 2

    run = git_runner(Path(args.repo))
    if run(("rev-parse", "--git-dir")) is None:
        print("check_changelog_tags: not a git repository", file=sys.stderr)
        return 2

    found = divergences(path.read_text(encoding="utf-8"), released_tags(args.ref, run))
    ceiling = args.max_divergences

    if len(found) <= ceiling:
        print(
            f"check_changelog_tags: PASS — {len(found)} known divergence(s), ceiling {ceiling} "
            f"(ref {args.ref})"
        )
        for d in found:
            print(str(d))
        if len(found) < ceiling:
            print(
                f"\nThe count went DOWN ({len(found)} < {ceiling}). Lower DEFAULT_CEILING to "
                f"{len(found)} so the slack does not become room to grow."
            )
        return 0

    print(
        f"check_changelog_tags: FAIL — {len(found)} divergence(s) against {args.ref}, "
        f"ceiling {ceiling}\n"
    )
    for d in found:
        print(str(d))
    print(
        "\nA versioned section is a public claim that a release shipped. When the release chain\n"
        "stops between the CHANGELOG rewrite and the tag, the claim outlives the release (B-268)."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
