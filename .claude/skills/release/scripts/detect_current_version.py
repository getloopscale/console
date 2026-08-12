#!/usr/bin/env python3
"""Detect the version the release chain is releasing FROM (B-228).

The question has two independent parts and a command must satisfy both:

    released  =>  reachable from the release branch
    newest    =>  highest VERSION, not most recent commit

`git describe --tags --abbrev=0` satisfies neither in this branching model. Tags are cut on
the `develop -> main` merge commit and `main` is never merged back, so no release tag is an
ancestor of `workspace` or `develop` and `describe` answers with whatever tag last touched
that line — measured at v0.29.0 while the released version was v0.85.0. Pointing it at
`origin/main` fixes the first part and not the second: `describe` walks ancestry, so a hotfix
numbered below a shipped release and merged after it wins over the higher version.

Sources are therefore tried in a declared order, and the answer carries the name of the source
that produced it: a release cut from the fallback is a different confidence level than one cut
from the release branch, even when the version string is identical.

Usage:
    python3 detect_current_version.py [--ref origin/main] [--repo .] [--quiet]

Output:
    `v0.85.0 (release-branch-tag)` on stdout, or `v0.85.0` alone with --quiet, so the value
    can be piped straight into compute_next_version.py --current.

Exit codes:
    0 — printed a version (the floor `v0.0.0` is a valid answer and names itself)
    2 — the git binary is unavailable; a release must not proceed pretending otherwise
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, runtime_checkable

SEMVER_TAG_RE = re.compile(r"^v?\d+\.\d+\.\d+$")

FLOOR_VERSION = "v0.0.0"
DEFAULT_RELEASE_REF = "origin/main"


class GitCommandError(RuntimeError):
    """A git invocation failed. Recoverable: the source yields, the next one is tried."""


@runtime_checkable
class GitRunner(Protocol):
    """Runs git with the given arguments and returns stdout.

    Injected rather than called directly so the ordering logic is testable without a
    repository (`.claude/rules/architecture.md` § 2). Raises GitCommandError when git exits
    non-zero, and FileNotFoundError when git is not installed — the second is unrecoverable
    and is deliberately not caught anywhere in this module.
    """

    def __call__(self, args: Sequence[str]) -> str: ...


@dataclass(frozen=True)
class DetectedVersion:
    """A version and the name of the source that produced it."""

    version: str
    source: str

    def __str__(self) -> str:
        return f"{self.version} ({self.source})"


class VersionSource(Protocol):
    """One way of answering "what version are we releasing from"."""

    name: str

    def read(self, run: GitRunner) -> str | None: ...


def _first_semver(tag_listing: str) -> str | None:
    """First semver tag in an already version-sorted listing, ignoring the rest.

    Non-semver tags (`nightly`, `latest`, `rc-1`) are skipped rather than rejected: their
    presence is not an error, and refusing to answer because of them would be worse than
    ignoring them.
    """
    for line in tag_listing.splitlines():
        candidate = line.strip()
        if SEMVER_TAG_RE.match(candidate):
            return candidate
    return None


def _read_tags(run: GitRunner, args: Sequence[str], source_name: str) -> str | None:
    """Run a tag-listing command, downgrading a git failure to "this source has no answer"."""
    try:
        return run(args)
    except GitCommandError as exc:
        print(f"detect_current_version: {source_name} unavailable: {exc}", file=sys.stderr)
        return None


@dataclass(frozen=True)
class ReleaseBranchTag:
    """Highest semver tag REACHABLE FROM the release branch. The authoritative answer."""

    ref: str = DEFAULT_RELEASE_REF
    name: str = "release-branch-tag"

    def read(self, run: GitRunner) -> str | None:
        listing = _read_tags(
            run, ("tag", "--merged", self.ref, "--sort=-v:refname"), self.name
        )
        return _first_semver(listing) if listing is not None else None


@dataclass(frozen=True)
class HighestSemverTag:
    """Highest semver tag anywhere. Weaker: it counts tags never merged to the release branch.

    Kept as the fallback because it needs no remote ref, and a chain that cannot answer at all
    is worse than one that answers from a weaker source and names it.
    """

    name: str = "highest-semver-tag"

    def read(self, run: GitRunner) -> str | None:
        listing = _read_tags(run, ("tag", "--sort=-v:refname"), self.name)
        return _first_semver(listing) if listing is not None else None


@dataclass(frozen=True)
class FloorVersion:
    """The `v0.0.0` floor. Never returns None, which makes detection total."""

    name: str = "floor"

    def read(self, run: GitRunner) -> str | None:  # noqa: ARG002 - signature is the contract
        return FLOOR_VERSION


class VersionDetector:
    """Walks its sources in the declared order and returns the first answer, named."""

    def __init__(self, sources: Sequence[VersionSource]) -> None:
        if not sources:
            raise ValueError("VersionDetector needs at least one source")
        self._sources = tuple(sources)

    def detect(self, run: GitRunner) -> DetectedVersion:
        for source in self._sources:
            version = source.read(run)
            if version is not None:
                return DetectedVersion(version=version, source=source.name)
        # Unreachable while FloorVersion is last, and stated rather than assumed: a caller
        # that builds a detector without a total source gets a loud failure, not None.
        raise GitCommandError(
            "no version source produced an answer; the last source must be total"
        )


def default_detector(ref: str = DEFAULT_RELEASE_REF) -> VersionDetector:
    """The ordering decided in ADR D1 of the release-version-detection plan."""
    return VersionDetector([ReleaseBranchTag(ref=ref), HighestSemverTag(), FloorVersion()])


def git_runner(repo: Path | str = ".") -> GitRunner:
    """Production runner: shells out to git in `repo`."""

    def run(args: Sequence[str]) -> str:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise GitCommandError(proc.stderr.strip() or f"git {' '.join(args)} failed")
        return proc.stdout

    return run


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--ref", default=DEFAULT_RELEASE_REF, help="release branch ref")
    parser.add_argument("--repo", default=".", help="repository path")
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="print the version alone, for piping into --current",
    )
    args = parser.parse_args(argv)

    try:
        detected = default_detector(ref=args.ref).detect(git_runner(args.repo))
    except FileNotFoundError:
        print("detect_current_version: git is not installed", file=sys.stderr)
        return 2

    print(detected.version if args.quiet else str(detected))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
