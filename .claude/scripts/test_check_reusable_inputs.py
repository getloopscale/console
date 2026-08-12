#!/usr/bin/env python3
"""Tests for `check_reusable_inputs.py` — the guard that catches a startup failure.

They call the REAL functions against fixtures. The one piece of I/O (fetching the callee) is
injected, so nothing here touches the network — a check whose tests need GitHub to be up is a check
that gets skipped.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from check_reusable_inputs import (  # noqa: E402
    check_workflow,
    declared_inputs,
    passed_inputs,
    undeclared_inputs,
)

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    if ok:
        print(f"  PASS  {name}")
    else:
        FAILURES.append(f"{name}{': ' + detail if detail else ''}")
        print(f"  FAIL  {name}{': ' + detail if detail else ''}")


# The real shape, reduced: a matrix job calling a SHA-pinned cross-repo reusable.
CALLER = """\
jobs:
  images:
    needs: [plan]
    strategy:
      matrix:
        include: ${{ fromJSON(needs.plan.outputs.images) }}
    uses: usetheoai/theo/.github/workflows/build-publish.yml@d1f3c947
    with:
      image: ${{ matrix.image }}
      # a comment between inputs must not end the block
      trivy: true
      git_sha: ${{ github.sha }}
    secrets:
      GOMOD_TOKEN: ${{ secrets.GOMOD_TOKEN }}
"""

CALLEE = """\
name: build-publish
on:
  workflow_call:
    inputs:
      image:           { required: true,  type: string }
      trivy:           { required: false, type: boolean, default: false }
    secrets:
      GOMOD_TOKEN:
        required: false
permissions:
  contents: read
"""


def main() -> int:
    lines = CALLER.splitlines()
    uses_at = next(i for i, l in enumerate(lines) if l.lstrip().startswith("uses:"))

    print("passed_inputs()")
    passed = passed_inputs(lines, uses_at)
    check(
        "reads every input under `with:`",
        set(passed) == {"image", "trivy", "git_sha"},
        str(sorted(passed)),
    )
    check(
        "reports the LINE of each input, so the message points where GitHub will complain",
        passed["git_sha"] == 12,  # counted from the fixture, not by hand
        str(passed),
    )
    check(
        "a comment between inputs does not end the block",
        "trivy" in passed and "git_sha" in passed,
    )
    check(
        "stops at `secrets:` — a secret is not an input",
        "GOMOD_TOKEN" not in passed,
    )

    print("\ndeclared_inputs()")
    declared = declared_inputs(CALLEE)
    check("reads the callee's declared inputs", declared == {"image", "trivy"}, str(declared))
    check(
        "does NOT read the callee's secrets as inputs",
        "GOMOD_TOKEN" not in declared,
    )
    check(
        "a callee with no workflow_call declares nothing",
        declared_inputs("on:\n  push:\n    branches: [main]\n") == set(),
    )
    check(
        "a workflow_call with no inputs declares nothing",
        declared_inputs("on:\n  workflow_call:\n    secrets:\n      X:\n        required: true\n")
        == set(),
    )

    print("\nundeclared_inputs() — the pure core, and the defect B-270 was")
    check(
        "flags exactly the input the callee does not declare",
        undeclared_inputs(passed, declared) == [("git_sha", 12)],
        str(undeclared_inputs(passed, declared)),
    )
    check(
        "clean when every input is declared",
        undeclared_inputs({"image": 1}, {"image", "trivy"}) == [],
    )
    check(
        "a callee declaring MORE than is passed is fine — inputs are optional",
        undeclared_inputs({"image": 1}, {"image", "trivy", "sign"}) == [],
    )

    print("\ncheck_workflow() — end to end, with the fetch injected")
    tmp = Path(__file__).parent / ".fixture-caller.yml"
    tmp.write_text(CALLER, encoding="utf-8")
    try:
        problems = check_workflow(tmp, fetch=lambda *_a: CALLEE)
        check(
            "reports the undeclared input with file, line and callee",
            len(problems) == 1 and "git_sha" in problems[0] and "d1f3c947" in problems[0],
            str(problems),
        )

        # The honest half: an unreachable callee is a GAP, never a pass. A check that goes quiet
        # when it cannot verify is worse than no check — it reports coverage it does not have.
        problems = check_workflow(tmp, fetch=lambda *_a: None)
        check(
            "an unreadable callee is reported as unverified, not as clean",
            len(problems) == 1 and "NOT verified" in problems[0],
            str(problems),
        )
    finally:
        tmp.unlink(missing_ok=True)

    print()
    if FAILURES:
        print(f"FAILED ({len(FAILURES)})")
        for f in FAILURES:
            print(f"  - {f}")
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
