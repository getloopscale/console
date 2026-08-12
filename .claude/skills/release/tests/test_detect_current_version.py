"""Tests for detect_current_version.py — the release chain's version-detection step (B-228).

The unit tests below cover the ORDERING of sources with a fake runner. They are deliberately
not the evidence that the fix works: a fake returns whatever it was told, so it would have been
just as green against `git describe`, the command that caused the defect. The tests that carry
evidentiary weight build real repositories and live at the bottom of this file.
"""
from __future__ import annotations

import subprocess
from collections.abc import Sequence
from pathlib import Path

import pytest

from detect_current_version import (  # noqa: E402
    DetectedVersion,
    FloorVersion,
    GitCommandError,
    HighestSemverTag,
    ReleaseBranchTag,
    VersionDetector,
    default_detector,
    git_runner,
)


class FakeGit:
    """A git runner driven by a table of `args-substring -> stdout`.

    A key that maps to a GitCommandError makes that invocation fail, which is how the
    absence of `origin/main` is simulated without deleting anything real.
    """

    def __init__(self, responses: dict[str, str | Exception]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, ...]] = []

    def __call__(self, args: Sequence[str]) -> str:
        self.calls.append(tuple(args))
        joined = " ".join(args)
        for key, value in self._responses.items():
            if key in joined:
                if isinstance(value, Exception):
                    raise value
                return value
        raise GitCommandError(f"no fake response for: {joined}")


def test_release_branch_tag_is_preferred_when_present() -> None:
    run = FakeGit({"--merged": "v0.85.0\nv0.84.0\n", "tag --sort": "v9.9.9\n"})

    result = default_detector().detect(run)

    assert result == DetectedVersion(version="v0.85.0", source="release-branch-tag")


def test_falls_back_to_highest_semver_tag_when_release_branch_absent() -> None:
    run = FakeGit(
        {
            "--merged": GitCommandError("fatal: malformed object name origin/main"),
            "tag --sort": "v0.85.0\nv0.84.0\n",
        }
    )

    result = default_detector().detect(run)

    assert result == DetectedVersion(version="v0.85.0", source="highest-semver-tag")


def test_falls_back_to_floor_when_no_tags_exist() -> None:
    run = FakeGit({"--merged": "", "tag --sort": ""})

    result = default_detector().detect(run)

    assert result == DetectedVersion(version="v0.0.0", source="floor")


def test_non_semver_tags_are_ignored() -> None:
    """A repo tagged `nightly` and `latest` alongside `v0.3.0` resolves the semver one."""
    run = FakeGit({"--merged": "nightly\nlatest\nv0.3.0\n"})

    result = default_detector().detect(run)

    assert result == DetectedVersion(version="v0.3.0", source="release-branch-tag")


def test_detected_version_reports_which_source_answered() -> None:
    """The source name is load-bearing, not decorative.

    A release cut from the fallback is a different confidence level than one cut from the
    release branch, and the operator must be able to tell them apart even though the
    version string is identical.
    """
    from_branch = default_detector().detect(FakeGit({"--merged": "v1.2.3\n"}))
    from_fallback = default_detector().detect(
        FakeGit({"--merged": GitCommandError("no such ref"), "tag --sort": "v1.2.3\n"})
    )

    assert from_branch.version == from_fallback.version
    assert from_branch.source != from_fallback.source


def test_git_failure_is_not_swallowed_into_a_wrong_version(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Every source failing yields the floor, and says so on stderr.

    The floor must be reachable — a release chain that cannot answer is worse than one
    that answers `v0.0.0` and names the answer as a floor — but it must never be
    mistaken for a real tag (`.claude/rules/error-handling.md` § 5, no magic values).
    """
    run = FakeGit(
        {
            "--merged": GitCommandError("fatal: not a git repository"),
            "tag --sort": GitCommandError("fatal: not a git repository"),
        }
    )

    result = default_detector().detect(run)

    assert result == DetectedVersion(version="v0.0.0", source="floor")
    assert "not a git repository" in capsys.readouterr().err


def test_missing_git_binary_propagates() -> None:
    """`git` absent is unrecoverable: a release must not proceed pretending otherwise."""

    def no_git(_args: Sequence[str]) -> str:
        raise FileNotFoundError("git")

    with pytest.raises(FileNotFoundError):
        default_detector().detect(no_git)


def test_sources_are_consulted_in_declared_order() -> None:
    """`VersionDetector` walks its list; it does not re-order or skip."""
    run = FakeGit({"tag --sort": "v2.0.0\n"})
    detector = VersionDetector([HighestSemverTag(), ReleaseBranchTag(), FloorVersion()])

    result = detector.detect(run)

    assert result.source == "highest-semver-tag"
    assert "--merged" not in " ".join(run.calls[0])


# --- Integration: real repositories, because the defect lives in the QUESTION asked ---


def _git(repo: Path, *args: str) -> str:
    proc = subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            "user.email=test@example.invalid",
            "-c",
            "user.name=test",
            "-c",
            "commit.gpgsign=false",
            *args,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return proc.stdout.strip()


def _commit(repo: Path, name: str) -> None:
    """One commit touching one distinctly-named file, so branches merge without conflict."""
    (repo / f"{name}.txt").write_text(name, encoding="utf-8")
    _git(repo, "add", f"{name}.txt")
    _git(repo, "commit", "-m", name)


def test_tag_on_unreachable_merge_commit_is_still_detected(tmp_path: Path) -> None:
    """This repository's exact shape: the release tag is not an ancestor of the work branch.

    main ──────●──────────────●(merge, tagged v1.0.0)
                \\            /
     workspace    ●────────●───────●(HEAD)

    `git describe` from `workspace` cannot see the tag — that is the defect B-228 recorded,
    and the first assertion pins it so the test fails if the premise ever stops holding.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    _commit(repo, "base")
    _git(repo, "branch", "workspace")
    _commit(repo, "main-only")

    _git(repo, "switch", "-q", "workspace")
    _commit(repo, "work-1")

    _git(repo, "switch", "-q", "main")
    _git(repo, "merge", "--no-ff", "-m", "promote", "workspace")
    _git(repo, "tag", "-a", "v1.0.0", "-m", "release")

    _git(repo, "switch", "-q", "workspace")
    _commit(repo, "work-2")

    # The premise: the naive command cannot answer from here.
    with pytest.raises(subprocess.CalledProcessError):
        _git(repo, "describe", "--tags", "--abbrev=0")

    result = VersionDetector(
        [ReleaseBranchTag(ref="main"), HighestSemverTag(), FloorVersion()]
    ).detect(git_runner(repo))

    assert result == DetectedVersion(version="v1.0.0", source="release-branch-tag")


def test_hotfix_numbered_below_a_shipped_release_does_not_win(tmp_path: Path) -> None:
    """MF-1 regression: `describe` orders by ancestry, the detector by version.

    Tags in commit order: v0.83.1 -> v0.85.0 -> v0.83.2 (a hotfix numbered below a shipped
    release, merged after it). `git describe --abbrev=0` returns the NEAREST tag, so the
    chain would compute the next version from v0.83.2 and publish v0.84.0 — a tag that
    already exists.

    Without this case the fixture above has only increasing tags, both commands agree, and
    the suite would be green on the wrong implementation.
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, "init", "-q", "-b", "main")
    for content, tag in (("a", "v0.83.1"), ("b", "v0.85.0"), ("c", "v0.83.2")):
        _commit(repo, content)
        _git(repo, "tag", "-a", tag, "-m", tag)

    assert _git(repo, "describe", "--tags", "--abbrev=0") == "v0.83.2"

    result = VersionDetector(
        [ReleaseBranchTag(ref="main"), HighestSemverTag(), FloorVersion()]
    ).detect(git_runner(repo))

    assert result == DetectedVersion(version="v0.85.0", source="release-branch-tag")


# --- Wiring: the caller is a shell line in Markdown, so assert it mechanically ---


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def test_the_release_skill_calls_this_module() -> None:
    """Pillar (a) of the wiring triad, made self-checking.

    `/release` is orchestrated by SKILL.md itself — all six release scripts are invoked only
    from its bash blocks, so that IS the convention here, not a shortcut. But nothing
    mechanically verified the line, and a path typo would surface at release time. This test
    is the cheapest thing that makes the wiring fail loudly instead of quietly.
    """
    skill = (_repo_root() / ".claude/skills/release/SKILL.md").read_text(encoding="utf-8")

    assert "detect_current_version.py" in skill
    assert "--current" in skill


def test_the_installer_ships_this_module() -> None:
    """The caller must not ship without the callee.

    patch_install.sh shipped SKILL.md and the five sibling scripts but not this one, while the
    same change removed the old `|| echo v0.0.0` fallback — so a patched consumer would have
    fed `--current ''` into the version computation and numbered a release from nothing.
    Caught by review, not by a test; now by a test.
    """
    manifest = (_repo_root() / ".claude/scripts/patch_install.sh").read_text(encoding="utf-8")

    assert "skills/release/scripts/detect_current_version.py" in manifest
    assert "skills/release/tests/test_detect_current_version.py" in manifest


def test_the_skill_halts_when_detection_fails() -> None:
    """A missing detector must halt the chain, never yield an empty version."""
    skill = (_repo_root() / ".claude/skills/release/SKILL.md").read_text(encoding="utf-8")

    assert "exit 1" in skill
    assert 'LAST_TAG=$(python3' not in skill, (
        "assigning the detector's output directly reintroduces the empty-on-failure path"
    )
