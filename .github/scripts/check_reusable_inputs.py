#!/usr/bin/env python3
"""Every input passed to a cross-repo reusable workflow must be declared by that workflow.

## The defect this closes

`publish.yml` passed `git_sha` and `version_label` to
`usetheoai/theo/.github/workflows/build-publish.yml`. That workflow declares neither, so GitHub
refused the whole run at startup:

    The workflow is not valid. .github/workflows/publish.yml (Line: 134, Col: 16):
    Invalid input, git_sha is not defined in the referenced workflow.

It had worked for weeks, because the call used to point at a VENDORED COPY inside this repository
(`uses: ./.github/workflows/build-publish.yml`) which did declare both. Commit `03195817` replaced
that copy with the shared upstream one — paying down real duplication — and the two inputs the copy
had grown were not part of the upstream contract. Nothing noticed.

The cost was five consecutive `publish` runs dying in under a second, across two release tags: both
v1.0.0 and v1.0.1 exist as tags and GitHub releases with no image behind them (B-270).

## Why nothing caught it

`actionlint` exits 0 here. It validates inputs against a LOCAL reusable, and cannot fetch a
cross-repo one to compare. The failure is only visible at startup, and a `startup_failure` is
invisible to the API: `runs/{id}` carries no message and `runs/{id}/jobs` is empty because no job
was ever created. It took reading the run in a browser to see the reason at all.

That combination — silent locally, invisible over the API, fatal in production — is what earns this
check its own script rather than a note in a runbook.

## Shape

The comparison is pure and unit-tested (`undeclared_inputs`). Fetching the callee is the only I/O,
and it is isolated behind a callable so the tests never touch the network.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

# `uses: owner/repo/.github/workflows/file.yml@ref`
CROSS_REPO = re.compile(
    r"^\s*uses:\s*(?P<owner>[\w.-]+)/(?P<repo>[\w.-]+)/(?P<path>\.github/workflows/[\w.-]+)@(?P<ref>\S+)"
)


def passed_inputs(lines: list[str], uses_index: int) -> dict[str, int]:
    """Input names under the `with:` that follows a `uses:` line, mapped to 1-based line numbers.

    Reads by indentation rather than by parsing YAML: the file is already known to parse (the whole
    workflow does), and what is wanted here is the LINE of each key so the report points where the
    error will be raised.
    """
    out: dict[str, int] = {}
    uses_indent = len(lines[uses_index]) - len(lines[uses_index].lstrip())
    i = uses_index + 1
    with_indent: int | None = None

    while i < len(lines):
        line = lines[i]
        if line.strip() == "" or line.lstrip().startswith("#"):
            i += 1
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= uses_indent and with_indent is None:
            if line.strip().rstrip(":") == "with":
                with_indent = indent
                i += 1
                continue
            break
        if with_indent is None:
            i += 1
            continue
        if indent <= with_indent:
            break
        # EXACTLY one level under `with:`. The `==` is what makes a block scalar's CONTENT a value
        # rather than a list of inputs: YAML requires that content to be MORE indented than its
        # key, so `build_args: |` at `with_indent + 2` puts its lines at `+4` or deeper, outside
        # this test. Nested mapping values are excluded the same way.
        #
        # This was briefly a `>=` plus an explicit block-scalar skip. The skip was DEAD CODE — I
        # added it believing a fixture had exposed a live bug, and the fixture had actually exposed
        # an incomplete fixture. Worse, the two guards masked each other: with both present,
        # neither could be shown to matter, because removing either left the other covering. Two
        # mechanisms that cover for one another prove nothing about either, which is the same
        # criticism this repository's ratchets earned in review.
        m = re.match(r"\s*([A-Za-z_][\w-]*)\s*:", line)
        if m and indent == with_indent + 2:
            out[m.group(1)] = i + 1
        i += 1
    return out


def declared_inputs(workflow_text: str) -> set[str]:
    """Input names a reusable workflow declares under `on: workflow_call: inputs:`."""
    m = re.search(r"^on:\s*$", workflow_text, re.M)
    if m is None:
        return set()
    body = workflow_text[m.end() :]
    wc = re.search(r"^\s{2}workflow_call:\s*$", body, re.M)
    if wc is None:
        return set()
    after = body[wc.end() :]
    inp = re.search(r"^\s{4}inputs:\s*$", after, re.M)
    if inp is None:
        return set()
    names: set[str] = set()
    for line in after[inp.end() :].splitlines():
        if line.strip() == "" or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        if indent <= 4:
            break
        if indent == 6:
            m2 = re.match(r"\s*([A-Za-z_][\w-]*)\s*:", line)
            if m2:
                names.add(m2.group(1))
    return names


def undeclared_inputs(passed: dict[str, int], declared: set[str]) -> list[tuple[str, int]]:
    """The inputs that will make GitHub refuse the run, in the order they appear.

    The pure core of this check. Everything else is reading files and fetching one.
    """
    return [(name, line) for name, line in passed.items() if name not in declared]


def fetch_via_gh(owner: str, repo: str, path: str, ref: str) -> str | None:
    """The callee's text at that exact ref. `None` when it cannot be read."""
    try:
        proc = subprocess.run(
            (
                "gh",
                "api",
                f"repos/{owner}/{repo}/contents/{path}?ref={ref}",
                "--jq",
                ".content",
            ),
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    import base64

    try:
        return base64.b64decode(proc.stdout).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return None


def check_workflow(path: Path, fetch=fetch_via_gh) -> list[str]:
    problems: list[str] = []
    lines = path.read_text(encoding="utf-8").splitlines()

    for i, line in enumerate(lines):
        m = CROSS_REPO.match(line)
        if m is None:
            continue
        owner, repo, callee, ref = (m.group(k) for k in ("owner", "repo", "path", "ref"))
        passed = passed_inputs(lines, i)
        if not passed:
            continue

        text = fetch(owner, repo, callee, ref)
        if text is None:
            problems.append(
                f"  {path}:{i + 1} — could not read {owner}/{repo}/{callee}@{ref[:12]}; "
                f"inputs NOT verified (this is a gap, not a pass)"
            )
            continue

        declared = declared_inputs(text)
        for name, ln in undeclared_inputs(passed, declared):
            problems.append(
                f"  {path}:{ln} — `{name}` is not declared by "
                f"{owner}/{repo}/{callee}@{ref[:12]}. GitHub refuses the whole run at startup, "
                f"before any job exists."
            )
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default=".github/workflows")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    root = Path(args.dir)
    if not root.is_dir():
        print(f"check_reusable_inputs: {root} not found", file=sys.stderr)
        return 2

    problems: list[str] = []
    for wf in sorted(root.glob("*.yml")):
        problems.extend(check_workflow(wf))

    if args.json:
        print(json.dumps({"problems": problems}, indent=2))

    if not problems:
        print("check_reusable_inputs: PASS — every cross-repo input is declared by its callee")
        return 0

    print(f"check_reusable_inputs: FAIL — {len(problems)} problem(s)\n")
    for p in problems:
        print(p)
    print(
        "\nA `startup_failure` produces no jobs and no API-visible message. It reads as a workflow\n"
        "that never ran, which is how five consecutive publish runs went unnoticed (B-270)."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
