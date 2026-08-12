#!/usr/bin/env python3
"""Tests for `check_changelog_tags.py` — the guard that catches a phantom release.

They call the REAL functions against fixtures, never a re-implementation of the rule. The
repository has burned four times on a self-test that held a private copy of the predicate it was
supposed to prove (B-237, B-235, B-242) — a detector that can be gutted without a test falling is
not a detector.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from check_changelog_tags import (  # noqa: E402
    Divergence,
    divergences,
    released_tags,
    sections,
)

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"  PASS  {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL  {name}{': ' + detail if detail else ''}")


CHANGELOG = """## [Unreleased]

### Fixed

- something not yet shipped

## [1.0.1] - 2026-08-11

### Fixed

- a fix announced but never tagged

## [1.0.0] - 2026-08-11

### Added

- the first release
"""


def main() -> int:
    print("sections()")
    check(
        "reads versioned sections in file order",
        sections(CHANGELOG) == ["1.0.1", "1.0.0"],
        str(sections(CHANGELOG)),
    )
    check(
        "[Unreleased] is not a version",
        "Unreleased" not in "".join(sections(CHANGELOG)),
    )

    print("\ndivergences() — the defect B-268 was")
    d = divergences(CHANGELOG, {"1.0.0"})
    check(
        "a section with no tag is reported",
        d == [Divergence("section_without_tag", "1.0.1")],
        str(d),
    )
    check(
        "a section WITH a tag is not reported",
        divergences(CHANGELOG, {"1.0.0", "1.0.1"}) == [],
    )

    print("\ndivergences() — the other direction, kept distinct")
    d = divergences(CHANGELOG, {"1.0.0", "1.0.1", "0.9.0"})
    check(
        "a tag with no section is reported, and as a DIFFERENT kind",
        d == [Divergence("tag_without_section", "0.9.0")],
        str(d),
    )
    check(
        "the two kinds do not collapse into one message",
        Divergence("section_without_tag", "1.0.1").__str__()
        != Divergence("tag_without_section", "1.0.1").__str__(),
    )

    print("\ndivergences() — both at once")
    d = divergences(CHANGELOG, {"1.0.0", "0.9.0"})
    check(
        "reports each independently",
        sorted((x.kind, x.version) for x in d)
        == [("section_without_tag", "1.0.1"), ("tag_without_section", "0.9.0")],
        str(d),
    )

    print("\nreleased_tags() — ancestry, not mere existence")
    check(
        "accepts both v-prefixed and bare tags",
        released_tags("ref", lambda _a: "v1.0.0\n0.9.0\n") == {"1.0.0", "0.9.0"},
    )
    check(
        "ignores non-semver refs",
        released_tags("ref", lambda _a: "v1.0.0\nnightly\nrelease-candidate\n") == {"1.0.0"},
    )
    check(
        "a git failure yields no tags rather than a crash",
        released_tags("ref", lambda _a: None) == set(),
    )
    check(
        "asks git for tags MERGED into the ref, not every tag",
        # The B-228 distinction: a tag on an unmerged branch is not a release. If this stops
        # passing `--merged`, a phantom section would be absolved by a tag that never shipped.
        _asks_merged(),
    )

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)})")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("ALL PASS")
    return 0


def _asks_merged() -> bool:
    seen: list[tuple[str, ...]] = []

    def spy(args: tuple[str, ...]) -> str:
        seen.append(args)
        return ""

    released_tags("origin/main", spy)
    return seen == [("tag", "--merged", "origin/main")]


if __name__ == "__main__":
    sys.exit(main())
